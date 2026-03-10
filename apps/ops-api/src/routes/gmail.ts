/**
 * Gmail Routes — End-to-end Gmail pipeline.
 *
 * GET   /api/gmail/inbox             List inbox messages (requires OAuth)
 * GET   /api/gmail/message/:id       Read a specific message
 * POST  /api/gmail/process           Run a message through the full pipeline:
 *                                      read → classify → policy → safety → approve → reply → receipt
 * POST  /api/gmail/process/latest    Process the most recent unread message
 *
 * All endpoints dynamically load OAuth credentials from ~/.ai-ops/credentials.json
 * so the Gmail connector is always initialized with the freshest token.
 */

import { GmailConnector } from '@ai-ops/ops-connectors';
import { IntentClassifier } from '@ai-ops/ops-core';
import { RuleEngine } from '@ai-ops/ops-policy';
import {
  DEFAULT_POLICY,
  createTask,
  createApproval,
  verifyReceiptChain,
} from '@ai-ops/shared-types';
import type { TaskSource, CordDecision } from '@ai-ops/shared-types';
import { ReceiptBuilder } from '@ai-ops/codebot-adapter';
import { evaluateAction } from '../middleware/cord-gate';
import { sparkPredict, sparkLearn, registerPendingApproval } from '../middleware/spark-lifecycle';
import { requestApproval } from './approvals';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import { getGoogleAccessToken } from './oauth';

// ── Singletons ────────────────────────────────────────────────────────────────

const classifier = new IntentClassifier();
const ruleEngine = new RuleEngine(DEFAULT_POLICY);
const HMAC_KEY = process.env.CORD_HMAC_KEY || 'ai-ops-dev-key';

/**
 * Create a Gmail connector with fresh OAuth credentials.
 * Returns null if no credentials are available.
 */
async function getGmailConnector(): Promise<GmailConnector | null> {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) return null;

  return new GmailConnector({
    credentials: { accessToken },
  });
}

// ── Route Handlers ──────────────────────────────────────────────────────────

/**
 * GET /api/gmail/inbox — List inbox messages.
 * Query: ?limit=20&query=is:unread
 */
