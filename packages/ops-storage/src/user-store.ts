/**
 * UserStore — Manages user accounts and API keys for multi-user support.
 *
 * Each user has a unique API key for authentication. Tasks, approvals,
 * and workflows are scoped to the user who created them via the `owner` field.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  apiKey: string;
  role: 'admin' | 'operator' | 'viewer';
  createdAt: string;
  lastLoginAt?: string;
  settings: Record<string, unknown>;
}

export type CreateUserInput = {
  email: string;
  name: string;
  role?: 'admin' | 'operator' | 'viewer';
  settings?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const USERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'operator',
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    settings TEXT NOT NULL DEFAULT '{}'
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
`;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class UserStore {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
    this.db.exec(USERS_TABLE_SQL);
  }

  /** Generate a secure API key. */
  static generateApiKey(): string {
    return `aops_${randomBytes(32).toString('hex')}`;
  }

  /** Create a new user with a generated API key. */
  create(input: CreateUserInput): User {
    const user: User = {
      id: randomUUID(),
      email: input.email,
      name: input.name,
      apiKey: UserStore.generateApiKey(),
      role: input.role ?? 'operator',
      createdAt: new Date().toISOString(),
      settings: input.settings ?? {},
    };

    this.db
      .prepare(
        `INSERT INTO users (id, email, name, api_key, role, created_at, settings)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        user.email,
        user.name,
        user.apiKey,
        user.role,
        user.createdAt,
        JSON.stringify(user.settings),
      );

    return user;
  }

  /** Look up a user by API key. Returns undefined if not found. */
  getByApiKey(apiKey: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE api_key = ?')
      .get(apiKey) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this.rowToUser(row);
  }

  /** Look up a user by ID. */
  get(id: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this.rowToUser(row);
  }

  /** Look up a user by email. */
  getByEmail(email: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this.rowToUser(row);
  }

  /** List all users. */
  list(): User[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];

    return rows.map((r) => this.rowToUser(r));
  }

  /** Update last login timestamp. */
  recordLogin(id: string): void {
    this.db
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /** Regenerate a user's API key. Returns the new key. */
  rotateApiKey(id: string): string | undefined {
    const user = this.get(id);
    if (!user) return undefined;

    const newKey = UserStore.generateApiKey();
    this.db
      .prepare('UPDATE users SET api_key = ? WHERE id = ?')
      .run(newKey, id);

    return newKey;
  }

  /** Update user role. */
  updateRole(id: string, role: 'admin' | 'operator' | 'viewer'): User | undefined {
    this.db
      .prepare('UPDATE users SET role = ? WHERE id = ?')
      .run(role, id);

    return this.get(id);
  }

  /** Delete a user. */
  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM users WHERE id = ?')
      .run(id);

    return result.changes > 0;
  }

  /** Count total users. */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM users')
      .get() as { count: number };

    return row.count;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private rowToUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      apiKey: row.api_key as string,
      role: row.role as 'admin' | 'operator' | 'viewer',
      createdAt: row.created_at as string,
      lastLoginAt: (row.last_login_at as string) || undefined,
      settings: JSON.parse((row.settings as string) || '{}'),
    };
  }
}
