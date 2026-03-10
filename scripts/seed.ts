#!/usr/bin/env npx tsx
/**
 * Seed Script — Populate the AI Operations OS database with demo data.
 *
 * Usage:
 *   npx tsx scripts/seed.ts            # seed the database
 *   npx tsx scripts/seed.ts --reset    # delete DB and re-seed
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

import { createStores } from '@ai-ops/ops-storage';
import {
  createTask,
  createWorkflowRun,
  createStep,
  createApproval,
  computeReceiptHash,
  signReceipt,
  GENESIS_HASH,
  type Task,
  type ActionReceipt,
} from '@ai-ops/shared-types';

// ── Constants ────────────────────────────────────────────────────────────────

const DB_PATH = path.join(os.homedir(), '.ai-ops', 'data.db');
const HMAC_KEY = 'ai-ops-demo-receipt-signing-key';

// ── CLI Flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isReset = args.includes('--reset');

// ── ANSI Colors ──────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

// ── Seed Functions ───────────────────────────────────────────────────────────

function seedTasks(stores: ReturnType<typeof createStores>): Task[] {
  const taskDefs: Array<Parameters<typeof createTask>[0]> = [
    // Email tasks (4)
    { source: 'email', title: 'Re: Q1 Revenue Report needs review', body: 'Hi team, the Q1 revenue report is attached. Please review the figures in section 3 before our board meeting on Friday.', intent: 'reply', priority: 'high', status: 'pending' },
    { source: 'email', title: 'Customer complaint: order #8842 damaged', body: 'My order arrived with a cracked screen. I need a replacement or refund ASAP. Order number is 8842.', intent: 'escalate', priority: 'urgent', status: 'running' },
    { source: 'email', title: 'Partnership inquiry from TechCorp', body: 'We are interested in exploring a strategic partnership with your company. Could we schedule a call next week?', intent: 'reply', priority: 'normal', status: 'pending' },
    { source: 'email', title: 'Weekly newsletter draft for approval', body: 'Attached is the draft for this week\'s newsletter. Please approve or suggest edits by end of day.', intent: 'reply', priority: 'low', status: 'awaiting_approval' },

    // Calendar tasks (4)
    { source: 'calendar', title: 'Schedule product roadmap review', body: 'Block 2 hours next Thursday for the quarterly product roadmap review with engineering leads.', intent: 'schedule', priority: 'high', status: 'planned' },
    { source: 'calendar', title: 'Reschedule investor call to Friday', body: 'The investor call originally set for Wednesday needs to move to Friday 2pm EST.', intent: 'schedule', priority: 'urgent', status: 'pending' },
    { source: 'calendar', title: 'Team standup recurring meeting setup', body: 'Create a recurring daily standup at 9:15am for the platform engineering team.', intent: 'schedule', priority: 'normal', status: 'completed' },
    { source: 'calendar', title: 'Cancel deprecated sprint planning', body: 'The old sprint planning meeting on Mondays is no longer needed. Please cancel all future occurrences.', intent: 'schedule', priority: 'low', status: 'completed' },

    // Social tasks (4)
    { source: 'social', title: 'Respond to viral product mention on X', body: 'A tech influencer with 500k followers just posted about our product. Draft a thank-you reply and repost.', intent: 'post', priority: 'urgent', status: 'running' },
    { source: 'social', title: 'Schedule launch announcement post', body: 'Prepare and schedule the v2.0 launch announcement across X, LinkedIn, and the company blog.', intent: 'post', priority: 'high', status: 'awaiting_approval' },
    { source: 'social', title: 'Monitor brand mentions this week', body: 'Track and summarize all brand mentions across social platforms for the weekly report.', intent: 'ignore', priority: 'normal', status: 'planned' },
    { source: 'social', title: 'Reply to customer support question on X', body: 'User @janedoe asked about our refund policy. Draft a helpful public reply.', intent: 'reply', priority: 'normal', status: 'pending' },

    // Store tasks (4)
    { source: 'store', title: 'Process refund for order #12045', body: 'Customer requested a full refund for order #12045. Item was returned in original packaging within 30 days.', intent: 'refund', priority: 'high', status: 'awaiting_approval' },
    { source: 'store', title: 'Fulfill bulk order for Acme Corp', body: '150 units of SKU-7721 need to be shipped to Acme Corp warehouse by end of week. Priority shipping required.', intent: 'fulfill', priority: 'urgent', status: 'running' },
    { source: 'store', title: 'Update inventory for restocked items', body: 'Warehouse confirmed receipt of 500 units each for SKU-3301, SKU-3302, and SKU-3303.', intent: 'fulfill', priority: 'normal', status: 'completed' },
    { source: 'store', title: 'Investigate payment failure on order #12100', body: 'Payment gateway returned error code E-4422 for order #12100. Customer card may have been declined.', intent: 'escalate', priority: 'high', status: 'failed' },

    // Manual tasks (4)
    { source: 'manual', title: 'Review CORD safety policy thresholds', body: 'The current CORD thresholds may be too conservative. Review the allow/challenge/block boundaries and propose adjustments.', intent: 'unknown', priority: 'normal', status: 'pending' },
    { source: 'manual', title: 'Audit last month receipt chain integrity', body: 'Run a full verification of the receipt chain for all actions executed in the previous calendar month.', intent: 'unknown', priority: 'low', status: 'planned' },
    { source: 'manual', title: 'Onboard new connector: Slack integration', body: 'Implement and test the Slack connector module. Should support read, post, and thread-reply operations.', intent: 'unknown', priority: 'high', status: 'running' },
    { source: 'manual', title: 'Generate compliance report for Q1', body: 'Compile all approval decisions, CORD scores, and receipt chain summaries into the quarterly compliance PDF.', intent: 'unknown', priority: 'normal', status: 'pending' },
  ];

  const tasks: Task[] = [];
  for (const def of taskDefs) {
    const task = createTask(def);
    stores.tasks.save(task);
    tasks.push(task);
  }
  return tasks;
}

function seedWorkflows(stores: ReturnType<typeof createStores>, tasks: Task[]): WorkflowRun[] {
  const workflows: WorkflowRun[] = [];

  // 1. Completed email reply workflow
  const wf1 = createWorkflowRun(tasks[0].id, 'email-reply', [
    createStep('gmail', 'read', { messageId: 'msg-001' }),
    createStep('codebot', 'classify', { text: tasks[0].body ?? '' }),
    createStep('codebot', 'draft_reply', { context: 'Q1 revenue report' }),
    createStep('gmail', 'send', { to: 'team@company.com', subject: 'Re: Q1 Revenue Report' }),
  ]);
  wf1.state = 'completed';
  wf1.endedAt = new Date().toISOString();
  wf1.steps[0].status = 'completed';
  wf1.steps[0].cordDecision = 'ALLOW';
  wf1.steps[0].cordScore = 8;
  wf1.steps[0].durationMs = 120;
  wf1.steps[1].status = 'completed';
  wf1.steps[1].cordDecision = 'ALLOW';
  wf1.steps[1].cordScore = 5;
  wf1.steps[1].durationMs = 340;
  wf1.steps[2].status = 'completed';
  wf1.steps[2].cordDecision = 'ALLOW';
  wf1.steps[2].cordScore = 22;
  wf1.steps[2].durationMs = 1500;
  wf1.steps[3].status = 'approved';
  wf1.steps[3].cordDecision = 'CHALLENGE';
  wf1.steps[3].cordScore = 45;
  wf1.steps[3].durationMs = 85;
  stores.workflows.saveRun(wf1);
  workflows.push(wf1);

  // 2. Running social post workflow
  const wf2 = createWorkflowRun(tasks[8].id, 'social-post', [
    createStep('x-twitter', 'read_mention', { tweetId: 'tw-9928' }),
    createStep('codebot', 'draft_reply', { tone: 'grateful', platform: 'x' }),
    createStep('x-twitter', 'reply', { inReplyTo: 'tw-9928' }),
    createStep('x-twitter', 'repost', { tweetId: 'tw-9928' }),
  ]);
  wf2.state = 'running';
  wf2.steps[0].status = 'completed';
  wf2.steps[0].cordDecision = 'ALLOW';
  wf2.steps[0].cordScore = 3;
  wf2.steps[0].durationMs = 200;
  wf2.steps[1].status = 'running';
  stores.workflows.saveRun(wf2);
  workflows.push(wf2);

  // 3. Paused refund workflow (awaiting approval)
  const wf3 = createWorkflowRun(tasks[12].id, 'store-refund', [
    createStep('shopify', 'get_order', { orderId: '12045' }),
    createStep('codebot', 'evaluate_refund', { reason: 'returned in packaging' }),
    createStep('shopify', 'issue_refund', { orderId: '12045', amount: 89.99 }),
  ]);
  wf3.state = 'paused';
  wf3.steps[0].status = 'completed';
  wf3.steps[0].cordDecision = 'ALLOW';
  wf3.steps[0].cordScore = 5;
  wf3.steps[0].durationMs = 150;
  wf3.steps[1].status = 'completed';
  wf3.steps[1].cordDecision = 'ALLOW';
  wf3.steps[1].cordScore = 15;
  wf3.steps[1].durationMs = 800;
  wf3.steps[2].status = 'blocked';
  wf3.steps[2].cordDecision = 'CHALLENGE';
  wf3.steps[2].cordScore = 68;
  stores.workflows.saveRun(wf3);
  workflows.push(wf3);

  // 4. Failed payment investigation workflow
  const wf4 = createWorkflowRun(tasks[15].id, 'store-investigate', [
    createStep('shopify', 'get_order', { orderId: '12100' }),
    createStep('shopify', 'get_payment_status', { orderId: '12100' }),
    createStep('codebot', 'diagnose_payment', { errorCode: 'E-4422' }),
  ]);
  wf4.state = 'failed';
  wf4.endedAt = new Date().toISOString();
  wf4.error = 'Payment gateway returned HTTP 503: service unavailable';
  wf4.steps[0].status = 'completed';
  wf4.steps[0].cordDecision = 'ALLOW';
  wf4.steps[0].cordScore = 5;
  wf4.steps[0].durationMs = 110;
  wf4.steps[1].status = 'failed';
  wf4.steps[1].error = 'Payment gateway HTTP 503';
  wf4.steps[1].cordDecision = 'ALLOW';
  wf4.steps[1].cordScore = 10;
  wf4.steps[1].durationMs = 3200;
  wf4.steps[2].status = 'pending';
  stores.workflows.saveRun(wf4);
  workflows.push(wf4);

  // 5. Queued calendar scheduling workflow
  const wf5 = createWorkflowRun(tasks[4].id, 'calendar-schedule', [
    createStep('google-calendar', 'find_availability', { date: '2026-03-12', duration: 120 }),
    createStep('codebot', 'suggest_time', { preference: 'afternoon' }),
    createStep('google-calendar', 'create_event', { title: 'Product Roadmap Review' }),
    createStep('gmail', 'send_invite', { attendees: ['eng-leads@company.com'] }),
  ]);
  wf5.state = 'queued';
  stores.workflows.saveRun(wf5);
  workflows.push(wf5);

  return workflows;
}

function seedApprovals(stores: ReturnType<typeof createStores>, tasks: Task[]): void {
  // 1. Low risk: newsletter approval
  const appr1 = createApproval(
    crypto.randomUUID(),
    tasks[3].id,
    'low',
    'Outbound email to subscriber list (1,200 recipients)',
    'Send weekly newsletter "Product Updates - March 2026" to 1,200 subscribers via Mailchimp.',
    300_000, // 5 min TTL
  );
  stores.approvals.save(appr1);

  // 2. Medium risk: social media post
  const appr2 = createApproval(
    crypto.randomUUID(),
    tasks[9].id,
    'medium',
    'Public social media post with pricing information on X (500k+ potential reach)',
    'Post on X: "Excited to announce v2.0 with new AI-powered workflows! Starting at $29/mo. Try it free for 14 days."',
    600_000, // 10 min TTL
  );
  stores.approvals.save(appr2);

  // 3. High risk: financial refund
  const appr3 = createApproval(
    crypto.randomUUID(),
    tasks[12].id,
    'high',
    'Financial transaction: issue $89.99 refund to customer credit card',
    'Refund $89.99 to Visa ending in 4242 for order #12045. Customer returned item within 30-day window. Refund will appear in 3-5 business days.',
    null, // no TTL, wait forever
  );
  stores.approvals.save(appr3);
}

function seedReceipts(stores: ReturnType<typeof createStores>): ActionReceipt[] {
  const receipts: ActionReceipt[] = [];
  let prevHash = GENESIS_HASH;

  const receiptInputs: Array<Omit<ActionReceipt, 'hash' | 'signature' | 'prevHash'>> = [
    {
      id: crypto.randomUUID(),
      actionId: crypto.randomUUID(),
      policyVersion: '1.0.0',
      cordDecision: 'ALLOW',
      cordScore: 5,
      cordReasons: ['read-only operation'],
      input: { connector: 'gmail', operation: 'read', messageId: 'msg-001' },
      output: { subject: 'Q1 Revenue Report', from: 'cfo@company.com' },
      timestamp: new Date('2026-03-08T09:00:00Z').toISOString(),
    },
    {
      id: crypto.randomUUID(),
      actionId: crypto.randomUUID(),
      policyVersion: '1.0.0',
      cordDecision: 'ALLOW',
      cordScore: 18,
      cordReasons: ['classification operation', 'no external side effects'],
      input: { connector: 'codebot', operation: 'classify', text: 'Q1 revenue report review' },
      output: { intent: 'reply', confidence: 0.94 },
      timestamp: new Date('2026-03-08T09:00:02Z').toISOString(),
    },
    {
      id: crypto.randomUUID(),
      actionId: crypto.randomUUID(),
      policyVersion: '1.0.0',
      cordDecision: 'ALLOW',
      cordScore: 25,
      cordReasons: ['content generation', 'internal only'],
      input: { connector: 'codebot', operation: 'draft_reply', context: 'revenue figures' },
      output: { draftLength: 245, tone: 'professional' },
      timestamp: new Date('2026-03-08T09:00:05Z').toISOString(),
    },
    {
      id: crypto.randomUUID(),
      actionId: crypto.randomUUID(),
      policyVersion: '1.0.0',
      cordDecision: 'CHALLENGE',
      cordScore: 52,
      cordReasons: ['outbound email', 'contains financial data', 'approved by user'],
      input: { connector: 'gmail', operation: 'send', to: 'team@company.com' },
      output: { sent: true, messageId: 'msg-reply-001' },
      timestamp: new Date('2026-03-08T09:01:30Z').toISOString(),
    },
    {
      id: crypto.randomUUID(),
      actionId: crypto.randomUUID(),
      policyVersion: '1.0.0',
      cordDecision: 'ALLOW',
      cordScore: 8,
      cordReasons: ['read-only operation', 'internal audit'],
      input: { connector: 'system', operation: 'log_completion', workflowId: 'wf-001' },
      output: { logged: true, totalSteps: 4, completedSteps: 4 },
      timestamp: new Date('2026-03-08T09:01:32Z').toISOString(),
    },
  ];

  const insertStmt = stores.db.db.prepare(`
    INSERT OR REPLACE INTO receipts
      (id, action_id, policy_version, cord_decision, cord_score, cord_reasons, input, output, timestamp, hash, signature, prev_hash)
    VALUES
      (@id, @actionId, @policyVersion, @cordDecision, @cordScore, @cordReasons, @input, @output, @timestamp, @hash, @signature, @prevHash)
  `);

  for (const data of receiptInputs) {
    const withPrev = { ...data, prevHash };
    const hash = computeReceiptHash(withPrev);
    const signature = signReceipt(hash, HMAC_KEY);
    const receipt: ActionReceipt = { ...withPrev, hash, signature };

    insertStmt.run({
      id: receipt.id,
      actionId: receipt.actionId,
      policyVersion: receipt.policyVersion,
      cordDecision: receipt.cordDecision,
      cordScore: receipt.cordScore,
      cordReasons: JSON.stringify(receipt.cordReasons),
      input: JSON.stringify(receipt.input),
      output: receipt.output ? JSON.stringify(receipt.output) : null,
      timestamp: receipt.timestamp,
      hash: receipt.hash,
      signature: receipt.signature,
      prevHash: receipt.prevHash,
    });

    receipts.push(receipt);
    prevHash = hash;
  }

  return receipts;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runSeed(reset: boolean = false): Promise<{
  tasks: number;
  workflows: number;
  approvals: number;
  receipts: number;
}> {
  if (reset && fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    // Also remove WAL and SHM files if they exist
    const walPath = DB_PATH + '-wal';
    const shmPath = DB_PATH + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    console.log(`${c.yellow}Reset:${c.reset} Deleted existing database at ${DB_PATH}`);
  }

  const stores = createStores(DB_PATH);

  try {
    const tasks = seedTasks(stores);
    const workflows = seedWorkflows(stores, tasks);
    seedApprovals(stores, tasks);
    const receipts = seedReceipts(stores);

    return {
      tasks: tasks.length,
      workflows: workflows.length,
      approvals: 3,
      receipts: receipts.length,
    };
  } finally {
    stores.db.close();
  }
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

if (require.main === module || process.argv[1]?.endsWith('seed.ts')) {
  runSeed(isReset)
    .then((counts) => {
      console.log();
      console.log(`${c.green}${c.bold}Seed complete!${c.reset}`);
      console.log(`  ${c.cyan}Tasks:${c.reset}     ${counts.tasks}`);
      console.log(`  ${c.cyan}Workflows:${c.reset} ${counts.workflows}`);
      console.log(`  ${c.cyan}Approvals:${c.reset} ${counts.approvals}`);
      console.log(`  ${c.cyan}Receipts:${c.reset}  ${counts.receipts}`);
      console.log();
      console.log(`  ${c.dim}Database: ${DB_PATH}${c.reset}`);
      console.log();
    })
    .catch((err) => {
      console.error(`${c.red}Seed failed:${c.reset}`, (err as Error).message);
      process.exit(1);
    });
}
