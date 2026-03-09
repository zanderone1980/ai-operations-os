/**
 * ApprovalStore — SQLite-backed storage for Approval records.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { Approval, ApprovalDecision } from '@ai-ops/shared-types';

export interface ApprovalFilter {
  risk?: string;
  limit?: number;
  offset?: number;
}

export class ApprovalStore {
  private readonly db: BetterSqlite3.Database;

  private readonly insertStmt: BetterSqlite3.Statement;
  private readonly getStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;

    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO approvals
        (id, action_id, task_id, risk, reason, preview, requested_at, decision, decided_by, decided_at, modifications, ttl_ms)
      VALUES
        (@id, @actionId, @taskId, @risk, @reason, @preview, @requestedAt, @decision, @decidedBy, @decidedAt, @modifications, @ttlMs)
    `);

    this.getStmt = this.db.prepare('SELECT * FROM approvals WHERE id = ?');
  }

  /** INSERT OR REPLACE an approval */
  save(approval: Approval): void {
    this.insertStmt.run({
      id: approval.id,
      actionId: approval.actionId,
      taskId: approval.taskId,
      risk: approval.risk,
      reason: approval.reason,
      preview: approval.preview,
      requestedAt: approval.requestedAt,
      decision: approval.decision ?? null,
      decidedBy: approval.decidedBy ?? null,
      decidedAt: approval.decidedAt ?? null,
      modifications: approval.modifications ? JSON.stringify(approval.modifications) : null,
      ttlMs: approval.ttlMs ?? null,
    });
  }

  /** Retrieve an approval by ID */
  get(id: string): Approval | undefined {
    const row = this.getStmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToApproval(row);
  }

  /** List only pending (undecided) approvals */
  listPending(): Approval[] {
    const rows = this.db
      .prepare('SELECT * FROM approvals WHERE decision IS NULL ORDER BY requested_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToApproval(row));
  }

  /** List all approvals with optional filtering */
  listAll(filter?: ApprovalFilter): Approval[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.risk) {
      conditions.push('risk = @risk');
      params.risk = filter.risk;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const sql = `SELECT * FROM approvals ${where} ORDER BY requested_at DESC LIMIT @limit OFFSET @offset`;
    params.limit = limit;
    params.offset = offset;

    const rows = this.db.prepare(sql).all(params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToApproval(row));
  }

  /** Record a decision on an approval */
  decide(
    id: string,
    decision: ApprovalDecision,
    decidedBy?: string,
    modifications?: Record<string, unknown>,
  ): void {
    const existing = this.get(id);
    if (!existing) return;

    existing.decision = decision;
    existing.decidedBy = decidedBy ?? 'user';
    existing.decidedAt = new Date().toISOString();
    if (decision === 'modified' && modifications) {
      existing.modifications = modifications;
    }

    this.save(existing);
  }

  /** Count pending (undecided) approvals */
  countPending(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM approvals WHERE decision IS NULL')
      .get() as { count: number };
    return row.count;
  }

  /** Convert a database row to an Approval object */
  private rowToApproval(row: Record<string, unknown>): Approval {
    return {
      id: row.id as string,
      actionId: row.action_id as string,
      taskId: row.task_id as string,
      risk: row.risk as Approval['risk'],
      reason: row.reason as string,
      preview: row.preview as string,
      requestedAt: row.requested_at as string,
      decision: row.decision as ApprovalDecision | undefined,
      decidedBy: row.decided_by as string | undefined,
      decidedAt: row.decided_at as string | undefined,
      modifications: row.modifications
        ? (JSON.parse(row.modifications as string) as Record<string, unknown>)
        : undefined,
      ttlMs: row.ttl_ms as number | null | undefined,
    };
  }
}
