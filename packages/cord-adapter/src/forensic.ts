/**
 * ForensicEngine -- Session-level forensic timeline analysis.
 *
 * Loads a session's action history from ops-storage and builds a
 * chronological timeline for audit, compliance, and debugging.
 * The timeline can be rendered as colored CLI output for quick inspection.
 *
 * "Session" is identified by a task ID -- a task spawns workflow runs,
 * each with ordered steps. Steps produce actions which yield receipts.
 * Approvals are linked by task ID and action ID.
 */

import {
  createStores,
  type Stores,
  type WorkflowStore,
  type ApprovalStore,
  type TaskStore,
} from '@ai-operations/ops-storage';
import type {
  ActionReceipt,
  WorkflowRun,
  WorkflowStep,
  Approval,
  Task,
  Action,
} from '@ai-operations/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single event in the forensic timeline. */
export interface TimelineEvent {
  /** ISO 8601 timestamp of the event. */
  timestamp: string;

  /** Event category for filtering and display. */
  category: 'action' | 'decision' | 'approval' | 'error' | 'system';

  /** Short label describing the event. */
  label: string;

  /** Detailed description or context. */
  detail?: string;

  /** Associated connector (if applicable). */
  connector?: string;

  /** Associated operation (if applicable). */
  operation?: string;

  /** CORD decision at this point (if applicable). */
  cordDecision?: string;

  /** Risk score at this point (if applicable). */
  cordScore?: number;
}

/** Complete forensic timeline for a session. */
export interface ForensicTimeline {
  /** The session identifier this timeline covers. */
  sessionId: string;

  /** Ordered list of timeline events. */
  events: TimelineEvent[];

  /** When the timeline was built (ISO 8601). */
  builtAt: string;
}

// ---------------------------------------------------------------------------
// Internal raw data loaded from storage
// ---------------------------------------------------------------------------

/** All data loaded for a given session (task). */
interface SessionData {
  task: Task | undefined;
  workflowRuns: WorkflowRun[];
  approvals: Approval[];
  /** Raw action rows keyed by action ID. */
  actions: Map<string, ActionRow>;
  /** Raw receipt rows keyed by action ID. */
  receiptsByAction: Map<string, ReceiptRow[]>;
}

/** Minimal row shape for the actions table. */
interface ActionRow {
  id: string;
  run_id: string;
  step_id: string;
  connector: string;
  operation: string;
  input: string;
  output: string | null;
  status: string;
  executed_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

/** Minimal row shape for the receipts table. */
interface ReceiptRow {
  id: string;
  action_id: string;
  policy_version: string;
  cord_decision: string;
  cord_score: number;
  cord_reasons: string;
  input: string;
  output: string | null;
  timestamp: string;
  hash: string;
  signature: string;
  prev_hash: string;
}

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

/** Map event categories to ANSI color codes. */
const CATEGORY_COLORS: Record<TimelineEvent['category'], string> = {
  action: COLORS.cyan,
  decision: COLORS.yellow,
  approval: COLORS.magenta,
  error: COLORS.red,
  system: COLORS.gray,
};

/** Map CORD decisions to ANSI color codes. */
const DECISION_COLORS: Record<string, string> = {
  ALLOW: COLORS.green,
  CONTAIN: COLORS.yellow,
  CHALLENGE: COLORS.magenta,
  BLOCK: COLORS.red,
};

// ---------------------------------------------------------------------------
// ForensicEngine
// ---------------------------------------------------------------------------

/**
 * ForensicEngine provides session-level forensic analysis by constructing
 * and rendering chronological timelines of system activity.
 *
 * @example
 * ```ts
 * const engine = new ForensicEngine();
 * await engine.loadSession('session-abc-123');
 * engine.buildTimeline();
 * engine.renderTimeline();
 * ```
 */
export class ForensicEngine {
  /** The session ID currently loaded (if any). */
  private sessionId: string | null = null;

  /** The built timeline (populated after buildTimeline). */
  private timeline: ForensicTimeline | null = null;

  /** Raw session data loaded from storage. */
  private sessionData: SessionData | null = null;

