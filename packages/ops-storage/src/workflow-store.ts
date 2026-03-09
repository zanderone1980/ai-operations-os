/**
 * WorkflowStore — SQLite-backed storage for WorkflowRun and WorkflowStep records.
 *
 * Steps are stored in a separate table and joined when loading runs.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { WorkflowRun, WorkflowStep } from '@ai-ops/shared-types';

export interface WorkflowRunFilter {
  taskId?: string;
  state?: string;
  limit?: number;
  offset?: number;
}

export class WorkflowStore {
  private readonly db: BetterSqlite3.Database;

  private readonly insertRunStmt: BetterSqlite3.Statement;
  private readonly getRunStmt: BetterSqlite3.Statement;
  private readonly getStepsByRunStmt: BetterSqlite3.Statement;
  private readonly insertStepStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;

    this.insertRunStmt = this.db.prepare(`
      INSERT OR REPLACE INTO workflow_runs
        (id, task_id, workflow_type, state, started_at, ended_at, error)
      VALUES
        (@id, @taskId, @workflowType, @state, @startedAt, @endedAt, @error)
    `);

    this.getRunStmt = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?');

    this.getStepsByRunStmt = this.db.prepare(
      'SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY step_order ASC'
    );

    this.insertStepStmt = this.db.prepare(`
      INSERT OR REPLACE INTO workflow_steps
        (id, run_id, connector, operation, input, output, status, cord_decision, cord_score, error, duration_ms, step_order)
      VALUES
        (@id, @runId, @connector, @operation, @input, @output, @status, @cordDecision, @cordScore, @error, @durationMs, @stepOrder)
    `);
  }

  /** Save a complete workflow run (including its steps) */
  saveRun(run: WorkflowRun): void {
    const saveTransaction = this.db.transaction((r: WorkflowRun) => {
      this.insertRunStmt.run({
        id: r.id,
        taskId: r.taskId,
        workflowType: r.workflowType,
        state: r.state,
        startedAt: r.startedAt,
        endedAt: r.endedAt ?? null,
        error: r.error ?? null,
      });

      // Delete existing steps to handle re-saves cleanly
      this.db.prepare('DELETE FROM workflow_steps WHERE run_id = ?').run(r.id);

      r.steps.forEach((step, index) => {
        this.insertStepStmt.run({
          id: step.id,
          runId: r.id,
          connector: step.connector,
          operation: step.operation,
          input: JSON.stringify(step.input),
          output: step.output ? JSON.stringify(step.output) : null,
          status: step.status,
          cordDecision: step.cordDecision ?? null,
          cordScore: step.cordScore ?? null,
          error: step.error ?? null,
          durationMs: step.durationMs ?? null,
          stepOrder: index,
        });
      });
    });

    saveTransaction(run);
  }

  /** Retrieve a workflow run by ID (with steps) */
  getRun(id: string): WorkflowRun | undefined {
    const row = this.getRunStmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToRun(row);
  }

  /** List workflow runs with optional filtering */
  listRuns(filter?: WorkflowRunFilter): WorkflowRun[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.taskId) {
      conditions.push('task_id = @taskId');
      params.taskId = filter.taskId;
    }
    if (filter?.state) {
      conditions.push('state = @state');
      params.state = filter.state;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const sql = `SELECT * FROM workflow_runs ${where} ORDER BY started_at DESC LIMIT @limit OFFSET @offset`;
    params.limit = limit;
    params.offset = offset;

    const rows = this.db.prepare(sql).all(params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToRun(row));
  }

  /** Update specific fields on a workflow run */
  updateRun(id: string, updates: Partial<WorkflowRun>): void {
    const existing = this.getRun(id);
    if (!existing) return;

    const merged: WorkflowRun = {
      ...existing,
      ...updates,
      // Preserve steps unless explicitly provided
      steps: updates.steps ?? existing.steps,
    };
    this.saveRun(merged);
  }

  /** Save or update a single step within a run */
  saveStep(runId: string, step: WorkflowStep): void {
    // Get existing steps to determine order
    const existingSteps = this.getStepsByRunStmt.all(runId) as Record<string, unknown>[];
    const existingIndex = existingSteps.findIndex((s) => s.id === step.id);

    const stepOrder = existingIndex >= 0
      ? (existingSteps[existingIndex].step_order as number)
      : existingSteps.length;

    this.insertStepStmt.run({
      id: step.id,
      runId,
      connector: step.connector,
      operation: step.operation,
      input: JSON.stringify(step.input),
      output: step.output ? JSON.stringify(step.output) : null,
      status: step.status,
      cordDecision: step.cordDecision ?? null,
      cordScore: step.cordScore ?? null,
      error: step.error ?? null,
      durationMs: step.durationMs ?? null,
      stepOrder,
    });
  }

  /** Convert a database row to a WorkflowRun (with steps loaded) */
  private rowToRun(row: Record<string, unknown>): WorkflowRun {
    const stepRows = this.getStepsByRunStmt.all(row.id as string) as Record<string, unknown>[];

    return {
      id: row.id as string,
      taskId: row.task_id as string,
      workflowType: row.workflow_type as string,
      state: row.state as WorkflowRun['state'],
      startedAt: row.started_at as string,
      endedAt: row.ended_at as string | undefined,
      error: row.error as string | undefined,
      steps: stepRows.map((s) => this.rowToStep(s)),
    };
  }

  /** Convert a database row to a WorkflowStep */
  private rowToStep(row: Record<string, unknown>): WorkflowStep {
    return {
      id: row.id as string,
      connector: row.connector as string,
      operation: row.operation as string,
      input: JSON.parse(row.input as string) as Record<string, unknown>,
      output: row.output ? (JSON.parse(row.output as string) as Record<string, unknown>) : undefined,
      status: row.status as WorkflowStep['status'],
      cordDecision: row.cord_decision as WorkflowStep['cordDecision'],
      cordScore: row.cord_score as number | undefined,
      error: row.error as string | undefined,
      durationMs: row.duration_ms as number | undefined,
    };
  }
}
