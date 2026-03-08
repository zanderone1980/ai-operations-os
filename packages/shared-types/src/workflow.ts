/**
 * WorkflowRun + WorkflowStep — Execution tracking for multi-step automations.
 *
 * A Task triggers a WorkflowRun. Each run has ordered Steps that execute
 * through connectors (Gmail, Calendar, X, Shopify, etc.).
 */

export type WorkflowState = 'queued' | 'running' | 'paused' | 'completed' | 'failed';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'approved';

export type CordDecision = 'ALLOW' | 'CONTAIN' | 'CHALLENGE' | 'BLOCK';

export interface WorkflowStep {
  /** Step identifier (UUID v4) */
  id: string;

  /** Which connector handles this step */
  connector: string;

  /** Operation to perform (e.g., 'send', 'read', 'create_event', 'post') */
  operation: string;

  /** Input data for the operation */
  input: Record<string, unknown>;

  /** Output data from the operation (populated after execution) */
  output?: Record<string, unknown>;

  /** Current step state */
  status: StepStatus;

  /** CORD safety decision for this step */
  cordDecision?: CordDecision;

  /** CORD risk score (0-99) */
  cordScore?: number;

  /** Error message if step failed */
  error?: string;

  /** Step execution duration in milliseconds */
  durationMs?: number;
}

export interface WorkflowRun {
  /** Run identifier (UUID v4) */
  id: string;

  /** Parent task that triggered this run */
  taskId: string;

  /** Workflow template name (e.g., 'email-reply', 'calendar-accept', 'social-post') */
  workflowType: string;

  /** Ordered list of steps to execute */
  steps: WorkflowStep[];

  /** Current run state */
  state: WorkflowState;

  /** When this run was started (ISO 8601) */
  startedAt: string;

  /** When this run finished (ISO 8601) */
  endedAt?: string;

  /** Error message if run failed */
  error?: string;
}

/**
 * Create a new WorkflowRun.
 */
export function createWorkflowRun(
  taskId: string,
  workflowType: string,
  steps: Omit<WorkflowStep, 'id' | 'status'>[],
): WorkflowRun {
  return {
    id: crypto.randomUUID(),
    taskId,
    workflowType,
    steps: steps.map((s) => ({
      ...s,
      id: crypto.randomUUID(),
      status: 'pending' as const,
    })),
    state: 'queued',
    startedAt: new Date().toISOString(),
  };
}

/**
 * Create a single WorkflowStep.
 */
export function createStep(
  connector: string,
  operation: string,
  input: Record<string, unknown> = {},
): Omit<WorkflowStep, 'id' | 'status'> {
  return { connector, operation, input };
}
