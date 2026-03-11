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

      -- SPARK tables (Self-Perpetuating Adaptive Reasoning Kernel)

      CREATE TABLE IF NOT EXISTS spark_predictions (
        id TEXT PRIMARY KEY,
        step_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        connector TEXT NOT NULL,
        operation TEXT NOT NULL,
        category TEXT NOT NULL,
        predicted_score INTEGER NOT NULL,
        predicted_outcome TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spark_predictions_step_id ON spark_predictions(step_id);
      CREATE INDEX IF NOT EXISTS idx_spark_predictions_run_id ON spark_predictions(run_id);
      CREATE INDEX IF NOT EXISTS idx_spark_predictions_category ON spark_predictions(category);

      CREATE TABLE IF NOT EXISTS spark_outcomes (
        id TEXT PRIMARY KEY,
        step_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        actual_outcome TEXT NOT NULL,
        actual_cord_score INTEGER NOT NULL,
        actual_cord_decision TEXT NOT NULL,
        signals TEXT NOT NULL DEFAULT '{}',
        measured_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spark_outcomes_step_id ON spark_outcomes(step_id);
      CREATE INDEX IF NOT EXISTS idx_spark_outcomes_run_id ON spark_outcomes(run_id);

      CREATE TABLE IF NOT EXISTS spark_episodes (
        id TEXT PRIMARY KEY,
        prediction_id TEXT NOT NULL,
        outcome_id TEXT NOT NULL,
        category TEXT NOT NULL,
        score_delta REAL NOT NULL,
        outcome_mismatch INTEGER NOT NULL,
        adjustment_direction TEXT NOT NULL,
        adjustment_magnitude REAL NOT NULL,
        weight_before REAL NOT NULL,
        weight_after REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spark_episodes_category ON spark_episodes(category);
      CREATE INDEX IF NOT EXISTS idx_spark_episodes_created_at ON spark_episodes(created_at);

      CREATE TABLE IF NOT EXISTS spark_weights (
        category TEXT PRIMARY KEY,
        current_weight REAL NOT NULL,
        base_weight REAL NOT NULL,
        lower_bound REAL NOT NULL,
        upper_bound REAL NOT NULL,
        episode_count INTEGER NOT NULL DEFAULT 0,
        last_adjusted_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS spark_weight_history (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        previous_weight REAL NOT NULL,
        new_weight REAL NOT NULL,
        episode_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spark_weight_history_category ON spark_weight_history(category);
      CREATE INDEX IF NOT EXISTS idx_spark_weight_history_created_at ON spark_weight_history(created_at);

      CREATE TABLE IF NOT EXISTS spark_snapshots (
        id TEXT PRIMARY KEY,
        weights_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- ── SPARK Awareness Layer ─────────────────────────────────

      CREATE TABLE IF NOT EXISTS spark_insights (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        pattern TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        impact REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spark_insights_category ON spark_insights(category);
      CREATE INDEX IF NOT EXISTS idx_spark_insights_pattern ON spark_insights(pattern);
      CREATE INDEX IF NOT EXISTS idx_spark_insights_created_at ON spark_insights(created_at);
      CREATE INDEX IF NOT EXISTS idx_spark_insights_impact ON spark_insights(impact);

      CREATE TABLE IF NOT EXISTS spark_beliefs (
        category TEXT PRIMARY KEY,
        trust_level TEXT NOT NULL,
        stability REAL NOT NULL,
        calibration REAL NOT NULL,
        narrative TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      -- ── SPARK Conversations ─────────────────────────────────

      CREATE TABLE IF NOT EXISTS spark_conversations (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        turn_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_spark_conversations_last_activity
        ON spark_conversations(last_activity_at);

      CREATE TABLE IF NOT EXISTS spark_conversation_turns (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        reasoning_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES spark_conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_spark_turns_conversation_id
        ON spark_conversation_turns(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_spark_turns_created_at
        ON spark_conversation_turns(created_at);

      -- ── SPARK Spiral Memory ─────────────────────────────────

      CREATE TABLE IF NOT EXISTS spark_memory_tokens (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        tier TEXT NOT NULL,
        essence_json TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        spiral_count INTEGER NOT NULL DEFAULT 0,
        source_id TEXT NOT NULL,
        merged_from_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        last_spiral_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_spark_memory_tokens_type
        ON spark_memory_tokens(type);
      CREATE INDEX IF NOT EXISTS idx_spark_memory_tokens_tier
        ON spark_memory_tokens(tier);
      CREATE INDEX IF NOT EXISTS idx_spark_memory_tokens_strength
        ON spark_memory_tokens(strength);
      CREATE INDEX IF NOT EXISTS idx_spark_memory_tokens_source_id
        ON spark_memory_tokens(source_id);
      CREATE INDEX IF NOT EXISTS idx_spark_memory_tokens_created_at
        ON spark_memory_tokens(created_at);
      CREATE INDEX IF NOT EXISTS idx_spark_memory_tokens_archived_at
        ON spark_memory_tokens(archived_at);

      CREATE TABLE IF NOT EXISTS spark_memory_edges (
        id TEXT PRIMARY KEY,
        from_token_id TEXT NOT NULL,
        to_token_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0.5,
        reinforce_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_reinforced_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spark_memory_edges_from
        ON spark_memory_edges(from_token_id);
      CREATE INDEX IF NOT EXISTS idx_spark_memory_edges_to
        ON spark_memory_edges(to_token_id);
      CREATE INDEX IF NOT EXISTS idx_spark_memory_edges_type
        ON spark_memory_edges(type);

      CREATE TABLE IF NOT EXISTS spark_memory_topic_index (
        topic TEXT NOT NULL,
        token_id TEXT NOT NULL,
        tf_idf_score REAL NOT NULL DEFAULT 0.0,
        PRIMARY KEY (topic, token_id)
      );

      CREATE INDEX IF NOT EXISTS idx_spark_memory_topic_index_topic
        ON spark_memory_topic_index(topic);

      -- ── SPARK Emotional State ────────────────────────────────

      CREATE TABLE IF NOT EXISTS spark_emotional_state (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        valence REAL NOT NULL DEFAULT 0.0,
        momentum TEXT NOT NULL DEFAULT 'stable',
        volatility REAL NOT NULL DEFAULT 0.0,
        high_emotion_count INTEGER NOT NULL DEFAULT 0,
        valence_history_json TEXT NOT NULL DEFAULT '[]',
        high_emotion_token_ids_json TEXT NOT NULL DEFAULT '[]',
        last_updated_at TEXT NOT NULL
      );

      -- ── SPARK Self-Reflections ───────────────────────────────

      CREATE TABLE IF NOT EXISTS spark_reflections (
        id TEXT PRIMARY KEY,
        blind_spots_json TEXT NOT NULL DEFAULT '[]',
        growth_json TEXT NOT NULL DEFAULT '{}',
        emotional_summary TEXT NOT NULL DEFAULT '',
        internal_narrative TEXT NOT NULL DEFAULT '',
        token_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spark_reflections_created_at
        ON spark_reflections(created_at);

      -- ── SPARK Personality ─────────────────────────────────────

      CREATE TABLE IF NOT EXISTS spark_personality (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        curiosity REAL NOT NULL DEFAULT 0.5,
        caution REAL NOT NULL DEFAULT 0.5,
        warmth REAL NOT NULL DEFAULT 0.5,
        directness REAL NOT NULL DEFAULT 0.5,
        playfulness REAL NOT NULL DEFAULT 0.5
      );

      -- ── Audit Log ────────────────────────────────────────────

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        actor_id TEXT,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT NOT NULL DEFAULT '{}',
        ip_address TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_event_type
        ON audit_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
        ON audit_log(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
        ON audit_log(created_at);

      -- ── Credential Vault ─────────────────────────────────────

      CREATE TABLE IF NOT EXISTS credentials_vault (
        id TEXT PRIMARY KEY,
        connector TEXT NOT NULL,
        key TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_credentials_vault_connector
        ON credentials_vault(connector);
      CREATE INDEX IF NOT EXISTS idx_credentials_vault_user_id
        ON credentials_vault(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_credentials_vault_connector_key_user
        ON credentials_vault(connector, key, user_id);
    `);
  }

  close(): void {
    this.db.close();
  }
}
