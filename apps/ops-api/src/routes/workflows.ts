/**
 * Workflow Routes — Trigger, monitor, and manage workflow runs.
 *
 * POST   /api/workflows          Trigger a new workflow run for a task
 * GET    /api/workflows          List recent workflow runs
 * GET    /api/workflows/:id      Get a specific workflow run
 * POST   /api/workflows/:id/pause    Pause a running workflow
 * POST   /api/workflows/:id/resume   Resume a paused workflow
 */

import { createWorkflowRun, createStep } from '@ai-ops/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import { stores } from '../storage';

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

  stores.workflows.saveRun(run);
  sendJson(res, 201, run);
}

/** List workflow runs */
async function listWorkflows(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const limit = parseInt(query.limit || '50', 10);
  const offset = parseInt(query.offset || '0', 10);

  const result = stores.workflows.listRuns({
    taskId: query.taskId,
    state: query.state,
    limit,
    offset,
  });

  sendJson(res, 200, {
    runs: result,
    total: result.length,
  });
}

/** Get a specific workflow run */
async function getWorkflow(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const run = stores.workflows.getRun(params.id);
  if (!run) {
    sendError(res, 404, `Workflow run not found: ${params.id}`);
    return;
  }
  sendJson(res, 200, run);
}

/** Pause a running workflow */
async function pauseWorkflow(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const run = stores.workflows.getRun(params.id);
  if (!run) {
    sendError(res, 404, `Workflow run not found: ${params.id}`);
    return;
  }
  if (run.state !== 'running') {
    sendError(res, 400, `Cannot pause workflow in state: ${run.state}`);
    return;
  }
  stores.workflows.updateRun(params.id, { state: 'paused' });
  const updated = stores.workflows.getRun(params.id);
  sendJson(res, 200, updated);
}

/** Resume a paused workflow */
async function resumeWorkflow(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const run = stores.workflows.getRun(params.id);
  if (!run) {
    sendError(res, 404, `Workflow run not found: ${params.id}`);
    return;
  }
  if (run.state !== 'paused') {
    sendError(res, 400, `Cannot resume workflow in state: ${run.state}`);
    return;
  }
  stores.workflows.updateRun(params.id, { state: 'running' });
  const updated = stores.workflows.getRun(params.id);
  sendJson(res, 200, updated);
}

// ── Export routes ────────────────────────────────────────────────────────────

export const workflowRoutes: Route[] = [
  pathToRoute('POST', '/api/workflows', triggerWorkflow),
  pathToRoute('GET', '/api/workflows', listWorkflows),
  pathToRoute('GET', '/api/workflows/:id', getWorkflow),
  pathToRoute('POST', '/api/workflows/:id/pause', pauseWorkflow),
  pathToRoute('POST', '/api/workflows/:id/resume', resumeWorkflow),
];
