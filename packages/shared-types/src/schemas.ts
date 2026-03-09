/**
 * JSON Schema definitions for AI Operations OS API contracts.
 *
 * These schemas mirror the TypeScript interfaces and can be used for
 * runtime validation, OpenAPI generation, and cross-language interop.
 *
 * Format: JSON Schema draft-07 (plain objects, zero dependencies).
 */

// ── Task Schema ──────────────────────────────────────────────────────────────

export const TaskSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-ops.dev/schemas/task.json',
  title: 'Task',
  description:
    'The universal work item. Every email, calendar event, social mention, store order, or manual request becomes a Task.',
  type: 'object' as const,
  required: [
    'id',
    'source',
    'intent',
    'title',
    'priority',
    'status',
    'createdAt',
    'updatedAt',
    'metadata',
  ],
  properties: {
    id: {
      type: 'string' as const,
      format: 'uuid',
      description: 'Unique identifier (UUID v4)',
    },
    source: {
      type: 'string' as const,
      enum: ['email', 'calendar', 'social', 'store', 'manual'],
      description: 'Where this task originated',
    },
    sourceId: {
      type: 'string' as const,
      description:
        'External ID from the source system (e.g., Gmail messageId, Shopify orderId)',
    },
    intent: {
      type: 'string' as const,
      enum: ['reply', 'schedule', 'post', 'fulfill', 'escalate', 'ignore', 'unknown'],
      description: 'LLM-classified intent — what should be done with this task',
    },
    title: {
      type: 'string' as const,
      description: 'Short human-readable title',
    },
    body: {
      type: 'string' as const,
      description: 'Full content / body text',
    },
    priority: {
      type: 'string' as const,
      enum: ['urgent', 'high', 'normal', 'low'],
      description: 'Urgency classification',
    },
    status: {
      type: 'string' as const,
      enum: ['pending', 'planned', 'running', 'awaiting_approval', 'completed', 'failed'],
      description: 'Current lifecycle state',
    },
    owner: {
      type: 'string' as const,
      description: 'Owner / assignee identifier',
    },
    dueAt: {
      type: 'string' as const,
      format: 'date-time',
      description: 'When this task is due (ISO 8601)',
    },
    createdAt: {
      type: 'string' as const,
      format: 'date-time',
      description: 'When this task was created (ISO 8601)',
    },
    updatedAt: {
      type: 'string' as const,
      format: 'date-time',
      description: 'Last modification timestamp (ISO 8601)',
    },
    metadata: {
      type: 'object' as const,
      additionalProperties: true,
      description: 'Source-specific metadata (e.g., email headers, order line items)',
    },
  },
  additionalProperties: false,
} as const;

// ── Approval Schema ──────────────────────────────────────────────────────────

export const ApprovalSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-ops.dev/schemas/approval.json',
  title: 'Approval',
  description:
    'Human-in-the-loop gate. When CORD or policy rules flag an action as requiring confirmation, an Approval request is created.',
  type: 'object' as const,
  required: ['id', 'actionId', 'taskId', 'risk', 'reason', 'preview', 'requestedAt'],
  properties: {
    id: {
      type: 'string' as const,
      format: 'uuid',
      description: 'Approval request identifier (UUID v4)',
    },
    actionId: {
      type: 'string' as const,
      format: 'uuid',
      description: 'The action requiring approval',
    },
    taskId: {
      type: 'string' as const,
      format: 'uuid',
      description: 'Parent task for context',
    },
    risk: {
      type: 'string' as const,
      enum: ['low', 'medium', 'high', 'critical'],
      description: 'Risk assessment',
    },
    reason: {
      type: 'string' as const,
      description: 'Human-readable reason why approval is needed',
    },
    preview: {
      type: 'string' as const,
      description: 'Preview of what the action will do (shown to user)',
    },
    requestedAt: {
      type: 'string' as const,
      format: 'date-time',
      description: 'When approval was requested (ISO 8601)',
    },
    decision: {
      type: 'string' as const,
      enum: ['approved', 'denied', 'modified'],
      description: "User's decision",
    },
    decidedBy: {
      type: 'string' as const,
      description: 'Who made the decision',
    },
    decidedAt: {
      type: 'string' as const,
      format: 'date-time',
      description: 'When the decision was made (ISO 8601)',
    },
    modifications: {
      type: 'object' as const,
      additionalProperties: true,
      description: "If decision was 'modified', what changed",
    },
    ttlMs: {
      type: ['number', 'null'] as const,
      description:
        'Time-to-live: auto-deny after this duration (ms). Null = wait forever.',
    },
  },
  additionalProperties: false,
} as const;

// ── ActionReceipt Schema ─────────────────────────────────────────────────────

