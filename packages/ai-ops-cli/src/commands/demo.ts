/**
 * demo command — Load seed data into the database.
 *
 * Usage: ai-ops demo
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

const DB_PATH = path.join(os.homedir(), '.ai-ops', 'data.db');
const HMAC_KEY = 'ai-ops-demo-receipt-signing-key';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

export async function demo(): Promise<void> {
  console.log(`${c.dim}Loading demo data...${c.reset}`);
  console.log();

  const stores = createStores(DB_PATH);

  try {
    // ── Seed Tasks ─────────────────────────────────────────────────────────
    const taskDefs: Array<Parameters<typeof createTask>[0]> = [
      { source: 'email', title: 'Re: Q1 Revenue Report needs review', body: 'Hi team, the Q1 revenue report is attached. Please review the figures in section 3 before our board meeting on Friday.', intent: 'reply', priority: 'high', status: 'pending' },
      { source: 'email', title: 'Customer complaint: order #8842 damaged', body: 'My order arrived with a cracked screen. I need a replacement or refund ASAP.', intent: 'escalate', priority: 'urgent', status: 'running' },
      { source: 'email', title: 'Partnership inquiry from TechCorp', body: 'We are interested in exploring a strategic partnership. Could we schedule a call next week?', intent: 'reply', priority: 'normal', status: 'pending' },
      { source: 'email', title: 'Weekly newsletter draft for approval', body: 'Attached is the draft for this week\'s newsletter. Please approve or suggest edits.', intent: 'reply', priority: 'low', status: 'awaiting_approval' },
      { source: 'calendar', title: 'Schedule product roadmap review', body: 'Block 2 hours next Thursday for the quarterly product roadmap review.', intent: 'schedule', priority: 'high', status: 'planned' },
      { source: 'calendar', title: 'Reschedule investor call to Friday', body: 'The investor call needs to move to Friday 2pm EST.', intent: 'schedule', priority: 'urgent', status: 'pending' },
      { source: 'calendar', title: 'Team standup recurring meeting setup', body: 'Create a recurring daily standup at 9:15am for platform engineering.', intent: 'schedule', priority: 'normal', status: 'completed' },
      { source: 'calendar', title: 'Cancel deprecated sprint planning', body: 'The old sprint planning meeting on Mondays is no longer needed.', intent: 'schedule', priority: 'low', status: 'completed' },
      { source: 'social', title: 'Respond to viral product mention on X', body: 'A tech influencer with 500k followers posted about our product. Draft a thank-you reply.', intent: 'post', priority: 'urgent', status: 'running' },
      { source: 'social', title: 'Schedule launch announcement post', body: 'Prepare and schedule the v2.0 launch announcement across X and LinkedIn.', intent: 'post', priority: 'high', status: 'awaiting_approval' },
      { source: 'social', title: 'Monitor brand mentions this week', body: 'Track and summarize all brand mentions across social platforms.', intent: 'ignore', priority: 'normal', status: 'planned' },
      { source: 'social', title: 'Reply to customer support question on X', body: 'User @janedoe asked about our refund policy. Draft a helpful reply.', intent: 'reply', priority: 'normal', status: 'pending' },
      { source: 'store', title: 'Process refund for order #12045', body: 'Customer requested a full refund. Item was returned in original packaging.', intent: 'refund', priority: 'high', status: 'awaiting_approval' },
      { source: 'store', title: 'Fulfill bulk order for Acme Corp', body: '150 units of SKU-7721 need to be shipped by end of week.', intent: 'fulfill', priority: 'urgent', status: 'running' },
      { source: 'store', title: 'Update inventory for restocked items', body: 'Warehouse confirmed receipt of 500 units each for SKU-3301 through SKU-3303.', intent: 'fulfill', priority: 'normal', status: 'completed' },
      { source: 'store', title: 'Investigate payment failure on order #12100', body: 'Payment gateway returned error code E-4422.', intent: 'escalate', priority: 'high', status: 'failed' },
      { source: 'manual', title: 'Review CORD safety policy thresholds', body: 'Review the allow/challenge/block boundaries and propose adjustments.', intent: 'unknown', priority: 'normal', status: 'pending' },
      { source: 'manual', title: 'Audit last month receipt chain integrity', body: 'Run a full verification of the receipt chain for last month.', intent: 'unknown', priority: 'low', status: 'planned' },
      { source: 'manual', title: 'Onboard new connector: Slack integration', body: 'Implement and test the Slack connector module.', intent: 'unknown', priority: 'high', status: 'running' },
      { source: 'manual', title: 'Generate compliance report for Q1', body: 'Compile all approval decisions and receipt chain summaries.', intent: 'unknown', priority: 'normal', status: 'pending' },
    ];

    const tasks: Task[] = [];
    for (const def of taskDefs) {
      const task = createTask(def);
      stores.tasks.save(task);
      tasks.push(task);
    }

    // ── Seed Workflows ───────────────────────────────────────────────────────
    let workflowCount = 0;

    const wf1 = createWorkflowRun(tasks[0].id, 'email-reply', [
      createStep('gmail', 'read', { messageId: 'msg-001' }),
      createStep('codebot', 'classify', { text: tasks[0].body ?? '' }),
      createStep('gmail', 'send', { to: 'team@company.com' }),
    ]);
    wf1.state = 'completed';
    wf1.endedAt = new Date().toISOString();
    wf1.steps.forEach((s) => { s.status = 'completed'; s.cordDecision = 'ALLOW'; s.cordScore = 10; });
    stores.workflows.saveRun(wf1);
    workflowCount++;

    const wf2 = createWorkflowRun(tasks[8].id, 'social-post', [
      createStep('x-twitter', 'read_mention', { tweetId: 'tw-9928' }),
      createStep('codebot', 'draft_reply', { tone: 'grateful' }),
      createStep('x-twitter', 'reply', { inReplyTo: 'tw-9928' }),
    ]);
    wf2.state = 'running';
    wf2.steps[0].status = 'completed';
    wf2.steps[0].cordDecision = 'ALLOW';
    wf2.steps[0].cordScore = 3;
    wf2.steps[1].status = 'running';
    stores.workflows.saveRun(wf2);
    workflowCount++;

    const wf3 = createWorkflowRun(tasks[12].id, 'store-refund', [
      createStep('shopify', 'get_order', { orderId: '12045' }),
      createStep('shopify', 'issue_refund', { orderId: '12045', amount: 89.99 }),
    ]);
    wf3.state = 'paused';
    wf3.steps[0].status = 'completed';
    wf3.steps[0].cordDecision = 'ALLOW';
    wf3.steps[0].cordScore = 5;
    wf3.steps[1].status = 'blocked';
    wf3.steps[1].cordDecision = 'CHALLENGE';
    wf3.steps[1].cordScore = 68;
    stores.workflows.saveRun(wf3);
    workflowCount++;

    const wf4 = createWorkflowRun(tasks[15].id, 'store-investigate', [
      createStep('shopify', 'get_order', { orderId: '12100' }),
      createStep('shopify', 'get_payment_status', { orderId: '12100' }),
    ]);
    wf4.state = 'failed';
    wf4.endedAt = new Date().toISOString();
    wf4.error = 'Payment gateway returned HTTP 503';
    wf4.steps[0].status = 'completed';
    wf4.steps[1].status = 'failed';
    wf4.steps[1].error = 'HTTP 503';
    stores.workflows.saveRun(wf4);
    workflowCount++;

    const wf5 = createWorkflowRun(tasks[4].id, 'calendar-schedule', [
      createStep('google-calendar', 'find_availability', { date: '2026-03-12' }),
      createStep('google-calendar', 'create_event', { title: 'Product Roadmap Review' }),
    ]);
    wf5.state = 'queued';
    stores.workflows.saveRun(wf5);
    workflowCount++;

    // ── Seed Approvals ───────────────────────────────────────────────────────
    let approvalCount = 0;

    stores.approvals.save(createApproval(
      crypto.randomUUID(), tasks[3].id, 'low',
      'Outbound email to subscriber list (1,200 recipients)',
      'Send weekly newsletter to 1,200 subscribers via Mailchimp.',
      300_000,
    ));
    approvalCount++;

    stores.approvals.save(createApproval(
      crypto.randomUUID(), tasks[9].id, 'medium',
      'Public social media post with pricing info (500k+ potential reach)',
      'Post on X: v2.0 announcement with pricing details.',
      600_000,
    ));
    approvalCount++;

    stores.approvals.save(createApproval(
      crypto.randomUUID(), tasks[12].id, 'high',
      'Financial transaction: issue $89.99 refund to customer credit card',
      'Refund $89.99 to Visa ending in 4242 for order #12045.',
      null,
    ));
    approvalCount++;

    // ── Seed Receipts ────────────────────────────────────────────────────────
    let receiptCount = 0;
    let prevHash = GENESIS_HASH;

    const receiptInputs: Array<Omit<ActionReceipt, 'hash' | 'signature' | 'prevHash'>> = [
      { id: crypto.randomUUID(), actionId: crypto.randomUUID(), policyVersion: '1.0.0', cordDecision: 'ALLOW', cordScore: 5, cordReasons: ['read-only operation'], input: { connector: 'gmail', operation: 'read' }, output: { subject: 'Q1 Report' }, timestamp: new Date('2026-03-08T09:00:00Z').toISOString() },
      { id: crypto.randomUUID(), actionId: crypto.randomUUID(), policyVersion: '1.0.0', cordDecision: 'ALLOW', cordScore: 18, cordReasons: ['classification operation'], input: { connector: 'codebot', operation: 'classify' }, output: { intent: 'reply' }, timestamp: new Date('2026-03-08T09:00:02Z').toISOString() },
      { id: crypto.randomUUID(), actionId: crypto.randomUUID(), policyVersion: '1.0.0', cordDecision: 'ALLOW', cordScore: 25, cordReasons: ['content generation'], input: { connector: 'codebot', operation: 'draft_reply' }, output: { draftLength: 245 }, timestamp: new Date('2026-03-08T09:00:05Z').toISOString() },
      { id: crypto.randomUUID(), actionId: crypto.randomUUID(), policyVersion: '1.0.0', cordDecision: 'CHALLENGE', cordScore: 52, cordReasons: ['outbound email', 'approved by user'], input: { connector: 'gmail', operation: 'send' }, output: { sent: true }, timestamp: new Date('2026-03-08T09:01:30Z').toISOString() },
      { id: crypto.randomUUID(), actionId: crypto.randomUUID(), policyVersion: '1.0.0', cordDecision: 'ALLOW', cordScore: 8, cordReasons: ['read-only', 'internal audit'], input: { connector: 'system', operation: 'log_completion' }, output: { logged: true }, timestamp: new Date('2026-03-08T09:01:32Z').toISOString() },
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

      insertStmt.run({
        id: withPrev.id,
        actionId: withPrev.actionId,
        policyVersion: withPrev.policyVersion,
        cordDecision: withPrev.cordDecision,
        cordScore: withPrev.cordScore,
        cordReasons: JSON.stringify(withPrev.cordReasons),
        input: JSON.stringify(withPrev.input),
        output: withPrev.output ? JSON.stringify(withPrev.output) : null,
        timestamp: withPrev.timestamp,
        hash,
        signature,
        prevHash,
      });

      prevHash = hash;
      receiptCount++;
    }

    // ── Report ─────────────────────────────────────────────────────────────
    console.log(`${c.green}${c.bold}Demo data loaded${c.reset}`);
    console.log();
    console.log(`  ${c.cyan}Tasks:${c.reset}     ${tasks.length}`);
    console.log(`  ${c.cyan}Workflows:${c.reset} ${workflowCount}`);
    console.log(`  ${c.cyan}Approvals:${c.reset} ${approvalCount}`);
    console.log(`  ${c.cyan}Receipts:${c.reset}  ${receiptCount}`);
    console.log();
    console.log(`  ${c.dim}Database: ${DB_PATH}${c.reset}`);
    console.log();
  } finally {
    stores.db.close();
  }
}
