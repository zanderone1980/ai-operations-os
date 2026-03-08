/**
 * Workflow Routes — Trigger, monitor, and manage workflow runs.
 *
 * POST   /api/workflows          Trigger a new workflow run for a task
 * GET    /api/workflows          List recent workflow runs
 * GET    /api/workflows/:id      Get a specific workflow run
 * POST   /api/workflows/:id/pause    Pause a running workflow
 * POST   /api/workflows/:id/resume   Resume a paused workflow
 */

import type { WorkflowRun } from '@ai-ops/shared-types';
import { createWorkflowRun, createStep } from '@ai-ops/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';

// ── In-memory store ──────────────────────────────────────────────────────────

const runs = new Map<string, WorkflowRun>();

// ── Route handlers ───────────────────────────────────────────────────────────

/** Trigger a new workflow run */
async function triggerWorkflow(ctx: any): Promise<void> {
  const { res, body } = ctx;

  if (!body.taskId || !body.workflowType) {
    sendError(res, 400, 'Missing required fields: taskId, workflowType');
    return;
  }

  const steps = Array.isArray(body.steps)
    ? (body.steps as any[]).map((s: any) => createStep(s.connector, s.operation, s.input || {}))
    : [];

  const run = createWorkflowRun(
    body.taskId as string,
    body.workflowType as string,
    steps,
  );

  runs.set(run.id, run);
  sendJson(res, 201, run);
}

/** List workflow runs */
async function listWorkflows(ctx: any): Promise<void> {
  const { res, query } = ctx;
  let result = Array.from(runs.values());

  if (query.taskId) {
    result = result.filter((r) => r.taskId === query.taskId);
  }

  if (query.state) {
    result = result.filter((r) => r.state === query.state);
  }

  // Sort by startedAt descending
  result.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const limit = parseInt(query.limit || '50', 10);
  const offset = parseInt(query.offset || '0', 10);
  sendJson(res, 200, {
    runs: result.slice(offset, offset + limit),
    total: result.length,
  });
}

/** Get a specific workflow run */
async function getWorkflow(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const run = runs.get(params.id);
  if (!run) {
    sendError(res, 404, `Workflow run not found: ${params.id}`);
    return;
  }
  sendJson(res, 200, run);
}

/** Pause a running workflow */
async function pauseWorkflow(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const run = runs.get(params.id);
  if (!run) {
    sendError(res, 404, `Workflow run not found: ${params.id}`);
    return;
  }
  if (run.state !== 'running') {
    sendError(res, 400, `Cannot pause workflow in state: ${run.state}`);
    return;
  }
  run.state = 'paused';
  sendJson(res, 200, run);
}

/** Resume a paused workflow */
async function resumeWorkflow(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const run = runs.get(params.id);
  if (!run) {
    sendError(res, 404, `Workflow run not found: ${params.id}`);
    return;
  }
  if (run.state !== 'paused') {
    sendError(res, 400, `Cannot resume workflow in state: ${run.state}`);
    return;
  }
  run.state = 'running';
  sendJson(res, 200, run);
}

// ── Export routes ────────────────────────────────────────────────────────────

export const workflowRoutes: Route[] = [
  pathToRoute('POST', '/api/workflows', triggerWorkflow),
  pathToRoute('GET', '/api/workflows', listWorkflows),
  pathToRoute('GET', '/api/workflows/:id', getWorkflow),
  pathToRoute('POST', '/api/workflows/:id/pause', pauseWorkflow),
  pathToRoute('POST', '/api/workflows/:id/resume', resumeWorkflow),
];
