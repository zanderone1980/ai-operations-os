#!/usr/bin/env node
/**
 * SPARK Background Worker — Continuously feeds SPARK by processing
 * unread Gmail messages and auto-approving them.
 *
 * Usage:
 *   node apps/ops-api/spark-worker.js
 *
 * Expects the ops-api server to be running on localhost:3100.
 *
 * Cycles:
 *   1. Fetch unread inbox messages
 *   2. Process each through the pipeline with autoApprove: true
 *   3. Log SPARK learning results
 *   4. Wait INTERVAL_MS before next cycle
 */

const http = require('http');

const API_BASE = 'http://localhost:3100';
const INTERVAL_MS = parseInt(process.env.SPARK_INTERVAL || '60000', 10); // 1 minute
const BATCH_SIZE = parseInt(process.env.SPARK_BATCH || '5', 10);

// Track processed message IDs to avoid re-processing
const processed = new Set();

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const url = new URL(path, API_BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);

    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(d) });
        } catch {
          resolve({ status: res.statusCode, data: d });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function ts() {
  return new Date().toISOString().slice(11, 19);
}

async function cycle() {
  // 1. Fetch inbox
  const inbox = await request('GET', '/api/gmail/inbox?limit=20&query=is:unread');
  if (inbox.status !== 200) {
    console.log(`[${ts()}] ⚠ Inbox fetch failed: ${inbox.data?.error || inbox.status}`);
    return;
  }

  const messages = inbox.data?.messages || [];
  const unprocessed = messages.filter((m) => !processed.has(m.id));

  if (unprocessed.length === 0) {
    console.log(`[${ts()}] 💤 No new unread messages (${processed.size} already processed)`);
    return;
  }

  const batch = unprocessed.slice(0, BATCH_SIZE);
  console.log(`[${ts()}] 📬 Found ${unprocessed.length} new messages, processing ${batch.length}`);

  for (const msg of batch) {
    const subject = (msg.subject || '').slice(0, 60);
    try {
      const result = await request('POST', '/api/gmail/process', {
        messageId: msg.id,
        autoApprove: true,
      });

      processed.add(msg.id);

      if (result.status !== 200) {
        console.log(`[${ts()}]   ❌ "${subject}" — ${result.data?.error || result.status}`);
        continue;
      }

      const d = result.data;
      const spark = d.spark || {};
      const pred = spark.prediction || {};
      const ep = spark.episode || {};
      const insights = spark.insights || [];

      if (ep.weightBefore !== undefined) {
        console.log(
          `[${ts()}]   ✅ "${subject}"` +
            ` | ${pred.category} | conf: ${pred.confidence}` +
            ` | w: ${ep.weightBefore}→${ep.weightAfter} (${ep.adjustmentDirection})` +
            (insights.length ? ` | ${insights.length} insight(s)` : ''),
        );
      } else {
        console.log(
          `[${ts()}]   ✅ "${subject}"` +
            ` | ${pred.category} | conf: ${pred.confidence}` +
            ` | ${d.blocked ? 'BLOCKED' : d.approval?.decision || 'processed'}`,
        );
      }
    } catch (err) {
      console.log(`[${ts()}]   ❌ "${subject}" — ${err.message}`);
      processed.add(msg.id); // Don't retry failures
    }
  }
}

async function run() {
  console.log(`\n⚡ SPARK Background Worker`);
  console.log(`   Server: ${API_BASE}`);
  console.log(`   Interval: ${INTERVAL_MS / 1000}s`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Press Ctrl+C to stop\n`);

  // Initial cycle immediately
  await cycle();

  // Then repeat on interval
  setInterval(async () => {
    try {
      await cycle();
    } catch (err) {
      console.log(`[${ts()}] ⚠ Cycle error: ${err.message}`);
    }
  }, INTERVAL_MS);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
