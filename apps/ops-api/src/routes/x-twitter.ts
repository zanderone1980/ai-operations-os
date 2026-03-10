/**
 * X/Twitter Routes — End-to-end X/Twitter pipeline.
 *
 * GET   /api/x/timeline        Get user's timeline
 * POST  /api/x/post            Post a tweet through the full pipeline:
 *                                 classify -> policy -> CORD safety -> approve -> execute -> receipt
 * POST  /api/x/reply           Reply to a tweet through the full pipeline
 * POST  /api/x/dm              Send a DM through the full pipeline
 * GET   /api/x/dm              Read DMs
 *
 * Credentials are loaded from environment variables:
 *   X_API_KEY  — Bearer token for X API v2
 *   X_USER_ID  — Authenticated user's X/Twitter user ID
 */

import { XTwitterConnector } from '@ai-ops/ops-connectors';
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

// ── Singletons ────────────────────────────────────────────────────────────────

const classifier = new IntentClassifier();
const ruleEngine = new RuleEngine(DEFAULT_POLICY);
const HMAC_KEY = process.env.CORD_HMAC_KEY || 'ai-ops-dev-key';

/**
 * Create an X/Twitter connector with credentials from env vars.
 * Returns null if X_API_KEY is not configured.
 */
function getXTwitterConnector(): XTwitterConnector | null {
  const bearerToken = process.env.X_API_KEY;
  if (!bearerToken) return null;

  return new XTwitterConnector({
    credentials: {
      bearerToken,
      userId: process.env.X_USER_ID || '',
    },
  });
}

// ── Route Handlers ──────────────────────────────────────────────────────────

/**
 * GET /api/x/timeline — Get user's timeline.
 * Query: ?limit=10
 */
