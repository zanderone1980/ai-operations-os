/**
 * CredentialStore — Manages encrypted connector credentials in the vault.
 *
 * Credentials are stored as encrypted blobs (AES-256-GCM via ops-auth vault).
 * This store handles CRUD — the encryption/decryption is done at the API layer.
 */

import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredCredential {
  id: string;
  connector: string;
  key: string;
  encryptedValue: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class CredentialStore {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  /** Store an encrypted credential. Upserts on (connector, key, user_id). */
  save(
    connector: string,
    key: string,
    encryptedValue: string,
    userId?: string,
  ): StoredCredential {
    const now = new Date().toISOString();
    const uid = userId ?? null;

    // Check for existing
    const existing = this.db
      .prepare(
        `SELECT id FROM credentials_vault
         WHERE connector = ? AND key = ? AND (user_id = ? OR (user_id IS NULL AND ? IS NULL))`,
      )
      .get(connector, key, uid, uid) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare('UPDATE credentials_vault SET encrypted_value = ?, updated_at = ? WHERE id = ?')
        .run(encryptedValue, now, existing.id);
      return this.get(existing.id)!;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO credentials_vault (id, connector, key, encrypted_value, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, connector, key, encryptedValue, uid, now, now);

    return {
      id,
      connector,
      key,
      encryptedValue,
      userId: uid,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Get a single credential by ID. */
  get(id: string): StoredCredential | undefined {
    const row = this.db
      .prepare('SELECT * FROM credentials_vault WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this.rowToCredential(row);
  }

  /** Get all credentials for a connector (optionally scoped to a user). */
  getForConnector(connector: string, userId?: string): StoredCredential[] {
    let rows: Record<string, unknown>[];

    if (userId) {
      rows = this.db
        .prepare(
          `SELECT * FROM credentials_vault
           WHERE connector = ? AND (user_id = ? OR user_id IS NULL)
           ORDER BY created_at DESC`,
        )
        .all(connector, userId) as Record<string, unknown>[];
    } else {
      rows = this.db
        .prepare(
          `SELECT * FROM credentials_vault
           WHERE connector = ?
           ORDER BY created_at DESC`,
        )
        .all(connector) as Record<string, unknown>[];
    }

    return rows.map((r) => this.rowToCredential(r));
  }

  /** List all stored credentials (without decrypted values). */
  list(userId?: string): StoredCredential[] {
    let rows: Record<string, unknown>[];

    if (userId) {
      rows = this.db
        .prepare(
          `SELECT * FROM credentials_vault
           WHERE user_id = ? OR user_id IS NULL
           ORDER BY connector, key`,
        )
        .all(userId) as Record<string, unknown>[];
    } else {
      rows = this.db
        .prepare('SELECT * FROM credentials_vault ORDER BY connector, key')
        .all() as Record<string, unknown>[];
    }

    return rows.map((r) => this.rowToCredential(r));
  }

  /** Delete a credential by ID. */
  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM credentials_vault WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /** Delete all credentials for a connector. */
  deleteForConnector(connector: string, userId?: string): number {
    let result;

    if (userId) {
      result = this.db
        .prepare('DELETE FROM credentials_vault WHERE connector = ? AND user_id = ?')
        .run(connector, userId);
    } else {
      result = this.db
        .prepare('DELETE FROM credentials_vault WHERE connector = ?')
        .run(connector);
    }

    return result.changes;
  }

  /** Count total stored credentials. */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM credentials_vault')
      .get() as { count: number };
    return row.count;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private rowToCredential(row: Record<string, unknown>): StoredCredential {
    return {
      id: row.id as string,
      connector: row.connector as string,
      key: row.key as string,
      encryptedValue: row.encrypted_value as string,
      userId: (row.user_id as string) || null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
