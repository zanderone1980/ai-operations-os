/**
 * Email Handler — Processes email-related jobs.
 *
 * Job types:
 *   - email.triage: Classify and route incoming email
 *   - email.reply: Draft and send a reply
 *   - email.digest: Generate daily email digest
 */

import type { QueueJob } from '../queue';

export interface EmailTriageData {
  taskId: string;
  messageId: string;
  from: string;
  subject: string;
  body: string;
}

export interface EmailReplyData {
  taskId: string;
  messageId: string;
  to: string;
  subject: string;
  draftBody: string;
}

/**
 * Handle email triage — classify intent, set priority.
 */
export async function handleEmailTriage(job: QueueJob<EmailTriageData>): Promise<unknown> {
  const { taskId, from, subject } = job.data;
  console.log(`[email.triage] Processing: "${subject}" from ${from} (task: ${taskId})`);

  // Heuristic classification — LLM integration replaces this when OPS_LLM_PROVIDER is set
  return {
    simulation: !process.env.OPS_LLM_PROVIDER,
    taskId,
    intent: classifyEmailIntent(subject, job.data.body),
    priority: classifyEmailPriority(subject, from),
    suggestedAction: 'reply',
  };
}

/**
 * Handle email reply — draft and queue for approval.
 */
export async function handleEmailReply(job: QueueJob<EmailReplyData>): Promise<unknown> {
  const { taskId, to, subject } = job.data;
  console.log(`[email.reply] Drafting reply to ${to}: "${subject}" (task: ${taskId})`);

  // Uses provided draft body, or generates via LLM when OPS_LLM_PROVIDER is set
  return {
    simulation: !process.env.OPS_LLM_PROVIDER,
    taskId,
    status: 'draft_ready',
    draftBody: job.data.draftBody || 'Thank you for reaching out. I will review your message and get back to you shortly.',
    requiresApproval: true,
  };
}

// ── Heuristic classifiers (replaced by LLM in production) ────────────────────

function classifyEmailIntent(subject: string, body: string): string {
  const text = `${subject} ${body}`.toLowerCase();
  if (text.includes('meeting') || text.includes('calendar') || text.includes('schedule')) return 'schedule';
  if (text.includes('order') || text.includes('shipping') || text.includes('delivery')) return 'fulfill';
  if (text.includes('urgent') || text.includes('asap') || text.includes('emergency')) return 'escalate';
  if (text.includes('unsubscribe') || text.includes('opt out') || text.includes('spam')) return 'ignore';
  return 'reply';
}

function classifyEmailPriority(subject: string, from: string): string {
  const text = subject.toLowerCase();
  if (text.includes('urgent') || text.includes('critical') || text.includes('emergency')) return 'urgent';
  if (text.includes('important') || text.includes('action required')) return 'high';
  if (text.includes('fyi') || text.includes('newsletter')) return 'low';
  return 'normal';
}