async function getTimeline(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const x = getXTwitterConnector();
  if (!x) {
    sendError(res, 401, 'X/Twitter not configured. Set X_API_KEY environment variable.');
    return;
  }

  const result = await x.execute('timeline', {
    maxResults: parseInt(query.limit || '10', 10),
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to fetch timeline');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * POST /api/x/post — Post a tweet through the full pipeline.
 *
 * Body: { text: string, autoApprove?: boolean }
 *
 * Returns the complete pipeline result with receipt chain:
 * {
 *   task, intent, policy, safety, approval,
 *   execution, receipts, receiptChainValid
 * }
 */
async function postTweet(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const text = body.text as string;
  const autoApprove = body.autoApprove === true;

  if (!text) {
    sendError(res, 400, 'Missing required field: text');
    return;
  }

  const x = getXTwitterConnector();
  if (!x) {
    sendError(res, 401, 'X/Twitter not configured. Set X_API_KEY environment variable.');
    return;
  }

  const receiptBuilder = new ReceiptBuilder();
  const policyVersion = DEFAULT_POLICY.version;

  // ── Step 1: Classify intent ──────────────────────────────────────
  const classification = classifier.classifyDetailed(text);

  const task = createTask({
    source: 'social' as TaskSource,
    title: `Tweet: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`,
    body: text,
    sourceId: `tweet-${Date.now()}`,
    intent: classification.intent,
    metadata: {
      platform: 'x-twitter',
      operation: 'post',
      classificationConfidence: classification.confidence,
      classificationKeywords: classification.matchedKeywords,
    },
  });

  // ── SPARK: Predict risk before safety evaluation ──
  const sparkPrediction = sparkPredict(task.id, 'x-twitter', 'post');
  const execStart = Date.now();

  // ── Step 2: Evaluate policy ──────────────────────────────────────
  const policyResult = ruleEngine.evaluate('x-twitter', 'post', { source: 'social' });

  // ── Step 3: Evaluate CORD safety ─────────────────────────────────
  const postInput = { text };
  const postSafety = evaluateAction('x-twitter', 'post', postInput);

  const needsApproval = postSafety.decision === 'CHALLENGE'
    || policyResult.autonomy === 'approve';
  const isBlocked = postSafety.decision === 'BLOCK'
    || policyResult.autonomy === 'deny';

  // Receipt for classification
  receiptBuilder.addStep({
    actionId: `classify-tweet-${task.id}`,
    policyVersion,
    cordDecision: postSafety.decision as CordDecision,
    cordScore: postSafety.score,
    cordReasons: postSafety.reasons,
    input: { text },
    output: { intent: classification.intent, confidence: classification.confidence },
  });

  // ── Step 4: Check if blocked ─────────────────────────────────────
  if (isBlocked) {
    const blockResult = sparkLearn({
      stepId: task.id, connector: 'x-twitter', operation: 'post',
      cordScore: postSafety.score, cordDecision: postSafety.decision as CordDecision,
      success: false, durationMs: Date.now() - execStart,
    });

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: { decision: postSafety.decision, score: postSafety.score, reasons: postSafety.reasons },
      blocked: true,
      reason: policyResult.autonomy === 'deny'
        ? `Policy denied: ${policyResult.reason}`
        : `CORD blocked: ${postSafety.reasons.join(', ')}`,
      receipts: receiptBuilder.finalize(HMAC_KEY),
      spark: blockResult ? { prediction: sparkPrediction, episode: blockResult.episode, insights: blockResult.insights } : { prediction: sparkPrediction },
    });
    return;
  }

  // ── Step 5: Approval gate ────────────────────────────────────────
  if (needsApproval && !autoApprove) {
    const approval = requestApproval(
      `post-tweet-${task.id}`,
      task.id,
      policyResult.risk as 'low' | 'medium' | 'high' | 'critical',
      needsApproval && postSafety.decision === 'CHALLENGE'
        ? `CORD challenge (score: ${postSafety.score})`
        : `Policy requires approval: ${policyResult.reason}`,
      `Tweet: ${text.slice(0, 140)}`,
    );

    registerPendingApproval(approval.id, {
      stepId: task.id, connector: 'x-twitter', operation: 'post',
      cordScore: postSafety.score, cordDecision: postSafety.decision as CordDecision,
    });

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: { decision: postSafety.decision, score: postSafety.score, reasons: postSafety.reasons },
      approval: { needed: true, decision: 'pending', approvalId: approval.id },
      message: 'Approval required. Decide at POST /api/approvals/:id/decide',
      receipts: receiptBuilder.finalize(HMAC_KEY),
      spark: { prediction: sparkPrediction },
    });
    return;
  }

  // ── Step 6: Execute post ─────────────────────────────────────────
  const postResult = await x.execute('post', { text });

  const execution = {
    success: postResult.success,
    data: postResult.data,
    error: postResult.error,
  };

  // Receipt for post operation
  receiptBuilder.addStep({
    actionId: `post-tweet-${task.id}`,
    policyVersion,
    cordDecision: postSafety.decision as CordDecision,
    cordScore: postSafety.score,
    cordReasons: postSafety.reasons,
    input: { text },
    output: postResult.data || {},
  });

  // ── Step 7: Build receipt chain ──────────────────────────────────
  const receipts = receiptBuilder.finalize(HMAC_KEY);
  const chainValid = verifyReceiptChain(receipts, HMAC_KEY);

  // ── SPARK: Learn from outcome ──
  const sparkResult = sparkLearn({
    stepId: task.id,
    connector: 'x-twitter',
    operation: 'post',
    cordScore: postSafety.score,
    cordDecision: postSafety.decision as any,
    success: execution.success,
    wasApproved: autoApprove,
    durationMs: Date.now() - execStart,
    error: execution.error,
  });

  sendJson(res, 200, {
    task,
    intent: classification,
    policy: policyResult,
    safety: {
      decision: postSafety.decision,
      score: postSafety.score,
      reasons: postSafety.reasons,
    },
    approval: { needed: needsApproval, decision: autoApprove ? 'auto-approved' : 'not-required' },
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
 * POST /api/x/reply — Reply to a tweet through the full pipeline.
 *
 * Body: { text: string, tweetId: string, autoApprove?: boolean }
 */
async function replyToTweet(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const text = body.text as string;
  const tweetId = body.tweetId as string;
  const autoApprove = body.autoApprove === true;

  if (!text || !tweetId) {
    sendError(res, 400, 'Missing required fields: text, tweetId');
    return;
  }

  const x = getXTwitterConnector();
  if (!x) {
    sendError(res, 401, 'X/Twitter not configured. Set X_API_KEY environment variable.');
    return;
  }

  const receiptBuilder = new ReceiptBuilder();
  const policyVersion = DEFAULT_POLICY.version;

  // ── Step 1: Classify intent ──────────────────────────────────────
  const classification = classifier.classifyDetailed(text);

  const task = createTask({
    source: 'social' as TaskSource,
    title: `Reply to tweet ${tweetId}: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`,
    body: text,
    sourceId: `reply-${tweetId}-${Date.now()}`,
    intent: classification.intent,
    metadata: {
      platform: 'x-twitter',
      operation: 'reply',
      tweetId,
      classificationConfidence: classification.confidence,
      classificationKeywords: classification.matchedKeywords,
    },
  });

  // ── SPARK: Predict risk before safety evaluation ──
  const sparkPrediction = sparkPredict(task.id, 'x-twitter', 'reply');
  const execStart = Date.now();

  // ── Step 2: Evaluate policy ──────────────────────────────────────
  const policyResult = ruleEngine.evaluate('x-twitter', 'reply', { source: 'social' });

  // ── Step 3: Evaluate CORD safety ─────────────────────────────────
  const replyInput = { text, tweetId };
  const replySafety = evaluateAction('x-twitter', 'reply', replyInput);

  const needsApproval = replySafety.decision === 'CHALLENGE'
    || policyResult.autonomy === 'approve';
  const isBlocked = replySafety.decision === 'BLOCK'
    || policyResult.autonomy === 'deny';

  // Receipt for classification
  receiptBuilder.addStep({
    actionId: `classify-reply-${tweetId}`,
    policyVersion,
    cordDecision: replySafety.decision as CordDecision,
    cordScore: replySafety.score,
    cordReasons: replySafety.reasons,
    input: { text, tweetId },
    output: { intent: classification.intent, confidence: classification.confidence },
  });

  // ── Step 4: Check if blocked ─────────────────────────────────────
  if (isBlocked) {
    const blockResult = sparkLearn({
      stepId: task.id, connector: 'x-twitter', operation: 'reply',
      cordScore: replySafety.score, cordDecision: replySafety.decision as CordDecision,
      success: false, durationMs: Date.now() - execStart,
    });

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: { decision: replySafety.decision, score: replySafety.score, reasons: replySafety.reasons },
      blocked: true,
      reason: policyResult.autonomy === 'deny'
        ? `Policy denied: ${policyResult.reason}`
        : `CORD blocked: ${replySafety.reasons.join(', ')}`,
      receipts: receiptBuilder.finalize(HMAC_KEY),
      spark: blockResult ? { prediction: sparkPrediction, episode: blockResult.episode, insights: blockResult.insights } : { prediction: sparkPrediction },
    });
    return;
  }

  // ── Step 5: Approval gate ────────────────────────────────────────
  if (needsApproval && !autoApprove) {
    const approval = requestApproval(
      `reply-tweet-${tweetId}`,
      task.id,
      policyResult.risk as 'low' | 'medium' | 'high' | 'critical',
      needsApproval && replySafety.decision === 'CHALLENGE'
        ? `CORD challenge (score: ${replySafety.score})`
        : `Policy requires approval: ${policyResult.reason}`,
      `Reply to tweet ${tweetId}: ${text.slice(0, 140)}`,
    );

    registerPendingApproval(approval.id, {
      stepId: task.id, connector: 'x-twitter', operation: 'reply',
      cordScore: replySafety.score, cordDecision: replySafety.decision as CordDecision,
    });

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: { decision: replySafety.decision, score: replySafety.score, reasons: replySafety.reasons },
      approval: { needed: true, decision: 'pending', approvalId: approval.id },
      message: 'Approval required. Decide at POST /api/approvals/:id/decide',
      receipts: receiptBuilder.finalize(HMAC_KEY),
      spark: { prediction: sparkPrediction },
    });
    return;
  }

  // ── Step 6: Execute reply ────────────────────────────────────────
  const replyResult = await x.execute('reply', { text, tweetId });

  const execution = {
    success: replyResult.success,
    data: replyResult.data,
    error: replyResult.error,
  };

  // Receipt for reply operation
  receiptBuilder.addStep({
    actionId: `reply-tweet-${tweetId}`,
    policyVersion,
    cordDecision: replySafety.decision as CordDecision,
    cordScore: replySafety.score,
    cordReasons: replySafety.reasons,
    input: { text, tweetId },
    output: replyResult.data || {},
  });

  // ── Step 7: Build receipt chain ──────────────────────────────────
  const receipts = receiptBuilder.finalize(HMAC_KEY);
  const chainValid = verifyReceiptChain(receipts, HMAC_KEY);

  // ── SPARK: Learn from outcome ──
  const sparkResult = sparkLearn({
    stepId: task.id,
    connector: 'x-twitter',
    operation: 'reply',
    cordScore: replySafety.score,
    cordDecision: replySafety.decision as any,
    success: execution.success,
    wasApproved: autoApprove,
    durationMs: Date.now() - execStart,
    error: execution.error,
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
    approval: { needed: needsApproval, decision: autoApprove ? 'auto-approved' : 'not-required' },
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
 * POST /api/x/dm — Send a DM through the full pipeline.
 *
 * Body: { participantId: string, text: string, autoApprove?: boolean }
 */
async function sendDm(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const participantId = body.participantId as string;
  const text = body.text as string;
  const autoApprove = body.autoApprove === true;

  if (!participantId || !text) {
    sendError(res, 400, 'Missing required fields: participantId, text');
    return;
  }

  const x = getXTwitterConnector();
  if (!x) {
    sendError(res, 401, 'X/Twitter not configured. Set X_API_KEY environment variable.');
    return;
  }

  const receiptBuilder = new ReceiptBuilder();
  const policyVersion = DEFAULT_POLICY.version;

  // ── Step 1: Classify intent ──────────────────────────────────────
  const classification = classifier.classifyDetailed(text);

  const task = createTask({
    source: 'social' as TaskSource,
    title: `DM to ${participantId}: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`,
    body: text,
    sourceId: `dm-${participantId}-${Date.now()}`,
    intent: classification.intent,
    metadata: {
      platform: 'x-twitter',
      operation: 'dm_send',
      participantId,
      classificationConfidence: classification.confidence,
      classificationKeywords: classification.matchedKeywords,
    },
  });

  // ── SPARK: Predict risk before safety evaluation ──
  const sparkPrediction = sparkPredict(task.id, 'x-twitter', 'dm_send');
  const execStart = Date.now();

  // ── Step 2: Evaluate policy ──────────────────────────────────────
  const policyResult = ruleEngine.evaluate('x-twitter', 'dm_send', { source: 'social' });

  // ── Step 3: Evaluate CORD safety ─────────────────────────────────
  const dmInput = { participantId, text };
  const dmSafety = evaluateAction('x-twitter', 'dm_send', dmInput);

  const needsApproval = dmSafety.decision === 'CHALLENGE'
    || policyResult.autonomy === 'approve';
  const isBlocked = dmSafety.decision === 'BLOCK'
    || policyResult.autonomy === 'deny';

  // Receipt for classification
  receiptBuilder.addStep({
    actionId: `classify-dm-${participantId}`,
    policyVersion,
    cordDecision: dmSafety.decision as CordDecision,
    cordScore: dmSafety.score,
    cordReasons: dmSafety.reasons,
    input: { participantId, text },
    output: { intent: classification.intent, confidence: classification.confidence },
  });

  // ── Step 4: Check if blocked ─────────────────────────────────────
  if (isBlocked) {
    const blockResult = sparkLearn({
      stepId: task.id, connector: 'x-twitter', operation: 'dm_send',
      cordScore: dmSafety.score, cordDecision: dmSafety.decision as CordDecision,
      success: false, durationMs: Date.now() - execStart,
    });

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: { decision: dmSafety.decision, score: dmSafety.score, reasons: dmSafety.reasons },
      blocked: true,
      reason: policyResult.autonomy === 'deny'
        ? `Policy denied: ${policyResult.reason}`
        : `CORD blocked: ${dmSafety.reasons.join(', ')}`,
      receipts: receiptBuilder.finalize(HMAC_KEY),
      spark: blockResult ? { prediction: sparkPrediction, episode: blockResult.episode, insights: blockResult.insights } : { prediction: sparkPrediction },
    });
    return;
  }

  // ── Step 5: Approval gate ────────────────────────────────────────
  if (needsApproval && !autoApprove) {
    const approval = requestApproval(
      `dm-send-${participantId}-${task.id}`,
      task.id,
      policyResult.risk as 'low' | 'medium' | 'high' | 'critical',
      needsApproval && dmSafety.decision === 'CHALLENGE'
        ? `CORD challenge (score: ${dmSafety.score})`
        : `Policy requires approval: ${policyResult.reason}`,
      `DM to ${participantId}: ${text.slice(0, 140)}`,
    );

    registerPendingApproval(approval.id, {
      stepId: task.id, connector: 'x-twitter', operation: 'dm_send',
      cordScore: dmSafety.score, cordDecision: dmSafety.decision as CordDecision,
    });

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: { decision: dmSafety.decision, score: dmSafety.score, reasons: dmSafety.reasons },
      approval: { needed: true, decision: 'pending', approvalId: approval.id },
      message: 'Approval required. Decide at POST /api/approvals/:id/decide',
      receipts: receiptBuilder.finalize(HMAC_KEY),
      spark: { prediction: sparkPrediction },
    });
    return;
  }

  // ── Step 6: Execute DM send ──────────────────────────────────────
  const dmResult = await x.execute('dm_send', { participantId, text });

  const execution = {
    success: dmResult.success,
    data: dmResult.data,
    error: dmResult.error,
  };

  // Receipt for DM send operation
  receiptBuilder.addStep({
    actionId: `dm-send-${participantId}`,
    policyVersion,
    cordDecision: dmSafety.decision as CordDecision,
    cordScore: dmSafety.score,
    cordReasons: dmSafety.reasons,
    input: { participantId, text },
    output: dmResult.data || {},
  });

  // ── Step 7: Build receipt chain ──────────────────────────────────
  const receipts = receiptBuilder.finalize(HMAC_KEY);
  const chainValid = verifyReceiptChain(receipts, HMAC_KEY);

  // ── SPARK: Learn from outcome ──
  const sparkResult = sparkLearn({
    stepId: task.id,
    connector: 'x-twitter',
    operation: 'dm_send',
    cordScore: dmSafety.score,
    cordDecision: dmSafety.decision as any,
    success: execution.success,
    wasApproved: autoApprove,
    durationMs: Date.now() - execStart,
    error: execution.error,
  });

  sendJson(res, 200, {
    task,
    intent: classification,
    policy: policyResult,
    safety: {
      decision: dmSafety.decision,
      score: dmSafety.score,
      reasons: dmSafety.reasons,
    },
    approval: { needed: needsApproval, decision: autoApprove ? 'auto-approved' : 'not-required' },
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
 * GET /api/x/dm — Read DMs.
 * Query: ?limit=20
 */
async function readDms(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const x = getXTwitterConnector();
  if (!x) {
    sendError(res, 401, 'X/Twitter not configured. Set X_API_KEY environment variable.');
    return;
  }

  const result = await x.execute('dm_read', {
    maxResults: parseInt(query.limit || '20', 10),
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to read DMs');
    return;
  }

  sendJson(res, 200, result.data);
}

// ── Export routes ────────────────────────────────────────────────────────────

export const xTwitterRoutes: Route[] = [
  pathToRoute('GET', '/api/x/timeline', getTimeline),
  pathToRoute('POST', '/api/x/post', postTweet),
  pathToRoute('POST', '/api/x/reply', replyToTweet),
  pathToRoute('POST', '/api/x/dm', sendDm),
  pathToRoute('GET', '/api/x/dm', readDms),
];
