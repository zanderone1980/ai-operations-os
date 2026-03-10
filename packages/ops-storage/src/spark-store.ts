/**
 * SparkStore — SQLite-backed persistence for SPARK predictions,
 * outcomes, learning episodes, weights, and weight history.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  Prediction,
  OutcomeSignal,
  LearningEpisode,
  SparkWeightEntry,
  SparkCategory,
  WeightHistoryEntry,
} from '@ai-ops/shared-types';

export interface SparkEpisodeFilter {
  category?: string;
  limit?: number;
  offset?: number;
}

export interface SparkPredictionFilter {
  runId?: string;
  category?: string;
  limit?: number;
}

export class SparkStore {
  private readonly db: BetterSqlite3.Database;

  // Prediction statements
  private readonly insertPrediction: BetterSqlite3.Statement;
  private readonly getPredictionById: BetterSqlite3.Statement;
  private readonly getPredictionByStep: BetterSqlite3.Statement;

  // Outcome statements
  private readonly insertOutcome: BetterSqlite3.Statement;
  private readonly getOutcomeById: BetterSqlite3.Statement;
  private readonly getOutcomeByStep: BetterSqlite3.Statement;

  // Episode statements
  private readonly insertEpisode: BetterSqlite3.Statement;
  private readonly getEpisodeById: BetterSqlite3.Statement;

  // Weight statements
  private readonly upsertWeight: BetterSqlite3.Statement;
  private readonly getWeightByCategory: BetterSqlite3.Statement;
  private readonly getAllWeightsStmt: BetterSqlite3.Statement;

  // History statements
  private readonly insertHistory: BetterSqlite3.Statement;

  // Snapshot statements
  private readonly insertSnapshot: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;

    // ── Prediction ────────────────────────────────────────────
    this.insertPrediction = this.db.prepare(`
      INSERT INTO spark_predictions
        (id, step_id, run_id, connector, operation, category, predicted_score, predicted_outcome, confidence, created_at)
      VALUES
        (@id, @stepId, @runId, @connector, @operation, @category, @predictedScore, @predictedOutcome, @confidence, @createdAt)
    `);

    this.getPredictionById = this.db.prepare('SELECT * FROM spark_predictions WHERE id = ?');
    this.getPredictionByStep = this.db.prepare('SELECT * FROM spark_predictions WHERE step_id = ?');

    // ── Outcome ───────────────────────────────────────────────
    this.insertOutcome = this.db.prepare(`
      INSERT INTO spark_outcomes
        (id, step_id, run_id, actual_outcome, actual_cord_score, actual_cord_decision, signals, measured_at)
      VALUES
        (@id, @stepId, @runId, @actualOutcome, @actualCordScore, @actualCordDecision, @signals, @measuredAt)
    `);

    this.getOutcomeById = this.db.prepare('SELECT * FROM spark_outcomes WHERE id = ?');
    this.getOutcomeByStep = this.db.prepare('SELECT * FROM spark_outcomes WHERE step_id = ?');

    // ── Episode ───────────────────────────────────────────────
    this.insertEpisode = this.db.prepare(`
      INSERT INTO spark_episodes
        (id, prediction_id, outcome_id, category, score_delta, outcome_mismatch,
         adjustment_direction, adjustment_magnitude, weight_before, weight_after,
         reason, created_at)
      VALUES
        (@id, @predictionId, @outcomeId, @category, @scoreDelta, @outcomeMismatch,
         @adjustmentDirection, @adjustmentMagnitude, @weightBefore, @weightAfter,
         @reason, @createdAt)
    `);

    this.getEpisodeById = this.db.prepare('SELECT * FROM spark_episodes WHERE id = ?');

    // ── Weights ───────────────────────────────────────────────
    this.upsertWeight = this.db.prepare(`
      INSERT OR REPLACE INTO spark_weights
        (category, current_weight, base_weight, lower_bound, upper_bound, episode_count, last_adjusted_at)
      VALUES
        (@category, @currentWeight, @baseWeight, @lowerBound, @upperBound, @episodeCount, @lastAdjustedAt)
    `);

    this.getWeightByCategory = this.db.prepare('SELECT * FROM spark_weights WHERE category = ?');
    this.getAllWeightsStmt = this.db.prepare('SELECT * FROM spark_weights ORDER BY category');

    // ── History ───────────────────────────────────────────────
    this.insertHistory = this.db.prepare(`
      INSERT INTO spark_weight_history
        (id, category, previous_weight, new_weight, episode_id, snapshot_id, reason, created_at)
      VALUES
        (@id, @category, @previousWeight, @newWeight, @episodeId, @snapshotId, @reason, @createdAt)
    `);

    // ── Snapshots ─────────────────────────────────────────────
    this.insertSnapshot = this.db.prepare(`
      INSERT INTO spark_snapshots (id, weights_json, reason, created_at)
      VALUES (@id, @weightsJson, @reason, @createdAt)
    `);
  }

  // ═══════════════════════════════════════════════════════════════
  // Predictions
  // ═══════════════════════════════════════════════════════════════

  savePrediction(p: Prediction): void {
    this.insertPrediction.run({
      id: p.id,
      stepId: p.stepId,
      runId: p.runId,
      connector: p.connector,
      operation: p.operation,
      category: p.category,
      predictedScore: p.predictedScore,
      predictedOutcome: p.predictedOutcome,
      confidence: p.confidence,
      createdAt: p.createdAt,
    });
  }

  getPrediction(id: string): Prediction | undefined {
    const row = this.getPredictionById.get(id) as any;
    return row ? this.rowToPrediction(row) : undefined;
  }

  getPredictionByStepId(stepId: string): Prediction | undefined {
    const row = this.getPredictionByStep.get(stepId) as any;
    return row ? this.rowToPrediction(row) : undefined;
  }

  listPredictions(filter?: SparkPredictionFilter): Prediction[] {
    let sql = 'SELECT * FROM spark_predictions WHERE 1=1';
    const params: any[] = [];

    if (filter?.runId) {
      sql += ' AND run_id = ?';
      params.push(filter.runId);
    }
    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    sql += ' ORDER BY created_at DESC';
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToPrediction(r));
  }

  // ═══════════════════════════════════════════════════════════════
  // Outcomes
  // ═══════════════════════════════════════════════════════════════

  saveOutcome(o: OutcomeSignal): void {
    this.insertOutcome.run({
      id: o.id,
      stepId: o.stepId,
      runId: o.runId,
      actualOutcome: o.actualOutcome,
      actualCordScore: o.actualCordScore,
      actualCordDecision: o.actualCordDecision,
      signals: JSON.stringify(o.signals),
      measuredAt: o.measuredAt,
    });
  }

  getOutcome(id: string): OutcomeSignal | undefined {
    const row = this.getOutcomeById.get(id) as any;
    return row ? this.rowToOutcome(row) : undefined;
  }

  getOutcomeByStepId(stepId: string): OutcomeSignal | undefined {
    const row = this.getOutcomeByStep.get(stepId) as any;
    return row ? this.rowToOutcome(row) : undefined;
  }

  // ═══════════════════════════════════════════════════════════════
  // Learning Episodes
  // ═══════════════════════════════════════════════════════════════

  saveEpisode(ep: LearningEpisode): void {
    this.insertEpisode.run({
      id: ep.id,
      predictionId: ep.predictionId,
      outcomeId: ep.outcomeId,
      category: ep.category,
      scoreDelta: ep.scoreDelta,
      outcomeMismatch: ep.outcomeMismatch ? 1 : 0,
      adjustmentDirection: ep.adjustmentDirection,
      adjustmentMagnitude: ep.adjustmentMagnitude,
      weightBefore: ep.weightBefore,
      weightAfter: ep.weightAfter,
      reason: ep.reason,
      createdAt: ep.createdAt,
    });
  }

  getEpisode(id: string): LearningEpisode | undefined {
    const row = this.getEpisodeById.get(id) as any;
    return row ? this.rowToEpisode(row) : undefined;
  }

  listEpisodes(filter?: SparkEpisodeFilter): LearningEpisode[] {
    let sql = 'SELECT * FROM spark_episodes WHERE 1=1';
    const params: any[] = [];

    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    sql += ' ORDER BY created_at DESC';
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    if (filter?.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToEpisode(r));
  }

  countEpisodes(filter?: { category?: string }): number {
    let sql = 'SELECT COUNT(*) as count FROM spark_episodes WHERE 1=1';
    const params: any[] = [];

    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }

    const row = this.db.prepare(sql).get(...params) as any;
    return row?.count ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // Weights
  // ═══════════════════════════════════════════════════════════════

  getWeight(category: SparkCategory): SparkWeightEntry | undefined {
    const row = this.getWeightByCategory.get(category) as any;
    return row ? this.rowToWeight(row) : undefined;
  }

  getAllWeights(): SparkWeightEntry[] {
    const rows = this.getAllWeightsStmt.all() as any[];
    return rows.map(r => this.rowToWeight(r));
  }

  saveWeight(entry: SparkWeightEntry): void {
    this.upsertWeight.run({
      category: entry.category,
      currentWeight: entry.currentWeight,
      baseWeight: entry.baseWeight,
      lowerBound: entry.lowerBound,
      upperBound: entry.upperBound,
      episodeCount: entry.episodeCount,
      lastAdjustedAt: entry.lastAdjustedAt,
    });
  }

  initializeWeights(defaults: SparkWeightEntry[]): void {
    const txn = this.db.transaction(() => {
      for (const d of defaults) {
        this.saveWeight(d);
      }
    });
    txn();
  }

  // ═══════════════════════════════════════════════════════════════
  // Weight History
  // ═══════════════════════════════════════════════════════════════

  saveHistoryEntry(entry: WeightHistoryEntry): void {
    this.insertHistory.run({
      id: entry.id,
      category: entry.category,
      previousWeight: entry.previousWeight,
      newWeight: entry.newWeight,
      episodeId: entry.episodeId,
      snapshotId: entry.snapshotId,
      reason: entry.reason,
      createdAt: entry.createdAt,
    });
  }

  getHistory(filter?: { category?: string; limit?: number }): WeightHistoryEntry[] {
    let sql = 'SELECT * FROM spark_weight_history WHERE 1=1';
    const params: any[] = [];

    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    sql += ' ORDER BY created_at DESC';
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToHistory(r));
  }

  // ═══════════════════════════════════════════════════════════════
  // Snapshots
  // ═══════════════════════════════════════════════════════════════

  createSnapshot(reason: string): string {
    const id = randomUUID();
    const weights = this.getAllWeights();
    this.insertSnapshot.run({
      id,
      weightsJson: JSON.stringify(weights),
      reason,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  restoreSnapshot(snapshotId: string): void {
    const row = this.db.prepare('SELECT * FROM spark_snapshots WHERE id = ?').get(snapshotId) as any;
    if (!row) throw new Error(`Snapshot not found: ${snapshotId}`);

    const weights: SparkWeightEntry[] = JSON.parse(row.weights_json);
    const txn = this.db.transaction(() => {
      for (const w of weights) {
        this.saveWeight(w);
      }
    });
    txn();
  }

  listSnapshots(limit = 20): Array<{ id: string; reason: string; createdAt: string }> {
    const rows = this.db.prepare(
      'SELECT id, reason, created_at FROM spark_snapshots ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as any[];

    return rows.map(r => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // Row mappers
  // ═══════════════════════════════════════════════════════════════

  private rowToPrediction(row: any): Prediction {
    return {
      id: row.id,
      stepId: row.step_id,
      runId: row.run_id,
      connector: row.connector,
      operation: row.operation,
      category: row.category,
      predictedScore: row.predicted_score,
      predictedOutcome: row.predicted_outcome,
      confidence: row.confidence,
      createdAt: row.created_at,
    };
  }

  private rowToOutcome(row: any): OutcomeSignal {
    return {
      id: row.id,
      stepId: row.step_id,
      runId: row.run_id,
      actualOutcome: row.actual_outcome,
      actualCordScore: row.actual_cord_score,
      actualCordDecision: row.actual_cord_decision,
      signals: JSON.parse(row.signals || '{}'),
      measuredAt: row.measured_at,
    };
  }

  private rowToEpisode(row: any): LearningEpisode {
    return {
      id: row.id,
      predictionId: row.prediction_id,
      outcomeId: row.outcome_id,
      category: row.category,
      scoreDelta: row.score_delta,
      outcomeMismatch: !!row.outcome_mismatch,
      adjustmentDirection: row.adjustment_direction,
      adjustmentMagnitude: row.adjustment_magnitude,
      weightBefore: row.weight_before,
      weightAfter: row.weight_after,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }

  private rowToWeight(row: any): SparkWeightEntry {
    return {
      category: row.category,
      currentWeight: row.current_weight,
      baseWeight: row.base_weight,
      lowerBound: row.lower_bound,
      upperBound: row.upper_bound,
      episodeCount: row.episode_count,
      lastAdjustedAt: row.last_adjusted_at,
    };
  }

  private rowToHistory(row: any): WeightHistoryEntry {
    return {
      id: row.id,
      category: row.category,
      previousWeight: row.previous_weight,
      newWeight: row.new_weight,
      episodeId: row.episode_id,
      snapshotId: row.snapshot_id,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }
}