  /** Storage layer reference (created lazily or injected). */
  private stores: Stores;

  /**
   * @param stores - Optional pre-created Stores instance. When omitted the
   *   engine creates one using the default database path (~/.ai-ops/data.db).
   */
  constructor(stores?: Stores) {
    this.stores = stores ?? createStores();
  }

  // -----------------------------------------------------------------------
  // loadSession
  // -----------------------------------------------------------------------

  /**
   * Load session data for forensic analysis.
   *
   * A "session" is identified by a **task ID**. Loading a session fetches:
   *   - The task record itself
   *   - All workflow runs associated with the task
   *   - All actions belonging to those workflow runs
   *   - All receipts for those actions
   *   - All approvals linked to the task
   *
   * @param sessionId - The task identifier whose session to reconstruct.
   */
  async loadSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.timeline = null;

    const { tasks, workflows, approvals, db } = this.stores;
    const rawDb = db.db;

    // 1. Load the task record
    const task = tasks.get(sessionId);

    // 2. Load all workflow runs for this task
    const workflowRuns = workflows.listRuns({ taskId: sessionId, limit: 1000 });

    // 3. Collect all run IDs so we can query actions and receipts
    const runIds = workflowRuns.map((r) => r.id);

    // 4. Load actions for every run
    const actionsMap = new Map<string, ActionRow>();
    if (runIds.length > 0) {
      // Use a parameterised query per run to stay compatible with
      // better-sqlite3 (which doesn't support array binding directly).
      const actionStmt = rawDb.prepare(
        'SELECT * FROM actions WHERE run_id = ?',
      );
      for (const runId of runIds) {
        const rows = actionStmt.all(runId) as ActionRow[];
        for (const row of rows) {
          actionsMap.set(row.id, row);
        }
      }
    }

    // 5. Load receipts for every action
    const receiptsByAction = new Map<string, ReceiptRow[]>();
    if (actionsMap.size > 0) {
      const receiptStmt = rawDb.prepare(
        'SELECT * FROM receipts WHERE action_id = ? ORDER BY timestamp ASC',
      );
      for (const actionId of actionsMap.keys()) {
        const rows = receiptStmt.all(actionId) as ReceiptRow[];
        if (rows.length > 0) {
          receiptsByAction.set(actionId, rows);
        }
      }
    }

    // 6. Load approvals for this task
    const allApprovals = approvals.listAll({ limit: 1000 });
    const taskApprovals = allApprovals.filter((a) => a.taskId === sessionId);

    this.sessionData = {
      task,
      workflowRuns,
      approvals: taskApprovals,
      actions: actionsMap,
      receiptsByAction,
    };
  }

  // -----------------------------------------------------------------------
  // buildTimeline
  // -----------------------------------------------------------------------

