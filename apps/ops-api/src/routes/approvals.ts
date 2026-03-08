/**
 * Approval Routes — Human-in-the-loop approval inbox.
 *
 * GET    /api/approvals              List pending approvals
 * GET    /api/approvals/:id          Get a specific approval
 * POST   /api/approvals/:id/decide   Submit a decision (approve/deny/modify)
 * GET    /api/approvals/stream       SSE stream of new approval requests
 */

import type { Approval, ApprovalDecision } from '@ai-ops/shared-types';
import { createApproval } from '@ai-ops/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import type * as http from 'http';

// ── In-memory store ──────────────────────────────────────────────────────────

const approvals = new Map<string, Approval>();

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
  let result = Array.from(approvals.values());

  // By default, show only pending (undecided) approvals
  if (query.status === 'all') {
    // Show all
  } else if (query.status === 'decided') {
    result = result.filter((a) => a.decision !== undefined);
  } else {
    result = result.filter((a) => a.decision === undefined);
  }

  // Filter by risk
  if (query.risk) {
    result = result.filter((a) => a.risk === query.risk);
  }

  // Sort by requestedAt descending
  result.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

  sendJson(res, 200, {
    approvals: result,
    pending: result.filter((a) => !a.decision).length,
    total: result.length,
  });
}

/** Get a specific approval */
async function getApproval(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const approval = approvals.get(params.id);
  if (!approval) {
    sendError(res, 404, `Approval not found: ${params.id}`);
    return;
  }
  sendJson(res, 200, approval);
}

/** Submit a decision on an approval */
async function decideApproval(ctx: any): Promise<void> {
  const { res, params, body } = ctx;
  const approval = approvals.get(params.id);
  if (!approval) {
    sendError(res, 404, `Approval not found: ${params.id}`);
    return;
  }

  if (approval.decision) {
    sendError(res, 400, `Approval already decided: ${approval.decision}`);
    return;
  }

  const decision = body.decision as ApprovalDecision;
  if (!decision || !['approved', 'denied', 'modified'].includes(decision)) {
    sendError(res, 400, 'Invalid decision. Must be: approved, denied, or modified');
    return;
  }

  approval.decision = decision;
  approval.decidedBy = (body.decidedBy as string) || 'user';
  approval.decidedAt = new Date().toISOString();

  if (decision === 'modified' && body.modifications) {
    approval.modifications = body.modifications as Record<string, unknown>;
  }

  sendJson(res, 200, approval);
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
  approvals.set(approval.id, approval);
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
    const approval = approvals.get(approvalId);
    if (approval?.decision) return approval;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// ── Export routes ────────────────────────────────────────────────────────────

export const approvalRoutes: Route[] = [
  pathToRoute('GET', '/api/approvals', listApprovals),
  pathToRoute('GET', '/api/approvals/stream', streamApprovals),
  pathToRoute('GET', '/api/approvals/:id', getApproval),
  pathToRoute('POST', '/api/approvals/:id/decide', decideApproval),
];
