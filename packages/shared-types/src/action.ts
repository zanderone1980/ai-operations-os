import { randomUUID } from './uuid';

/**
 * Action — A single executed operation.
 *
 * Every connector call becomes an Action record. Actions are the atomic
 * unit of work — they map 1:1 to external API calls.
 */

export type ActionStatus = 'pending' | 'executed' | 'blocked' | 'failed';

export interface Action {
  /** Action identifier (UUID v4) */
  id: string;

  /** Parent workflow run */
  runId: string;

  /** Parent workflow step */
  stepId: string;

  /** Which connector executed this action */
  connector: string;

  /** Operation name (e.g., 'gmail.send', 'calendar.create_event') */
  operation: string;

  /** Input data sent to the connector */
  input: Record<string, unknown>;

  /** Output data returned from the connector */
  output?: Record<string, unknown>;

  /** Execution status */
  status: ActionStatus;

  /** When this action was executed (ISO 8601) */
  executedAt?: string;

  /** Execution duration in milliseconds */
  durationMs?: number;

  /** Error message if failed */
  error?: string;
}

/**
 * Create a new Action record.
 */
export function createAction(
  runId: string,
  stepId: string,
  connector: string,
  operation: string,
  input: Record<string, unknown>,
): Action {
  return {
    id: randomUUID(),
    runId,
    stepId,
    connector,
    operation,
    input,
    status: 'pending',
  };
}
