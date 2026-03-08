/**
 * Task — The universal work item.
 *
 * Every email, calendar event, social mention, store order, or manual request
 * becomes a Task. This is the lingua franca of the AI Operations OS.
 */

export type TaskSource = 'email' | 'calendar' | 'social' | 'store' | 'manual';

export type TaskIntent =
  | 'reply'
  | 'schedule'
  | 'post'
  | 'fulfill'
  | 'escalate'
  | 'ignore'
  | 'unknown';

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export type TaskStatus =
  | 'pending'
  | 'planned'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed';

export interface Task {
  /** Unique identifier (UUID v4) */
  id: string;

  /** Where this task originated */
  source: TaskSource;

  /** External ID from the source system (e.g., Gmail messageId, Shopify orderId) */
  sourceId?: string;

  /** LLM-classified intent — what should be done with this task */
  intent: TaskIntent;

  /** Short human-readable title */
  title: string;

  /** Full content / body text */
  body?: string;

  /** Urgency classification */
  priority: TaskPriority;

  /** Current lifecycle state */
  status: TaskStatus;

  /** Owner / assignee identifier */
  owner?: string;

  /** When this task is due (ISO 8601) */
  dueAt?: string;

  /** When this task was created (ISO 8601) */
  createdAt: string;

  /** Last modification timestamp (ISO 8601) */
  updatedAt: string;

  /** Source-specific metadata (e.g., email headers, order line items) */
  metadata: Record<string, unknown>;
}

/**
 * Create a new Task with sensible defaults.
 */
export function createTask(partial: Partial<Task> & Pick<Task, 'source' | 'title'>): Task {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    intent: 'unknown',
    body: undefined,
    priority: 'normal',
    status: 'pending',
    owner: undefined,
    dueAt: undefined,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
