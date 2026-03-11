/**
 * Approval Routes — Human-in-the-loop approval inbox.
 *
 * GET    /api/approvals              List pending approvals
 * GET    /api/approvals/:id          Get a specific approval
 * POST   /api/approvals/:id/decide   Submit a decision (approve/deny/modify)
 * GET    /api/approvals/stream       SSE stream of new approval requests
 */

import type { Approval, ApprovalDecision } from '@ai-operations/shared-types';
import { createApproval } from '@ai-operations/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import { stores } from '../storage';
import { resolvePendingApproval } from '../middleware/spark-lifecycle';
import { validateBody, approvalDecisionSchema } from '../middleware/validate';
import type * as http from 'http';

// SSE subscribers for real-time updates
const sseClients = new Set<http.ServerResponse>();

/** Broadcast a new approval to all SSE subscribers */
function broadcastApproval(approval: Approval): void {
  const data = `data: ${JSON.stringify(approval)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── Route handlers ───────────────────────────────────────────────────────────

/** List pending approvals */
async function listApprovals(ctx: any): Promise<void> {
  const { res, query } = ctx;
  let result: Approval[];

  // By default, show only pending (undecided) approvals
  if (query.status === 'all') {
    result = stores.approvals.listAll({ risk: query.risk });
  } else if (query.status === 'decided') {
    // Get all and filter to decided ones
    result = stores.approvals.listAll({ risk: query.risk }).filter((a: Approval) => a.decision !== undefined);
  } else {
    result = stores.approvals.listPending();
    // Apply risk filter on pending if needed
    if (query.risk) {
      result = result.filter((a) => a.risk === query.risk);
    }
  }

  sendJson(res, 200, {
    approvals: result,
    pending: stores.approvals.countPending(),
    total: result.length,
  });
}

/** Get a specific approval */
async function getApproval(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const approval = stores.approvals.get(params.id);
  if (!approval) {
    sendError(res, 404, `Approval not found: ${params.id}`);
    return;
  }
  sendJson(res, 200, approval);
}

/** Submit a decision on an approval */
async function decideApproval(ctx: any): Promise<void> {
  const { res, params, body } = ctx;
  const approval = stores.approvals.get(params.id);
  if (!approval) {
    sendError(res, 404, `Approval not found: ${params.id}`);
    return;
  }

  if (approval.decision) {
    sendError(res, 400, `Approval already decided: ${approval.decision}`);
    return;
  }

  const validation = validateBody(approvalDecisionSchema)(body);
  if (!validation.ok) {
    sendError(res, 400, validation.error);
    return;
  }

  const decision = body.decision as ApprovalDecision;

  const decidedBy = (body.decidedBy as string) || 'user';

  stores.approvals.decide(
    params.id,
    decision,
    decidedBy,
    decision === 'modified' ? (body.modifications as Record<string, unknown>) : undefined,
  );

  stores.audit.log('approval.decided', {
    actorId: decidedBy,
    resourceType: 'approval',
    resourceId: params.id,
    details: { decision, taskId: approval.taskId, risk: approval.risk },
  });

  // ── SPARK: Learn from approval outcome ──
  // If this approval has a pending SPARK context, close the loop
  const sparkResult = resolvePendingApproval(params.id, decision);

  const updated = stores.approvals.get(params.id);
  sendJson(res, 200, {
    ...updated,
    spark: sparkResult ? {
      episode: sparkResult.episode,
      insights: sparkResult.insights,
      learned: true,
    } : undefined,
  });
}

/** Get approval history (decided approvals) */
async function getApprovalHistory(ctx: any): Promise<void> {
  const { res, query } = ctx;
  const limit = parseInt(query.limit || '50', 10);
  const allApprovals = stores.approvals.listAll({});
  const decided = allApprovals
    .filter((a: Approval) => a.decision !== undefined)
    .sort((a: Approval, b: Approval) => {
      const aTime = a.decidedAt ? new Date(a.decidedAt).getTime() : 0;
      const bTime = b.decidedAt ? new Date(b.decidedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);

  sendJson(res, 200, {
    history: decided,
    total: decided.length,
  });
}

/** Get pending approval count */
async function getApprovalCount(ctx: any): Promise<void> {
  const { res } = ctx;
  const pending = stores.approvals.countPending();
  const allApprovals = stores.approvals.listAll({});
  sendJson(res, 200, {
    pending,
    decided: allApprovals.filter((a: Approval) => a.decision !== undefined).length,
    total: allApprovals.length,
  });
}

/** SSE stream of new approval requests */
async function streamApprovals(ctx: any): Promise<void> {
  const { res } = ctx;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  sseClients.add(res);

  res.on('close', () => {
    sseClients.delete(res);
  });
}

// ── Public API for internal use ──────────────────────────────────────────────

/**
 * Create an approval request programmatically (used by workflow engine).
 */
export function requestApproval(
  actionId: string,
  taskId: string,
  risk: 'low' | 'medium' | 'high' | 'critical',
  reason: string,
  preview: string,
): Approval {
  const approval = createApproval(actionId, taskId, risk, reason, preview);
  stores.approvals.save(approval);
  broadcastApproval(approval);
  return approval;
}

/**
 * Wait for an approval decision (polls with timeout).
 */
export async function waitForDecision(
  approvalId: string,
  timeoutMs: number = 300_000, // 5 minutes
): Promise<Approval | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const approval = stores.approvals.get(approvalId);
    if (approval?.decision) return approval;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// ── Export routes ────────────────────────────────────────────────────────────

export const approvalRoutes: Route[] = [
  pathToRoute('GET', '/api/approvals', listApprovals),
  pathToRoute('GET', '/api/approvals/history', getApprovalHistory),
  pathToRoute('GET', '/api/approvals/count', getApprovalCount),
  pathToRoute('GET', '/api/approvals/stream', streamApprovals),
  pathToRoute('GET', '/api/approvals/:id', getApproval),
  pathToRoute('POST', '/api/approvals/:id/decide', decideApproval),
];
