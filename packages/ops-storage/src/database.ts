/**
 * Database — SQLite persistence layer for AI Operations OS.
 *
 * Opens/creates a SQLite database (default: ~/.ai-ops/data.db),
 * creates all required tables on first run, and uses WAL mode
 * for better concurrency.
 */

import BetterSqlite3 from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const DEFAULT_DB_DIR = path.join(os.homedir(), '.ai-ops');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'data.db');

export class Database {
  readonly db: BetterSqlite3.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT,
        intent TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        owner TEXT,
        due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
      CREATE INDEX IF NOT EXISTS idx_tasks_intent ON tasks(intent);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        workflow_type TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        error TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_task_id ON workflow_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_state ON workflow_runs(state);

      CREATE TABLE IF NOT EXISTS workflow_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        connector TEXT NOT NULL,
        operation TEXT NOT NULL,
        input TEXT NOT NULL DEFAULT '{}',
        output TEXT,
        status TEXT NOT NULL,
        cord_decision TEXT,
        cord_score INTEGER,
        error TEXT,
        duration_ms INTEGER,
        step_order INTEGER NOT NULL,
        FOREIGN KEY (run_id) REFERENCES workflow_runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_steps_run_id ON workflow_steps(run_id);

      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        connector TEXT NOT NULL,
        operation TEXT NOT NULL,
        input TEXT NOT NULL DEFAULT '{}',
        output TEXT,
        status TEXT NOT NULL,
        executed_at TEXT,
        duration_ms INTEGER,
        error TEXT,
        FOREIGN KEY (run_id) REFERENCES workflow_runs(id),
        FOREIGN KEY (step_id) REFERENCES workflow_steps(id)
      );

      CREATE INDEX IF NOT EXISTS idx_actions_run_id ON actions(run_id);

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        risk TEXT NOT NULL,
        reason TEXT NOT NULL,
        preview TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decision TEXT,
        decided_by TEXT,
        decided_at TEXT,
        modifications TEXT,
        ttl_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_decision ON approvals(decision);
      CREATE INDEX IF NOT EXISTS idx_approvals_task_id ON approvals(task_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_risk ON approvals(risk);

      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        cord_decision TEXT NOT NULL,
        cord_score INTEGER NOT NULL,
        cord_reasons TEXT NOT NULL DEFAULT '[]',
        input TEXT NOT NULL DEFAULT '{}',
        output TEXT,
        timestamp TEXT NOT NULL,
        hash TEXT NOT NULL,
        signature TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        FOREIGN KEY (action_id) REFERENCES actions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_receipts_action_id ON receipts(action_id);
    `);
  }

  close(): void {
    this.db.close();
  }
}
