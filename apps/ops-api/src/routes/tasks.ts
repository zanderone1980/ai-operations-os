/**
 * Task Routes — CRUD for the universal Task model.
 *
 * GET    /api/tasks          List all tasks (with optional filters)
 * GET    /api/tasks/:id      Get a single task
 * POST   /api/tasks          Create a new task
 * PATCH  /api/tasks/:id      Update a task
 * DELETE /api/tasks/:id      Delete a task (soft — marks as failed)
 */

import type { Task, TaskSource, TaskIntent, TaskPriority, TaskStatus } from '@ai-ops/shared-types';
import { createTask } from '@ai-ops/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';

// ── In-memory store (replaced by persistent store in production) ─────────────

const tasks = new Map<string, Task>();

// ── Route handlers ───────────────────────────────────────────────────────────

/** List tasks with optional filtering */
async function listTasks(ctx: Parameters<typeof sendJson extends (res: infer R, ...args: any[]) => any ? never : never>[0] extends never ? any : any): Promise<void> {
  const { res, query } = ctx;
  let result = Array.from(tasks.values());

  // Filter by status
  if (query.status) {
    result = result.filter((t) => t.status === query.status);
  }

  // Filter by source
  if (query.source) {
    result = result.filter((t) => t.source === query.source);
  }

  // Filter by intent
  if (query.intent) {
    result = result.filter((t) => t.intent === query.intent);
  }

  // Filter by priority
  if (query.priority) {
    result = result.filter((t) => t.priority === query.priority);
  }

  // Sort by updatedAt descending
  result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Pagination
  const limit = parseInt(query.limit || '50', 10);
  const offset = parseInt(query.offset || '0', 10);
  const paged = result.slice(offset, offset + limit);

  sendJson(res, 200, {
    tasks: paged,
    total: result.length,
    limit,
    offset,
  });
}

/** Get a single task by ID */
async function getTask(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const task = tasks.get(params.id);
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

  tasks.set(task.id, task);
  sendJson(res, 201, task);
}

/** Update a task */
async function updateTask(ctx: any): Promise<void> {
  const { res, params, body } = ctx;
  const task = tasks.get(params.id);
  if (!task) {
    sendError(res, 404, `Task not found: ${params.id}`);
    return;
  }

  const allowedFields = [
    'intent', 'title', 'body', 'priority', 'status',
    'owner', 'dueAt', 'metadata',
  ] as const;

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      (task as any)[field] = body[field];
    }
  }

  task.updatedAt = new Date().toISOString();
  tasks.set(task.id, task);
  sendJson(res, 200, task);
}

/** Delete (soft-delete) a task */
async function deleteTask(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const task = tasks.get(params.id);
  if (!task) {
    sendError(res, 404, `Task not found: ${params.id}`);
    return;
  }

  task.status = 'failed';
  task.updatedAt = new Date().toISOString();
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
