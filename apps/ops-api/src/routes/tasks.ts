/**
 * Task Routes — CRUD for the universal Task model.
 *
 * GET    /api/tasks          List all tasks (with optional filters)
 * GET    /api/tasks/:id      Get a single task
 * POST   /api/tasks          Create a new task
 * PATCH  /api/tasks/:id      Update a task
 * DELETE /api/tasks/:id      Delete a task (soft — marks as failed)
 */

import type { Task, TaskSource, TaskIntent, TaskPriority } from '@ai-ops/shared-types';
import { createTask } from '@ai-ops/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import { stores } from '../storage';

// ── Route handlers ───────────────────────────────────────────────────────────

/** List tasks with optional filtering */
async function listTasks(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const limit = parseInt(query.limit || '50', 10);
  const offset = parseInt(query.offset || '0', 10);

  const filter = {
    status: query.status,
    source: query.source,
    intent: query.intent,
    priority: query.priority,
    limit,
    offset,
  };

  const result = stores.tasks.list(filter);
  const total = stores.tasks.count(filter);

  sendJson(res, 200, {
    tasks: result,
    total,
    limit,
    offset,
  });
}

/** Get a single task by ID */
async function getTask(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const task = stores.tasks.get(params.id);
  if (!task) {
    sendError(res, 404, `Task not found: ${params.id}`);
    return;
  }
  sendJson(res, 200, task);
}

/** Create a new task */
async function createTaskHandler(ctx: any): Promise<void> {
  const { res, body } = ctx;

  if (!body.source || !body.title) {
    sendError(res, 400, 'Missing required fields: source, title');
    return;
  }

  const task = createTask({
    source: body.source as TaskSource,
    title: body.title as string,
    body: body.body as string | undefined,
    intent: (body.intent as TaskIntent) || 'unknown',
    priority: (body.priority as TaskPriority) || 'normal',
    sourceId: body.sourceId as string | undefined,
    owner: body.owner as string | undefined,
    dueAt: body.dueAt as string | undefined,
    metadata: (body.metadata as Record<string, unknown>) || {},
  });

  stores.tasks.save(task);
  sendJson(res, 201, task);
}

/** Update a task */
async function updateTask(ctx: any): Promise<void> {
  const { res, params, body } = ctx;

  const existing = stores.tasks.get(params.id);
  if (!existing) {
    sendError(res, 404, `Task not found: ${params.id}`);
    return;
  }

  const allowedFields = [
    'intent', 'title', 'body', 'priority', 'status',
    'owner', 'dueAt', 'metadata',
  ] as const;

  const updates: Partial<Task> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      (updates as any)[field] = body[field];
    }
  }

  const updated = stores.tasks.update(params.id, updates);
  sendJson(res, 200, updated);
}

/** Delete (soft-delete) a task */
async function deleteTask(ctx: any): Promise<void> {
  const { res, params } = ctx;

  const existing = stores.tasks.get(params.id);
  if (!existing) {
    sendError(res, 404, `Task not found: ${params.id}`);
    return;
  }

  stores.tasks.update(params.id, { status: 'failed' });
  sendJson(res, 200, { deleted: true, id: params.id });
}

// ── Export routes ────────────────────────────────────────────────────────────

export const taskRoutes: Route[] = [
  pathToRoute('GET', '/api/tasks', listTasks),
  pathToRoute('GET', '/api/tasks/:id', getTask),
  pathToRoute('POST', '/api/tasks', createTaskHandler),
  pathToRoute('PATCH', '/api/tasks/:id', updateTask),
  pathToRoute('DELETE', '/api/tasks/:id', deleteTask),
];
