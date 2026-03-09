/**
 * TaskStore — SQLite-backed CRUD for Task records.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { Task } from '@ai-ops/shared-types';

export interface TaskFilter {
  status?: string;
  source?: string;
  intent?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}

export class TaskStore {
  private readonly db: BetterSqlite3.Database;

  private readonly insertStmt: BetterSqlite3.Statement;
  private readonly getStmt: BetterSqlite3.Statement;
  private readonly deleteStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;

    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO tasks
        (id, source, source_id, intent, title, body, priority, status, owner, due_at, created_at, updated_at, metadata)
      VALUES
        (@id, @source, @sourceId, @intent, @title, @body, @priority, @status, @owner, @dueAt, @createdAt, @updatedAt, @metadata)
    `);

    this.getStmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');

    this.deleteStmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
  }

  /** INSERT OR REPLACE a task */
  save(task: Task): void {
    this.insertStmt.run({
      id: task.id,
      source: task.source,
      sourceId: task.sourceId ?? null,
      intent: task.intent,
      title: task.title,
      body: task.body ?? null,
      priority: task.priority,
      status: task.status,
      owner: task.owner ?? null,
      dueAt: task.dueAt ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      metadata: JSON.stringify(task.metadata),
    });
  }

  /** Retrieve a task by ID */
  get(id: string): Task | undefined {
    const row = this.getStmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToTask(row);
  }

  /** List tasks with optional filtering */
  list(filter?: TaskFilter): Task[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.status) {
      conditions.push('status = @status');
      params.status = filter.status;
    }
    if (filter?.source) {
      conditions.push('source = @source');
      params.source = filter.source;
    }
    if (filter?.intent) {
      conditions.push('intent = @intent');
      params.intent = filter.intent;
    }
    if (filter?.priority) {
      conditions.push('priority = @priority');
      params.priority = filter.priority;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const sql = `SELECT * FROM tasks ${where} ORDER BY updated_at DESC LIMIT @limit OFFSET @offset`;
    params.limit = limit;
    params.offset = offset;

    const rows = this.db.prepare(sql).all(params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToTask(row));
  }

  /** Update specific fields on a task */
  update(id: string, updates: Partial<Task>): Task | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const merged: Task = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.save(merged);
    return merged;
  }

  /** Count tasks matching a filter */
  count(filter?: TaskFilter): number {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.status) {
      conditions.push('status = @status');
      params.status = filter.status;
    }
    if (filter?.source) {
      conditions.push('source = @source');
      params.source = filter.source;
    }
    if (filter?.intent) {
      conditions.push('intent = @intent');
      params.intent = filter.intent;
    }
    if (filter?.priority) {
      conditions.push('priority = @priority');
      params.priority = filter.priority;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) as count FROM tasks ${where}`;
    const row = this.db.prepare(sql).get(params) as { count: number };
    return row.count;
  }

  /** Delete a task permanently */
  delete(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes > 0;
  }

  /** Convert a database row to a Task object */
  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      source: row.source as Task['source'],
      sourceId: row.source_id as string | undefined,
      intent: row.intent as Task['intent'],
      title: row.title as string,
      body: row.body as string | undefined,
      priority: row.priority as Task['priority'],
      status: row.status as Task['status'],
      owner: row.owner as string | undefined,
      dueAt: row.due_at as string | undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
    };
  }
}