  /**
   * Build the forensic timeline from loaded session data.
   *
   * Events are assembled from multiple sources and then sorted
   * chronologically:
   *   - **system** events for task creation and workflow run start / end
   *   - **action** events for each workflow step execution
   *   - **decision** events for CORD evaluations (from receipts)
   *   - **approval** events for human-in-the-loop gates
   *   - **error** events for failures at any level
   *
   * @returns The constructed ForensicTimeline.
   * @throws Error if no session has been loaded.
   */
  buildTimeline(): ForensicTimeline {
    if (!this.sessionId) {
      throw new Error('No session loaded. Call loadSession() first.');
    }

    if (!this.sessionData) {
      throw new Error('Session data not loaded. Call loadSession() first.');
    }

    const events: TimelineEvent[] = [];

    const { task, workflowRuns, approvals, actions, receiptsByAction } =
      this.sessionData;

    // -- Task-level system event ----------------------------------------
    if (task) {
      events.push({
        timestamp: task.createdAt,
        category: 'system',
        label: `Task created: ${task.title}`,
        detail: `source=${task.source} intent=${task.intent} priority=${task.priority}`,
      });
    }

    // -- Workflow runs and steps ----------------------------------------
    for (const run of workflowRuns) {
      // Workflow run start
      events.push({
        timestamp: run.startedAt,
        category: 'system',
        label: `Workflow started: ${run.workflowType}`,
        detail: `runId=${run.id} state=${run.state}`,
      });

      // Process each step in execution order
      for (const step of run.steps) {
        this.addStepEvents(events, run, step, actions, receiptsByAction);
      }

      // Workflow run end (if finished)
      if (run.endedAt) {
        if (run.error) {
          events.push({
            timestamp: run.endedAt,
            category: 'error',
            label: `Workflow failed: ${run.workflowType}`,
            detail: run.error,
          });
        } else {
          events.push({
            timestamp: run.endedAt,
            category: 'system',
            label: `Workflow completed: ${run.workflowType}`,
            detail: `state=${run.state}`,
          });
        }
      }
    }

    // -- Approval events ------------------------------------------------
    for (const approval of approvals) {
      // Approval requested
      events.push({
        timestamp: approval.requestedAt,
        category: 'approval',
        label: `Approval requested: ${approval.reason}`,
        detail: `risk=${approval.risk} actionId=${approval.actionId} preview=${truncate(approval.preview, 80)}`,
      });

      // Approval decided
      if (approval.decision && approval.decidedAt) {
        const decisionLabel =
          approval.decision === 'approved'
            ? 'Approved'
            : approval.decision === 'denied'
              ? 'Denied'
              : 'Modified';

        events.push({
          timestamp: approval.decidedAt,
          category: 'approval',
          label: `${decisionLabel} by ${approval.decidedBy ?? 'unknown'}`,
          detail: approval.modifications
            ? `modifications=${JSON.stringify(approval.modifications)}`
            : undefined,
        });
      }
    }

    // -- Sort chronologically -------------------------------------------
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    this.timeline = {
      sessionId: this.sessionId,
      events,
      builtAt: new Date().toISOString(),
    };

    return this.timeline;
  }

  // -----------------------------------------------------------------------
  // renderTimeline
  // -----------------------------------------------------------------------

