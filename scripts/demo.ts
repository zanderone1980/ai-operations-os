#!/usr/bin/env npx tsx
/**
 * AI Operations OS -- Full Pipeline Demo (TypeScript)
 *
 * Demonstrates three pipeline scenarios via the /api/pipeline/simulate endpoint,
 * then builds and verifies a cryptographic receipt chain locally.
 *
 * Usage:
 *   npx tsx scripts/demo.ts              # defaults to http://localhost:3100
 *   npx tsx scripts/demo.ts --url http://example.com:4000
 */

import {
  computeReceiptHash,
  signReceipt,
  verifyReceiptChain,
  GENESIS_HASH,
  type ActionReceipt,
} from '@ai-operations/shared-types';

// ── ANSI Colors ──────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
};

// ── CLI flag parsing ─────────────────────────────────────────────────────────

function parseArgs(): { apiUrl: string } {
  const args = process.argv.slice(2);
  let apiUrl = 'http://localhost:3100';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      apiUrl = args[i + 1];
      i++;
    }
  }
  return { apiUrl };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function header(): void {
  const line = '='.repeat(62);
  console.log();
  console.log(`${c.cyan}${c.bold}${line}${c.reset}`);
  console.log(`${c.cyan}${c.bold}   AI OPERATIONS OS -- FULL PIPELINE DEMO${c.reset}`);
  console.log(`${c.cyan}${c.bold}   Policy Gates  |  CORD Safety  |  Receipt Chain${c.reset}`);
  console.log(`${c.cyan}${c.bold}${line}${c.reset}`);
  console.log();
}

function sectionHeader(title: string): void {
  const line = '-'.repeat(58);
  console.log(`${c.dim}${line}${c.reset}`);
  console.log(`${c.bold}${c.white}  ${title}${c.reset}`);
  console.log(`${c.dim}${line}${c.reset}`);
}

function log(label: string, value: string): void {
  console.log(`  ${c.bold}${label}${c.reset}  ${value}`);
}

function colorDecision(decision: string): string {
  switch (decision) {
    case 'ALLOW':
      return `${c.green}ALLOW${c.reset}`;
    case 'BLOCK':
      return `${c.red}BLOCK${c.reset}`;
    case 'CHALLENGE':
      return `${c.yellow}CHALLENGE${c.reset}`;
    case 'CONTAIN':
      return `${c.yellow}CONTAIN${c.reset}`;
    default:
      return decision;
  }
}

function colorPolicy(decision: string): string {
  if (decision === 'auto') {
    return `${c.green}autonomous${c.reset}`;
  }
  return `${c.yellow}needs approval${c.reset}`;
}

// ── Scenario runner ──────────────────────────────────────────────────────────

interface SimulatePayload {
  source: string;
  subject: string;
  body: string;
}

interface SimStep {
  connector: string;
  operation: string;
  policyDecision: string;
  safetyDecision: string;
  requiresApproval: boolean;
}

interface SimResponse {
  simulation: boolean;
  source: string;
  intent: string;
  workflowType: string;
  steps: SimStep[];
  summary: {
    totalSteps: number;
    autoSteps: number;
    approvalSteps: number;
    blockedSteps: number;
  };
}

