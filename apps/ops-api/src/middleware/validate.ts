/**
 * Input Validation Middleware — Lightweight request body validation.
 *
 * Zero external dependencies. Validates request bodies against
 * declarative schema definitions and returns structured errors.
 */

// ── Schema Types ────────────────────────────────────────────────────────────

export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'object';

export interface SchemaField {
  type: SchemaFieldType;
  required?: boolean;
  maxLength?: number;
  enum?: string[];
}

export type ValidationSchema = Record<string, SchemaField>;

export type ValidationResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Validator ───────────────────────────────────────────────────────────────

/**
 * Returns a function that validates a request body against the given schema.
 *
 * Usage:
 * ```ts
 * const result = validateBody(taskCreateSchema)(body);
 * if (!result.ok) { sendError(res, 400, result.error); return; }
 * ```
 */
export function validateBody(schema: ValidationSchema) {
  return (body: Record<string, unknown>): ValidationResult => {
    if (body === null || typeof body !== 'object') {
      return { ok: false, error: 'Request body must be a JSON object' };
    }

    for (const [field, rule] of Object.entries(schema)) {
      const value = body[field];

      // Required check
      if (rule.required && (value === undefined || value === null || value === '')) {
        return { ok: false, error: `Missing required field: ${field}` };
      }

      // Skip further checks if value is not provided and not required
      if (value === undefined || value === null) {
        continue;
      }

      // Type check
      const actualType = typeof value;
      if (rule.type === 'object') {
        if (actualType !== 'object' || Array.isArray(value)) {
          return {
            ok: false,
            error: `Field '${field}' must be of type ${rule.type}, got ${Array.isArray(value) ? 'array' : actualType}`,
          };
        }
      } else if (actualType !== rule.type) {
        return {
          ok: false,
          error: `Field '${field}' must be of type ${rule.type}, got ${actualType}`,
        };
      }

      // maxLength check (strings only)
      if (rule.maxLength !== undefined && rule.type === 'string' && typeof value === 'string') {
        if (value.length > rule.maxLength) {
          return {
            ok: false,
            error: `Field '${field}' exceeds maximum length of ${rule.maxLength} (got ${value.length})`,
          };
        }
      }

      // Enum check
      if (rule.enum && rule.enum.length > 0) {
        if (!rule.enum.includes(String(value))) {
          return {
            ok: false,
            error: `Field '${field}' must be one of: ${rule.enum.join(', ')}. Got '${String(value)}'`,
          };
        }
      }
    }

    return { ok: true, data: body };
  };
}

// ── Schemas ─────────────────────────────────────────────────────────────────

/**
 * Task creation — POST /api/tasks
 */
export const taskCreateSchema: ValidationSchema = {
  source: {
    type: 'string',
    required: true,
    enum: ['email', 'calendar', 'social', 'store', 'slack', 'notion', 'manual'],
  },
  title: {
    type: 'string',
    required: true,
    maxLength: 500,
  },
  body: {
    type: 'string',
    required: false,
    maxLength: 50000,
  },
  intent: {
    type: 'string',
    required: false,
    enum: ['reply', 'schedule', 'post', 'fulfill', 'refund', 'escalate', 'ignore', 'unknown'],
  },
  priority: {
    type: 'string',
    required: false,
    enum: ['urgent', 'high', 'normal', 'low'],
  },
};

/**
 * Approval decision — POST /api/approvals/:id/decide
 */
export const approvalDecisionSchema: ValidationSchema = {
  decision: {
    type: 'string',
    required: true,
    enum: ['approved', 'denied', 'modified'],
  },
  decidedBy: {
    type: 'string',
    required: false,
  },
};

/**
 * Workflow creation — POST /api/workflows
 */
export const workflowCreateSchema: ValidationSchema = {
  taskId: {
    type: 'string',
    required: true,
  },
  workflowType: {
    type: 'string',
    required: true,
  },
  steps: {
    type: 'object',
    required: true,
  },
};

/**
 * Pipeline simulation — POST /api/pipeline/simulate
 */
export const pipelineSimulateSchema: ValidationSchema = {
  source: {
    type: 'string',
    required: true,
    enum: ['email', 'calendar', 'social', 'store', 'slack', 'notion', 'manual'],
  },
  title: {
    type: 'string',
    required: true,
  },
};

/**
 * SPARK chat — POST /api/spark/chat
 */
export const sparkChatSchema: ValidationSchema = {
  message: {
    type: 'string',
    required: true,
    maxLength: 10000,
  },
  conversationId: {
    type: 'string',
    required: false,
  },
};

/**
 * Generic webhook — POST /api/webhooks/generic
 */
export const webhookGenericSchema: ValidationSchema = {
  title: {
    type: 'string',
    required: true,
    maxLength: 500,
  },
  source: {
    type: 'string',
    required: false,
    enum: ['email', 'calendar', 'social', 'store', 'slack', 'notion', 'manual'],
  },
};

/**
 * Connector execute — POST /api/connectors/:name/execute
 */
export const connectorExecuteSchema: ValidationSchema = {
  operation: {
    type: 'string',
    required: true,
  },
  input: {
    type: 'object',
    required: false,
  },
};