  /**
   * Render the forensic timeline as colored CLI output.
   *
   * Outputs a formatted, color-coded timeline to stdout for quick
   * visual inspection of session activity.
   *
   * @throws Error if no timeline has been built.
   */
  renderTimeline(): void {
    if (!this.timeline) {
      throw new Error('No timeline built. Call buildTimeline() first.');
    }

    const { sessionId, events, builtAt } = this.timeline;

    // Header
    console.log('');
    console.log(
      `${COLORS.bold}=== Forensic Timeline ===${COLORS.reset}`,
    );
    console.log(
      `${COLORS.dim}Session: ${sessionId}${COLORS.reset}`,
    );
    console.log(
      `${COLORS.dim}Built:   ${builtAt}${COLORS.reset}`,
    );
    console.log(
      `${COLORS.dim}Events:  ${events.length}${COLORS.reset}`,
    );
    console.log('');

    if (events.length === 0) {
      console.log(
        `${COLORS.yellow}  (no events recorded for this session)${COLORS.reset}`,
      );
      console.log('');
      return;
    }

    // Render each event
    for (const event of events) {
      const categoryColor = CATEGORY_COLORS[event.category] ?? COLORS.gray;
      const timestamp = `${COLORS.dim}${event.timestamp}${COLORS.reset}`;
      const category = `${categoryColor}[${event.category.toUpperCase()}]${COLORS.reset}`;
      const label = `${COLORS.bold}${event.label}${COLORS.reset}`;

      let line = `  ${timestamp}  ${category}  ${label}`;

      // Add connector.operation if present
      if (event.connector && event.operation) {
        line += `  ${COLORS.cyan}${event.connector}.${event.operation}${COLORS.reset}`;
      }

      // Add CORD decision if present
      if (event.cordDecision) {
        const decisionColor = DECISION_COLORS[event.cordDecision] ?? COLORS.gray;
        line += `  ${decisionColor}${event.cordDecision}${COLORS.reset}`;

        if (event.cordScore !== undefined) {
          line += `${COLORS.dim}(${event.cordScore})${COLORS.reset}`;
        }
      }

      console.log(line);

      // Detail on the next line if present
      if (event.detail) {
        console.log(
          `${COLORS.dim}           ${event.detail}${COLORS.reset}`,
        );
      }
    }

    console.log('');
    console.log(
      `${COLORS.dim}--- end of timeline ---${COLORS.reset}`,
    );
    console.log('');
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /**
   * Get the currently loaded session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get the built timeline.
   */
  getTimeline(): ForensicTimeline | null {
    return this.timeline;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Emit timeline events for a single workflow step, including related
   * actions and receipts.
   */
  private addStepEvents(
    events: TimelineEvent[],
    run: WorkflowRun,
    step: WorkflowStep,
    actionsMap: Map<string, ActionRow>,
    receiptsByAction: Map<string, ReceiptRow[]>,
  ): void {
    // Find actions belonging to this step
    const stepActions: ActionRow[] = [];
    for (const action of actionsMap.values()) {
      if (action.run_id === run.id && action.step_id === step.id) {
        stepActions.push(action);
      }
    }

    // If there are actions with execution timestamps, use those for timing.
    // Otherwise fall back to the run's startedAt as a reasonable estimate.
    if (stepActions.length > 0) {
      // Sort actions by executed_at so they appear in order
      stepActions.sort((a, b) =>
        (a.executed_at ?? '').localeCompare(b.executed_at ?? ''),
      );

      for (const action of stepActions) {
        const ts = action.executed_at ?? run.startedAt;

        // Action execution event
        events.push({
          timestamp: ts,
          category: action.status === 'failed' ? 'error' : 'action',
          label:
            action.status === 'failed'
              ? `Action failed: ${action.connector}.${action.operation}`
              : `Action executed: ${action.connector}.${action.operation}`,
          detail: action.error
            ? action.error
            : action.duration_ms != null
              ? `duration=${action.duration_ms}ms`
              : undefined,
          connector: action.connector,
          operation: action.operation,
        });

        // Receipt / CORD decision events for this action
        const receipts = receiptsByAction.get(action.id);
        if (receipts) {
          for (const receipt of receipts) {
            const reasons = safeParseJsonArray(receipt.cord_reasons);
            events.push({
              timestamp: receipt.timestamp,
              category: 'decision',
              label: `CORD evaluated: ${receipt.cord_decision}`,
              detail:
                reasons.length > 0
                  ? `reasons=[${reasons.join(', ')}] policy=${receipt.policy_version}`
                  : `policy=${receipt.policy_version}`,
              connector: action.connector,
              operation: action.operation,
              cordDecision: receipt.cord_decision,
              cordScore: receipt.cord_score,
            });
          }
        }
      }
    } else {
      // No individual action rows -- emit a step-level event instead.
      // This covers steps that have CORD data attached directly.
      const ts = run.startedAt;

      if (step.status === 'failed') {
        events.push({
          timestamp: ts,
          category: 'error',
          label: `Step failed: ${step.connector}.${step.operation}`,
          detail: step.error ?? undefined,
          connector: step.connector,
          operation: step.operation,
          cordDecision: step.cordDecision,
          cordScore: step.cordScore,
        });
      } else if (step.status === 'blocked') {
        events.push({
          timestamp: ts,
          category: 'decision',
          label: `Step blocked: ${step.connector}.${step.operation}`,
          detail: step.error ?? 'Blocked by CORD policy',
          connector: step.connector,
          operation: step.operation,
          cordDecision: step.cordDecision ?? 'BLOCK',
          cordScore: step.cordScore,
        });
      } else {
        events.push({
          timestamp: ts,
          category: 'action',
          label: `Step executed: ${step.connector}.${step.operation}`,
          detail:
            step.durationMs != null ? `duration=${step.durationMs}ms` : undefined,
          connector: step.connector,
          operation: step.operation,
          cordDecision: step.cordDecision,
          cordScore: step.cordScore,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Safely parse a JSON array string, returning an empty array on failure. */
function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
    return [];
  } catch {
    return [];
  }
}

/** Truncate a string to a maximum length, appending an ellipsis if trimmed. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