export const ActionReceiptSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-ops.dev/schemas/action-receipt.json',
  title: 'ActionReceipt',
  description:
    'Cryptographically signed proof of execution. Receipts are hash-chained for tamper detection.',
  type: 'object' as const,
  required: [
    'id',
    'actionId',
    'policyVersion',
    'cordDecision',
    'cordScore',
    'cordReasons',
    'input',
    'timestamp',
    'hash',
    'signature',
    'prevHash',
  ],
  properties: {
    id: {
      type: 'string' as const,
      format: 'uuid',
      description: 'Receipt identifier (UUID v4)',
    },
    actionId: {
      type: 'string' as const,
      format: 'uuid',
      description: 'The action this receipt covers',
    },
    policyVersion: {
      type: 'string' as const,
      description: 'Policy version that was active during evaluation',
    },
    cordDecision: {
      type: 'string' as const,
      description: 'CORD decision for this action',
    },
    cordScore: {
      type: 'number' as const,
      minimum: 0,
      maximum: 99,
      description: 'CORD risk score (0-99)',
    },
    cordReasons: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'CORD risk reasons',
    },
    input: {
      type: 'object' as const,
      additionalProperties: true,
      description: 'Sanitized input (secrets redacted)',
    },
    output: {
      type: 'object' as const,
      additionalProperties: true,
      description: 'Output summary',
    },
    timestamp: {
      type: 'string' as const,
      format: 'date-time',
      description: 'When this receipt was created (ISO 8601)',
    },
    hash: {
      type: 'string' as const,
      description: 'SHA-256 hash of receipt content',
    },
    signature: {
      type: 'string' as const,
      description: 'HMAC-SHA256 signature',
    },
    prevHash: {
      type: 'string' as const,
      description: 'Hash of previous receipt in chain',
    },
  },
  additionalProperties: false,
} as const;

// ── WorkflowStep Schema ──────────────────────────────────────────────────────

export const WorkflowStepSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-ops.dev/schemas/workflow-step.json',
  title: 'WorkflowStep',
  description:
    'A single step in a workflow run, executed through a connector (Gmail, Calendar, X, Shopify, etc.).',
  type: 'object' as const,
  required: ['id', 'connector', 'operation', 'input', 'status'],
  properties: {
    id: {
      type: 'string' as const,
      format: 'uuid',
      description: 'Step identifier (UUID v4)',
    },
    connector: {
      type: 'string' as const,
      description: 'Which connector handles this step',
    },
    operation: {
      type: 'string' as const,
      description:
        "Operation to perform (e.g., 'send', 'read', 'create_event', 'post')",
    },
    input: {
      type: 'object' as const,
      additionalProperties: true,
      description: 'Input data for the operation',
    },
    output: {
      type: 'object' as const,
      additionalProperties: true,
      description: 'Output data from the operation (populated after execution)',
    },
    status: {
      type: 'string' as const,
      enum: ['pending', 'running', 'completed', 'failed', 'blocked', 'approved'],
      description: 'Current step state',
    },
    cordDecision: {
      type: 'string' as const,
      enum: ['ALLOW', 'CONTAIN', 'CHALLENGE', 'BLOCK'],
      description: 'CORD safety decision for this step',
    },
    cordScore: {
      type: 'number' as const,
      minimum: 0,
      maximum: 99,
      description: 'CORD risk score (0-99)',
    },
    error: {
      type: 'string' as const,
      description: 'Error message if step failed',
    },
    durationMs: {
      type: 'number' as const,
      description: 'Step execution duration in milliseconds',
    },
  },
  additionalProperties: false,
} as const;

// ── WorkflowRun Schema ───────────────────────────────────────────────────────

export const WorkflowRunSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-ops.dev/schemas/workflow-run.json',
  title: 'WorkflowRun',
  description:
    'Execution tracking for multi-step automations. A Task triggers a WorkflowRun with ordered steps.',
  type: 'object' as const,
  required: ['id', 'taskId', 'workflowType', 'steps', 'state', 'startedAt'],
  properties: {
    id: {
      type: 'string' as const,
      format: 'uuid',
      description: 'Run identifier (UUID v4)',
    },
    taskId: {
      type: 'string' as const,
      format: 'uuid',
      description: 'Parent task that triggered this run',
    },
    workflowType: {
      type: 'string' as const,
      description:
        "Workflow template name (e.g., 'email-reply', 'calendar-accept', 'social-post')",
    },
    steps: {
      type: 'array' as const,
      items: { $ref: 'https://ai-ops.dev/schemas/workflow-step.json' },
      description: 'Ordered list of steps to execute',
    },
    state: {
      type: 'string' as const,
      enum: ['queued', 'running', 'paused', 'completed', 'failed'],
      description: 'Current run state',
    },
    startedAt: {
      type: 'string' as const,
      format: 'date-time',
      description: 'When this run was started (ISO 8601)',
    },
    endedAt: {
      type: 'string' as const,
      format: 'date-time',
      description: 'When this run finished (ISO 8601)',
    },
    error: {
      type: 'string' as const,
      description: 'Error message if run failed',
    },
  },
  additionalProperties: false,
} as const;

// ── Schema Registry ──────────────────────────────────────────────────────────

/**
 * Registry mapping schema names to their JSON Schema definitions.
 * Useful for runtime lookup, validation middleware, and OpenAPI generation.
 */
export const SCHEMAS: Record<string, object> = {
  Task: TaskSchema,
  Approval: ApprovalSchema,
  ActionReceipt: ActionReceiptSchema,
  WorkflowStep: WorkflowStepSchema,
  WorkflowRun: WorkflowRunSchema,
};