async function runScenario(
  apiUrl: string,
  title: string,
  payload: SimulatePayload,
): Promise<void> {
  console.log();
  sectionHeader(title);
  console.log();

  // Print input
  log('Source:', `${c.cyan}${payload.source}${c.reset}`);
  log('Subject:', payload.subject);
  log('Body:', `${c.dim}${payload.body}${c.reset}`);
  console.log();

  // Call simulate endpoint
  let data: SimResponse;
  try {
    const res = await fetch(`${apiUrl}/api/pipeline/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log(`  ${c.red}ERROR${c.reset}: ${res.status} - ${errText}`);
      return;
    }

    data = (await res.json()) as SimResponse;
  } catch (err) {
    console.log(
      `  ${c.red}ERROR${c.reset}: Could not reach ${apiUrl} -- ${(err as Error).message}`,
    );
    console.log(
      `  ${c.dim}Make sure the API server is running: npm run dev --workspace=apps/ops-api${c.reset}`,
    );
    return;
  }

  // Intent classification result
  log(
    'Intent:',
    `${c.magenta}${data.intent}${c.reset}  workflow=${c.blue}${data.workflowType}${c.reset}`,
  );
  console.log();

  // Workflow steps with policy/safety decisions
  console.log(`  ${c.bold}Workflow Steps:${c.reset}`);
  for (const step of data.steps) {
    const label = `${step.connector}.${step.operation}`;
    const policy = colorPolicy(step.policyDecision);
    const safety = colorDecision(step.safetyDecision);
    const icon = step.requiresApproval ? `${c.yellow}*${c.reset}` : `${c.green}+${c.reset}`;
    console.log(`    ${icon} ${c.bold}${label}${c.reset}  policy=${policy}  safety=${safety}`);
  }
  console.log();

  // Summary: which steps need approval vs auto-allowed
  const s = data.summary;
  console.log(
    `  ${c.bold}Summary:${c.reset} ${s.totalSteps} steps | ` +
      `${c.green}${s.autoSteps} auto${c.reset} | ` +
      `${c.yellow}${s.approvalSteps} approval${c.reset} | ` +
      `${c.red}${s.blockedSteps} blocked${c.reset}`,
  );
  console.log();
}

// ── Receipt chain demonstration ──────────────────────────────────────────────

function demoReceiptChain(): void {
  console.log();
  sectionHeader('RECEIPT CHAIN VERIFICATION');
  console.log();

  const HMAC_KEY = 'demo-secret-key-for-receipt-signing';

  // Build 3 sample receipts with hash-chaining
  const receiptData: Array<Omit<ActionReceipt, 'hash' | 'signature'>> = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      actionId: 'a0000000-0000-0000-0000-000000000001',
      policyVersion: '1.0.0',
      cordDecision: 'ALLOW',
      cordScore: 12,
      cordReasons: ['read-only operation'],
      input: { connector: 'gmail', operation: 'read' },
      output: { messageCount: 3 },
      timestamp: new Date('2026-01-15T10:00:00Z').toISOString(),
      prevHash: GENESIS_HASH,
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      actionId: 'a0000000-0000-0000-0000-000000000002',
      policyVersion: '1.0.0',
      cordDecision: 'ALLOW',
      cordScore: 35,
      cordReasons: ['write operation', 'approved by user'],
      input: { connector: 'gmail', operation: 'reply', to: 'customer@example.com' },
      output: { sent: true },
      timestamp: new Date('2026-01-15T10:00:05Z').toISOString(),
      prevHash: '', // will be filled after computing receipt 1's hash
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      actionId: 'a0000000-0000-0000-0000-000000000003',
      policyVersion: '1.0.0',
      cordDecision: 'ALLOW',
      cordScore: 55,
      cordReasons: ['social post', 'approved by user', 'contains pricing'],
      input: { connector: 'x-twitter', operation: 'post', text: 'New feature release!' },
      output: { tweetId: '123456789' },
      timestamp: new Date('2026-01-15T10:01:00Z').toISOString(),
      prevHash: '', // will be filled after computing receipt 2's hash
    },
  ];

  // Chain the receipts
  const chain: ActionReceipt[] = [];
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < receiptData.length; i++) {
    const data = { ...receiptData[i], prevHash };
    const hash = computeReceiptHash(data);
    const signature = signReceipt(hash, HMAC_KEY);
    const receipt: ActionReceipt = { ...data, hash, signature };
    chain.push(receipt);
    prevHash = hash;

    console.log(
      `  ${c.bold}Receipt #${i + 1}${c.reset}  ` +
        `id=${c.dim}${receipt.id.slice(0, 8)}...${c.reset}  ` +
        `action=${c.cyan}${receipt.input.connector}.${receipt.input.operation}${c.reset}  ` +
        `score=${receipt.cordScore}/99`,
    );
    console.log(
      `    hash=${c.dim}${receipt.hash.slice(0, 16)}...${c.reset}  ` +
        `prevHash=${c.dim}${receipt.prevHash === GENESIS_HASH ? 'genesis' : receipt.prevHash.slice(0, 16) + '...'}${c.reset}`,
    );
  }

  console.log();

  // Verify the chain
  const result = verifyReceiptChain(chain, HMAC_KEY);

  if (result.valid) {
    console.log(
      `  ${c.green}${c.bold}CHAIN VALID${c.reset}  ` +
        `${c.green}All ${chain.length} receipts verified -- hashes linked, signatures match.${c.reset}`,
    );
  } else {
    console.log(
      `  ${c.red}${c.bold}CHAIN BROKEN${c.reset}  ` +
        `at index ${result.brokenAt}: ${result.reason}`,
    );
  }

  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { apiUrl } = parseArgs();

  header();

  console.log(`  ${c.bold}API:${c.reset} ${c.cyan}${apiUrl}${c.reset}`);
  console.log();

  // ── Scenario 1: Email Reply ──
  await runScenario(apiUrl, 'SCENARIO 1: Email Reply', {
    source: 'email',
    subject: 'Customer asking about pricing',
    body: 'Hi, I wanted to know about your pricing plans.',
  });

  // ── Scenario 2: Calendar Schedule ──
  await runScenario(apiUrl, 'SCENARIO 2: Calendar Schedule', {
    source: 'calendar',
    subject: 'Meeting request from partner',
    body: 'Schedule a meeting with the team next Tuesday.',
  });

  // ── Scenario 3: Social Post ──
  await runScenario(apiUrl, 'SCENARIO 3: Social Post', {
    source: 'social',
    subject: 'New product launch announcement',
    body: 'Post about our new feature release on social media.',
  });

  // ── Receipt Chain ──
  demoReceiptChain();

  // ── Done ──
  const line = '='.repeat(62);
  console.log(`${c.cyan}${c.bold}${line}${c.reset}`);
  console.log(`${c.cyan}${c.bold}   DEMO COMPLETE${c.reset}`);
  console.log(`${c.cyan}${c.bold}${line}${c.reset}`);
  console.log();
  console.log(`  ${c.bold}What this demo showed:${c.reset}`);
  console.log(`    ${c.green}+${c.reset} Intent classification from raw events`);
  console.log(`    ${c.green}+${c.reset} Policy gates: read ops auto-allowed, writes need approval`);
  console.log(`    ${c.green}+${c.reset} CORD safety scoring on every action`);
  console.log(`    ${c.green}+${c.reset} Human-in-the-loop approval for risky operations`);
  console.log(`    ${c.green}+${c.reset} Cryptographic receipt chain with hash-linking`);
  console.log(`    ${c.green}+${c.reset} Independent chain verification`);
  console.log();
}

main().catch((err) => {
  console.error(`${c.red}Demo failed:${c.reset}`, (err as Error).message);
  process.exit(1);
});