async function listInbox(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const gmail = await getGmailConnector();
  if (!gmail) {
    sendError(res, 401, 'Gmail not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  const result = await gmail.execute('list', {
    label: query.label || 'INBOX',
    maxResults: parseInt(query.limit || '20', 10),
    query: query.query,
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to list inbox');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * GET /api/gmail/message/:id — Read a specific message.
 */
async function readMessage(ctx: any): Promise<void> {
  const { res, params } = ctx;

  const gmail = await getGmailConnector();
  if (!gmail) {
    sendError(res, 401, 'Gmail not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  const result = await gmail.execute('read', { messageId: params.id });
  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to read message');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * POST /api/gmail/process — Full pipeline for a specific message.
 *
 * Body: { messageId: string, autoApprove?: boolean }
 *
 * Returns the complete pipeline result with receipt chain:
 * {
 *   task, intent, policy, safety, approval,
 *   execution, receipts, receiptChainValid
 * }
 */
async function processMessage(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const messageId = body.messageId as string;
  const autoApprove = body.autoApprove === true;

  if (!messageId) {
    sendError(res, 400, 'Missing required field: messageId');
    return;
  }

  const gmail = await getGmailConnector();
  if (!gmail) {
    sendError(res, 401, 'Gmail not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  const receiptBuilder = new ReceiptBuilder();
  const policyVersion = DEFAULT_POLICY.version;

  // ── Step 1: Read the email ───────────────────────────────────────
  const readResult = await gmail.execute('read', { messageId });
  if (!readResult.success) {
    sendError(res, 502, readResult.error || 'Failed to read message');
    return;
  }

  const email = readResult.data!;
  const subject = (email.subject as string) || '';
  const emailBody = (email.body as string) || '';
  const from = (email.from as string) || '';
  const threadId = (email.threadId as string) || '';

  // Receipt for read operation
  const readSafety = evaluateAction('gmail', 'read', { messageId });
  receiptBuilder.addStep({
    actionId: `read-${messageId}`,
    policyVersion,
    cordDecision: readSafety.decision as CordDecision,
    cordScore: readSafety.score,
    cordReasons: readSafety.reasons,
    input: { messageId },
    output: { subject, from, snippet: (email.snippet as string) || '' },
  });

  // ── Step 2: Classify intent ──────────────────────────────────────
  const intentText = `${subject} ${emailBody}`;
  const classification = classifier.classifyDetailed(intentText);

  const task = createTask({
    source: 'email' as TaskSource,
    title: subject || `Email from ${from}`,
    body: emailBody,
    sourceId: messageId,
    intent: classification.intent,
    metadata: {
      from,
      threadId,
      messageId,
      subject,
      classificationConfidence: classification.confidence,
      classificationKeywords: classification.matchedKeywords,
    },
  });

  // ── SPARK: Predict risk before safety evaluation ──
  const sparkPrediction = sparkPredict(messageId, 'gmail', classification.intent || 'read');
  const execStart = Date.now();

  // ── Step 3: Evaluate policy ──────────────────────────────────────
  // Determine the connector operation based on intent
  const operation = classification.intent === 'reply' ? 'reply' : 'read';
  const policyResult = ruleEngine.evaluate('gmail', operation, { source: 'email' });

  // ── Step 4: Evaluate CORD safety ─────────────────────────────────
  const replyInput = {
    threadId,
    to: from,
    body: '[AI-drafted reply — pending approval]',
  };
  const replySafety = evaluateAction('gmail', operation, replyInput);

  const needsApproval = replySafety.decision === 'CHALLENGE'
    || policyResult.autonomy === 'approve';
  const isBlocked = replySafety.decision === 'BLOCK'
    || policyResult.autonomy === 'deny';

  // ── Step 5: Approval gate ────────────────────────────────────────
  let approvalResult: { needed: boolean; decision?: string; approvalId?: string } = {
    needed: needsApproval,
  };

  if (isBlocked) {
    // SPARK learns from blocked actions (action failed to proceed)
    const blockResult = sparkLearn({
      stepId: messageId,
      connector: 'gmail',
      operation: classification.intent || 'read',
      cordScore: replySafety.score,
      cordDecision: replySafety.decision as CordDecision,
      success: false,
      durationMs: Date.now() - execStart,
    });

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: {
        decision: replySafety.decision,
        score: replySafety.score,
        reasons: replySafety.reasons,
      },
      blocked: true,
      reason: policyResult.autonomy === 'deny'
        ? `Policy denied: ${policyResult.reason}`
        : `CORD blocked: ${replySafety.reasons.join(', ')}`,
      receipts: receiptBuilder.finalize(HMAC_KEY),
      spark: blockResult ? {
        prediction: sparkPrediction,
        episode: blockResult.episode,
        insights: blockResult.insights,
      } : { prediction: sparkPrediction },
    });
    return;
  }

  if (needsApproval && !autoApprove) {
    // Create approval but don't wait — return immediately with approval info
    const approval = requestApproval(
      `reply-${messageId}`,
      task.id,
      policyResult.risk as 'low' | 'medium' | 'high' | 'critical',
      needsApproval && replySafety.decision === 'CHALLENGE'
        ? `CORD challenge (score: ${replySafety.score})`
        : `Policy requires approval: ${policyResult.reason}`,
      `Reply to ${from}: Re: ${subject}`,
    );

    approvalResult = {
      needed: true,
      decision: 'pending',
      approvalId: approval.id,
    };

    // Register SPARK context so approval decision can trigger learning
    registerPendingApproval(approval.id, {
      stepId: messageId,
      connector: 'gmail',
      operation: classification.intent || 'read',
      cordScore: replySafety.score,
      cordDecision: replySafety.decision as CordDecision,
    });

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: {
        decision: replySafety.decision,
        score: replySafety.score,
        reasons: replySafety.reasons,
      },
      approval: approvalResult,
      message: 'Approval required. Decide at POST /api/approvals/:id/decide',
      receipts: receiptBuilder.finalize(HMAC_KEY),
      spark: { prediction: sparkPrediction },
    });
    return;
  }

  // ── Step 6: Execute reply (auto-approved or explicitly approved) ──
  let execution: { success: boolean; data?: Record<string, unknown>; error?: string; simulated?: boolean };

  if (classification.intent === 'reply') {
    const draftBody = `Thank you for reaching out regarding "${subject}". I've received your message and will get back to you with a detailed response shortly.\n\nBest regards`;

    const replyResult = await gmail.execute('reply', {
      threadId,
      body: draftBody,
    });

    execution = {
      success: replyResult.success,
      data: replyResult.data,
      error: replyResult.error,
    };

    // Receipt for reply operation
    receiptBuilder.addStep({
      actionId: `reply-${messageId}`,
      policyVersion,
      cordDecision: replySafety.decision as CordDecision,
      cordScore: replySafety.score,
      cordReasons: replySafety.reasons,
      input: { threadId, to: from, subject: `Re: ${subject}` },
      output: replyResult.data || {},
    });
  } else {
    execution = {
      success: true,
      data: { action: 'classified', intent: classification.intent },
      simulated: true,
    };
  }

  // ── Step 7: Build receipt chain ──────────────────────────────────
  const receipts = receiptBuilder.finalize(HMAC_KEY);
  const chainValid = verifyReceiptChain(receipts, HMAC_KEY);

  // ── SPARK: Learn from outcome ──
  const sparkResult = sparkLearn({
    stepId: messageId,
    connector: 'gmail',
    operation: classification.intent || 'read',
    cordScore: replySafety?.score ?? readSafety?.score ?? 0,
    cordDecision: replySafety?.decision ?? readSafety?.decision ?? 'ALLOW',
    success: execution?.success ?? true,
    wasApproved: !!approvalResult?.decision && approvalResult.decision === 'approved',
    durationMs: Date.now() - execStart,
    error: execution?.error,
  });

  sendJson(res, 200, {
    task,
    intent: classification,
    policy: policyResult,
    safety: {
      decision: replySafety.decision,
      score: replySafety.score,
      reasons: replySafety.reasons,
    },
    approval: approvalResult,
    execution,
    receipts,
    receiptChainValid: chainValid.valid,
    spark: sparkResult ? {
      prediction: sparkPrediction,
      episode: sparkResult.episode,
      insights: sparkResult.insights,
    } : { prediction: sparkPrediction },
  });
}

/**
 * POST /api/gmail/process/latest — Process the most recent unread message.
 *
 * Body: { autoApprove?: boolean }
 */
async function processLatest(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const gmail = await getGmailConnector();
  if (!gmail) {
    sendError(res, 401, 'Gmail not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  // Fetch latest unread message
  const listResult = await gmail.execute('list', {
    label: 'INBOX',
    maxResults: 1,
    query: 'is:unread',
  });

  if (!listResult.success) {
    sendError(res, 502, listResult.error || 'Failed to list inbox');
    return;
  }

  const messages = (listResult.data?.messages as Array<{ id: string }>) || [];
  if (messages.length === 0) {
    sendJson(res, 200, { message: 'No unread messages in inbox' });
    return;
  }

  // Delegate to processMessage with the first message ID
  ctx.body = { messageId: messages[0].id, autoApprove: body.autoApprove };
  return processMessage(ctx);
}

// ── Export routes ────────────────────────────────────────────────────────────

export const gmailRoutes: Route[] = [
  pathToRoute('GET', '/api/gmail/inbox', listInbox),
  pathToRoute('GET', '/api/gmail/message/:id', readMessage),
  pathToRoute('POST', '/api/gmail/process', processMessage),
  pathToRoute('POST', '/api/gmail/process/latest', processLatest),
];
