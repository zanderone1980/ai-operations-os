/**
 * AuditStore — Security event audit trail.
 *
 * Records security-relevant events: auth attempts, approval decisions,
 * credential operations, and auth rejections. Backed by SQLite.
 */

import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

// ── Types ──────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.rejected'
  | 'approval.decided'
  | 'credential.created'
  | 'credential.deleted'
  | 'webhook.received';

export interface AuditEntry {
  id: string;
  eventType: AuditEventType;
  actorId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditFilter {
  eventType?: AuditEventType;
  actorId?: string;
  resourceType?: string;
  limit?: number;
  offset?: number;
}

// ── Store ──────────────────────────────────────────────────────────────────

export class AuditStore {
  private stmts: {
    insert: BetterSqlite3.Statement;
    listAll: BetterSqlite3.Statement;
    count: BetterSqlite3.Statement;
  };

  constructor(private db: BetterSqlite3.Database) {
    this.stmts = {
      insert: db.prepare(`
        INSERT INTO audit_log (id, event_type, actor_id, resource_type, resource_id, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      listAll: db.prepare(`
        SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?
      `),
      count: db.prepare(`SELECT COUNT(*) as count FROM audit_log`),
    };
  }

  /**
   * Log an audit event.
   */
  log(
    eventType: AuditEventType,
    options: {
      actorId?: string;
      resourceType?: string;
      resourceId?: string;
      details?: Record<string, unknown>;
      ipAddress?: string;
    } = {},
  ): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      eventType,
      actorId: options.actorId || null,
      resourceType: options.resourceType || null,
      resourceId: options.resourceId || null,
      details: options.details || {},
      ipAddress: options.ipAddress || null,
      createdAt: new Date().toISOString(),
    };

    this.stmts.insert.run(
      entry.id,
      entry.eventType,
      entry.actorId,
      entry.resourceType,
      entry.resourceId,
      JSON.stringify(entry.details),
      entry.ipAddress,
      entry.createdAt,
    );

    return entry;
  }

  /**
   * List audit entries with optional filters.
   */
  list(filter: AuditFilter = {}): AuditEntry[] {
    const limit = filter.limit || 100;
    const offset = filter.offset || 0;

    let sql = 'SELECT * FROM audit_log';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.eventType) {
      conditions.push('event_type = ?');
      params.push(filter.eventType);
    }
    if (filter.actorId) {
      conditions.push('actor_id = ?');
      params.push(filter.actorId);
    }
    if (filter.resourceType) {
      conditions.push('resource_type = ?');
      params.push(filter.resourceType);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.rowToEntry);
  }

  /**
   * Count total audit entries.
   */
  count(): number {
    return (this.stmts.count.get() as { count: number }).count;
  }

  private rowToEntry(row: any): AuditEntry {
    return {
      id: row.id,
      eventType: row.event_type,
      actorId: row.actor_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: JSON.parse(row.details || '{}'),
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    };
  }
}
