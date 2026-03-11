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
  Insight,
  InsightPattern,
  Belief,
  Conversation,
  ConversationTurn,
  ReasoningResult,
  MemoryToken,
  MemoryEdge,
  MemoryTokenType,
  CompressionTier,
  Essence,
  ReflectionResult,
} from '@ai-operations/shared-types';

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

export interface SparkInsightFilter {
  category?: string;
  pattern?: InsightPattern;
  limit?: number;
  minImpact?: number;
}

export interface SparkMemoryTokenFilter {
  type?: MemoryTokenType;
  tier?: CompressionTier;
  minStrength?: number;
  excludeArchived?: boolean;
  limit?: number;
}

export interface SparkMemoryEdgeFilter {
  minWeight?: number;
  type?: string;
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

  // Insight statements
  private readonly insertInsight: BetterSqlite3.Statement;
  private readonly getInsightById: BetterSqlite3.Statement;

  // Belief statements
  private readonly upsertBelief: BetterSqlite3.Statement;
  private readonly getBeliefByCategory: BetterSqlite3.Statement;
  private readonly getAllBeliefsStmt: BetterSqlite3.Statement;

  // Conversation statements
  private readonly insertConversationStmt: BetterSqlite3.Statement;
  private readonly updateConversationStmt: BetterSqlite3.Statement;
  private readonly getConversationByIdStmt: BetterSqlite3.Statement;
  private readonly insertTurnStmt: BetterSqlite3.Statement;

  // Memory token statements
  private readonly insertMemoryToken: BetterSqlite3.Statement;
  private readonly getMemoryTokenById: BetterSqlite3.Statement;
  private readonly updateTokenStrengthStmt: BetterSqlite3.Statement;
  private readonly updateTokenTierStmt: BetterSqlite3.Statement;
  private readonly archiveTokenStmt: BetterSqlite3.Statement;

  // Memory edge statements
  private readonly insertMemoryEdge: BetterSqlite3.Statement;
  private readonly getMemoryEdgeById: BetterSqlite3.Statement;
  private readonly reinforceEdgeStmt: BetterSqlite3.Statement;

  // Topic index statements
  private readonly upsertTopicIndexStmt: BetterSqlite3.Statement;
  private readonly deleteTopicIndexStmt: BetterSqlite3.Statement;

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

    // ── Insights ────────────────────────────────────────────
    this.insertInsight = this.db.prepare(`
      INSERT INTO spark_insights
        (id, category, pattern, summary, evidence_json, impact, created_at)
      VALUES
        (@id, @category, @pattern, @summary, @evidenceJson, @impact, @createdAt)
    `);

    this.getInsightById = this.db.prepare('SELECT * FROM spark_insights WHERE id = ?');

    // ── Beliefs ─────────────────────────────────────────────
    this.upsertBelief = this.db.prepare(`
      INSERT OR REPLACE INTO spark_beliefs
        (category, trust_level, stability, calibration, narrative, evidence_json, updated_at)
      VALUES
        (@category, @trustLevel, @stability, @calibration, @narrative, @evidenceJson, @updatedAt)
    `);

    this.getBeliefByCategory = this.db.prepare('SELECT * FROM spark_beliefs WHERE category = ?');
    this.getAllBeliefsStmt = this.db.prepare('SELECT * FROM spark_beliefs ORDER BY category');

    // ── Conversations ───────────────────────────────────────
    this.insertConversationStmt = this.db.prepare(`
      INSERT INTO spark_conversations (id, created_at, last_activity_at, turn_count)
      VALUES (@id, @createdAt, @lastActivityAt, @turnCount)
    `);

    this.updateConversationStmt = this.db.prepare(`
      UPDATE spark_conversations SET last_activity_at = @lastActivityAt, turn_count = @turnCount
      WHERE id = @id
    `);

    this.getConversationByIdStmt = this.db.prepare('SELECT * FROM spark_conversations WHERE id = ?');

    this.insertTurnStmt = this.db.prepare(`
      INSERT INTO spark_conversation_turns (id, conversation_id, role, content, reasoning_json, created_at)
      VALUES (@id, @conversationId, @role, @content, @reasoningJson, @createdAt)
    `);

    // ── Memory Tokens ─────────────────────────────────────────
    this.insertMemoryToken = this.db.prepare(`
      INSERT INTO spark_memory_tokens
        (id, type, tier, essence_json, strength, spiral_count, source_id, merged_from_json, created_at, last_spiral_at, archived_at)
      VALUES
        (@id, @type, @tier, @essenceJson, @strength, @spiralCount, @sourceId, @mergedFromJson, @createdAt, @lastSpiralAt, @archivedAt)
    `);

    this.getMemoryTokenById = this.db.prepare('SELECT * FROM spark_memory_tokens WHERE id = ?');

    this.updateTokenStrengthStmt = this.db.prepare(`
      UPDATE spark_memory_tokens SET strength = @strength, spiral_count = @spiralCount, last_spiral_at = @lastSpiralAt
      WHERE id = @id
    `);

    this.updateTokenTierStmt = this.db.prepare(`
      UPDATE spark_memory_tokens SET tier = @tier WHERE id = @id
    `);

    this.archiveTokenStmt = this.db.prepare(`
      UPDATE spark_memory_tokens SET archived_at = @archivedAt WHERE id = @id
    `);

    // ── Memory Edges ──────────────────────────────────────────
    this.insertMemoryEdge = this.db.prepare(`
      INSERT INTO spark_memory_edges
        (id, from_token_id, to_token_id, type, weight, reinforce_count, created_at, last_reinforced_at)
      VALUES
        (@id, @fromTokenId, @toTokenId, @type, @weight, @reinforceCount, @createdAt, @lastReinforcedAt)
    `);

    this.getMemoryEdgeById = this.db.prepare('SELECT * FROM spark_memory_edges WHERE id = ?');

    this.reinforceEdgeStmt = this.db.prepare(`
      UPDATE spark_memory_edges SET weight = @weight, reinforce_count = @reinforceCount, last_reinforced_at = @lastReinforcedAt
      WHERE id = @id
    `);

    // ── Topic Index ───────────────────────────────────────────
    this.upsertTopicIndexStmt = this.db.prepare(`
      INSERT OR REPLACE INTO spark_memory_topic_index (topic, token_id, tf_idf_score)
      VALUES (@topic, @tokenId, @tfIdfScore)
    `);

    this.deleteTopicIndexStmt = this.db.prepare(
      'DELETE FROM spark_memory_topic_index WHERE token_id = ?'
    );
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

  // ═══════════════════════════════════════════════════════════════
  // Insights
  // ═══════════════════════════════════════════════════════════════

  saveInsight(insight: Insight): void {
    this.insertInsight.run({
      id: insight.id,
      category: insight.category,
      pattern: insight.pattern,
      summary: insight.summary,
      evidenceJson: JSON.stringify(insight.evidence),
      impact: insight.impact,
      createdAt: insight.createdAt,
    });
  }

  getInsight(id: string): Insight | undefined {
    const row = this.getInsightById.get(id) as any;
    return row ? this.rowToInsight(row) : undefined;
  }

  listInsights(filter?: SparkInsightFilter): Insight[] {
    let sql = 'SELECT * FROM spark_insights WHERE 1=1';
    const params: any[] = [];

    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    if (filter?.pattern) {
      sql += ' AND pattern = ?';
      params.push(filter.pattern);
    }
    if (filter?.minImpact !== undefined) {
      sql += ' AND impact >= ?';
      params.push(filter.minImpact);
    }
    sql += ' ORDER BY created_at DESC';
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToInsight(r));
  }

  // ═══════════════════════════════════════════════════════════════
  // Beliefs
  // ═══════════════════════════════════════════════════════════════

  saveBelief(belief: Belief): void {
    this.upsertBelief.run({
      category: belief.category,
      trustLevel: belief.trustLevel,
      stability: belief.stability,
      calibration: belief.calibration,
      narrative: belief.narrative,
      evidenceJson: JSON.stringify(belief.evidence),
      updatedAt: belief.updatedAt,
    });
  }

  getBelief(category: SparkCategory): Belief | undefined {
    const row = this.getBeliefByCategory.get(category) as any;
    return row ? this.rowToBelief(row) : undefined;
  }

  getAllBeliefs(): Belief[] {
    const rows = this.getAllBeliefsStmt.all() as any[];
    return rows.map(r => this.rowToBelief(r));
  }

  private rowToInsight(row: any): Insight {
    return {
      id: row.id,
      category: row.category,
      pattern: row.pattern,
      summary: row.summary,
      evidence: JSON.parse(row.evidence_json || '{}'),
      impact: row.impact,
      createdAt: row.created_at,
    };
  }

  private rowToBelief(row: any): Belief {
    return {
      category: row.category,
      trustLevel: row.trust_level,
      stability: row.stability,
      calibration: row.calibration,
      narrative: row.narrative,
      evidence: JSON.parse(row.evidence_json || '{}'),
      updatedAt: row.updated_at,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Conversations
  // ═══════════════════════════════════════════════════════════════

  saveConversation(conv: Conversation): void {
    this.insertConversationStmt.run({
      id: conv.id,
      createdAt: conv.createdAt,
      lastActivityAt: conv.lastActivityAt,
      turnCount: conv.turnCount,
    });
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.getConversationByIdStmt.get(id) as any;
    return row ? this.rowToConversation(row) : undefined;
  }

  updateConversationActivity(id: string, lastActivityAt: string, turnCount: number): void {
    this.updateConversationStmt.run({ id, lastActivityAt, turnCount });
  }

  saveTurn(turn: ConversationTurn): void {
    this.insertTurnStmt.run({
      id: turn.id,
      conversationId: turn.conversationId,
      role: turn.role,
      content: turn.content,
      reasoningJson: turn.reasoningResult ? JSON.stringify(turn.reasoningResult) : null,
      createdAt: turn.createdAt,
    });
  }

  listTurns(conversationId: string, limit = 50): ConversationTurn[] {
    const rows = this.db.prepare(
      'SELECT * FROM spark_conversation_turns WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?'
    ).all(conversationId, limit) as any[];
    return rows.map(r => this.rowToTurn(r));
  }

  listRecentConversations(limit = 20): Conversation[] {
    const rows = this.db.prepare(
      'SELECT * FROM spark_conversations ORDER BY last_activity_at DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map(r => this.rowToConversation(r));
  }

  private rowToConversation(row: any): Conversation {
    return {
      id: row.id,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      turnCount: row.turn_count,
    };
  }

  private rowToTurn(row: any): ConversationTurn {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      reasoningResult: row.reasoning_json ? JSON.parse(row.reasoning_json) : undefined,
      createdAt: row.created_at,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Memory Tokens
  // ═══════════════════════════════════════════════════════════════

  saveMemoryToken(token: MemoryToken): void {
    this.insertMemoryToken.run({
      id: token.id,
      type: token.type,
      tier: token.tier,
      essenceJson: JSON.stringify(token.essence),
      strength: token.strength,
      spiralCount: token.spiralCount,
      sourceId: token.sourceId,
      mergedFromJson: JSON.stringify(token.mergedFrom),
      createdAt: token.createdAt,
      lastSpiralAt: token.lastSpiralAt,
      archivedAt: token.archivedAt,
    });
  }

  getMemoryToken(id: string): MemoryToken | undefined {
    const row = this.getMemoryTokenById.get(id) as any;
    return row ? this.rowToMemoryToken(row) : undefined;
  }

  updateMemoryTokenStrength(id: string, strength: number, spiralCount: number, lastSpiralAt: string): void {
    this.updateTokenStrengthStmt.run({ id, strength, spiralCount, lastSpiralAt });
  }

  updateMemoryTokenTier(id: string, tier: CompressionTier): void {
    this.updateTokenTierStmt.run({ id, tier });
  }

  archiveMemoryToken(id: string, archivedAt: string): void {
    this.archiveTokenStmt.run({ id, archivedAt });
  }

  listMemoryTokens(filter?: SparkMemoryTokenFilter): MemoryToken[] {
    let sql = 'SELECT * FROM spark_memory_tokens WHERE 1=1';
    const params: any[] = [];

    if (filter?.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }
    if (filter?.tier) {
      sql += ' AND tier = ?';
      params.push(filter.tier);
    }
    if (filter?.minStrength !== undefined) {
      sql += ' AND strength >= ?';
      params.push(filter.minStrength);
    }
    if (filter?.excludeArchived) {
      sql += ' AND archived_at IS NULL';
    }
    sql += ' ORDER BY created_at DESC';
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToMemoryToken(r));
  }

  findTokensByTopics(topics: string[], limit = 20): MemoryToken[] {
    if (topics.length === 0) return [];

    const placeholders = topics.map(() => '?').join(', ');
    const sql = `
      SELECT t.*, SUM(ti.tf_idf_score) as total_score
      FROM spark_memory_topic_index ti
      JOIN spark_memory_tokens t ON t.id = ti.token_id
      WHERE ti.topic IN (${placeholders})
        AND t.archived_at IS NULL
      GROUP BY t.id
      ORDER BY total_score DESC
      LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(...topics, limit) as any[];
    return rows.map(r => this.rowToMemoryToken(r));
  }

  countMemoryTokens(filter?: { excludeArchived?: boolean }): number {
    let sql = 'SELECT COUNT(*) as count FROM spark_memory_tokens WHERE 1=1';
    if (filter?.excludeArchived) sql += ' AND archived_at IS NULL';
    const row = this.db.prepare(sql).get() as any;
    return row?.count ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // Memory Edges
  // ═══════════════════════════════════════════════════════════════

  saveMemoryEdge(edge: MemoryEdge): void {
    this.insertMemoryEdge.run({
      id: edge.id,
      fromTokenId: edge.fromTokenId,
      toTokenId: edge.toTokenId,
      type: edge.type,
      weight: edge.weight,
      reinforceCount: edge.reinforceCount,
      createdAt: edge.createdAt,
      lastReinforcedAt: edge.lastReinforcedAt,
    });
  }

  getMemoryEdge(id: string): MemoryEdge | undefined {
    const row = this.getMemoryEdgeById.get(id) as any;
    return row ? this.rowToMemoryEdge(row) : undefined;
  }

  reinforceEdge(id: string, weight: number, reinforceCount: number, lastReinforcedAt: string): void {
    this.reinforceEdgeStmt.run({ id, weight, reinforceCount, lastReinforcedAt });
  }

  getEdgesForToken(tokenId: string): MemoryEdge[] {
    const rows = this.db.prepare(
      'SELECT * FROM spark_memory_edges WHERE from_token_id = ? OR to_token_id = ?'
    ).all(tokenId, tokenId) as any[];
    return rows.map(r => this.rowToMemoryEdge(r));
  }

  getEdgesBetween(fromTokenId: string, toTokenId: string): MemoryEdge[] {
    const rows = this.db.prepare(
      'SELECT * FROM spark_memory_edges WHERE (from_token_id = ? AND to_token_id = ?) OR (from_token_id = ? AND to_token_id = ?)'
    ).all(fromTokenId, toTokenId, toTokenId, fromTokenId) as any[];
    return rows.map(r => this.rowToMemoryEdge(r));
  }

  listMemoryEdges(filter?: SparkMemoryEdgeFilter): MemoryEdge[] {
    let sql = 'SELECT * FROM spark_memory_edges WHERE 1=1';
    const params: any[] = [];

    if (filter?.minWeight !== undefined) {
      sql += ' AND weight >= ?';
      params.push(filter.minWeight);
    }
    if (filter?.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }
    sql += ' ORDER BY weight DESC';
    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToMemoryEdge(r));
  }

  /**
   * Delete a single memory edge by ID.
   */
  deleteMemoryEdge(id: string): void {
    this.db.prepare('DELETE FROM spark_memory_edges WHERE id = ?').run(id);
  }

  /**
   * Prune all edges below a weight threshold.
   * Returns the number of edges pruned.
   */
  pruneEdgesBelow(minWeight: number): number {
    const result = this.db.prepare('DELETE FROM spark_memory_edges WHERE weight < ?').run(minWeight);
    return result.changes;
  }

  // ═══════════════════════════════════════════════════════════════
  // Topic Index
  // ═══════════════════════════════════════════════════════════════

  upsertTopicIndex(topic: string, tokenId: string, tfIdfScore: number): void {
    this.upsertTopicIndexStmt.run({ topic, tokenId, tfIdfScore });
  }

  deleteTopicIndex(tokenId: string): void {
    this.deleteTopicIndexStmt.run(tokenId);
  }

  lookupTopics(topics: string[], limit = 20): Array<{ tokenId: string; totalScore: number }> {
    if (topics.length === 0) return [];
    const placeholders = topics.map(() => '?').join(', ');
    const sql = `
      SELECT token_id, SUM(tf_idf_score) as total_score
      FROM spark_memory_topic_index
      WHERE topic IN (${placeholders})
      GROUP BY token_id
      ORDER BY total_score DESC
      LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(...topics, limit) as any[];
    return rows.map(r => ({ tokenId: r.token_id, totalScore: r.total_score }));
  }

  getTopicDocumentCount(): number {
    const row = this.db.prepare(
      'SELECT COUNT(DISTINCT token_id) as count FROM spark_memory_topic_index'
    ).get() as any;
    return row?.count ?? 0;
  }

  /**
   * Get the document frequency for a specific term (number of tokens containing it).
   * Used for real TF-IDF calculation: idf = log(totalDocs / (1 + df))
   */
  getDocumentFrequency(term: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(DISTINCT token_id) as count FROM spark_memory_topic_index WHERE topic = ?'
    ).get(term) as any;
    return row?.count ?? 0;
  }

  /**
   * Batch document frequency lookup for multiple terms.
   * Returns a map from term → document frequency.
   */
  getDocumentFrequencies(terms: string[]): Map<string, number> {
    if (terms.length === 0) return new Map();
    const result = new Map<string, number>();
    const placeholders = terms.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT topic, COUNT(DISTINCT token_id) as count FROM spark_memory_topic_index WHERE topic IN (${placeholders}) GROUP BY topic`
    ).all(...terms) as any[];
    for (const row of rows) {
      result.set(row.topic, row.count);
    }
    // Fill in zero for terms not found
    for (const term of terms) {
      if (!result.has(term)) result.set(term, 0);
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // Emotional State
  // ═══════════════════════════════════════════════════════════════

  saveEmotionalState(state: {
    valence: number;
    momentum: string;
    volatility: number;
    highEmotionCount: number;
    valenceHistory: number[];
    highEmotionTokenIds: string[];
    lastUpdatedAt: string;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO spark_emotional_state
        (id, valence, momentum, volatility, high_emotion_count, valence_history_json, high_emotion_token_ids_json, last_updated_at)
      VALUES
        ('singleton', @valence, @momentum, @volatility, @highEmotionCount, @valenceHistoryJson, @highEmotionTokenIdsJson, @lastUpdatedAt)
    `).run({
      valence: state.valence,
      momentum: state.momentum,
      volatility: state.volatility,
      highEmotionCount: state.highEmotionCount,
      valenceHistoryJson: JSON.stringify(state.valenceHistory),
      highEmotionTokenIdsJson: JSON.stringify(state.highEmotionTokenIds),
      lastUpdatedAt: state.lastUpdatedAt,
    });
  }

  getEmotionalState(): {
    valence: number;
    momentum: string;
    volatility: number;
    highEmotionCount: number;
    valenceHistory: number[];
    highEmotionTokenIds: string[];
    lastUpdatedAt: string;
  } | null {
    const row = this.db.prepare('SELECT * FROM spark_emotional_state WHERE id = ?').get('singleton') as any;
    if (!row) return null;
    return {
      valence: row.valence,
      momentum: row.momentum,
      volatility: row.volatility,
      highEmotionCount: row.high_emotion_count,
      valenceHistory: JSON.parse(row.valence_history_json || '[]'),
      highEmotionTokenIds: JSON.parse(row.high_emotion_token_ids_json || '[]'),
      lastUpdatedAt: row.last_updated_at,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Reflections
  // ═══════════════════════════════════════════════════════════════

  saveReflection(reflection: ReflectionResult): void {
    this.db.prepare(`
      INSERT INTO spark_reflections
        (id, blind_spots_json, growth_json, emotional_summary, internal_narrative, token_id, created_at)
      VALUES
        (@id, @blindSpotsJson, @growthJson, @emotionalSummary, @internalNarrative, @tokenId, @createdAt)
    `).run({
      id: reflection.id,
      blindSpotsJson: JSON.stringify(reflection.blindSpots),
      growthJson: JSON.stringify(reflection.growth),
      emotionalSummary: reflection.emotionalSummary,
      internalNarrative: reflection.internalNarrative,
      tokenId: reflection.tokenId,
      createdAt: reflection.createdAt,
    });
  }

  getLatestReflection(): ReflectionResult | null {
    const row = this.db.prepare(
      'SELECT * FROM spark_reflections ORDER BY created_at DESC LIMIT 1'
    ).get() as any;
    return row ? this.rowToReflection(row) : null;
  }

  listReflections(limit = 20): ReflectionResult[] {
    const rows = this.db.prepare(
      'SELECT * FROM spark_reflections ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map(r => this.rowToReflection(r));
  }

  private rowToReflection(row: any): ReflectionResult {
    return {
      id: row.id,
      blindSpots: JSON.parse(row.blind_spots_json || '[]'),
      growth: JSON.parse(row.growth_json || '{}'),
      emotionalSummary: row.emotional_summary,
      internalNarrative: row.internal_narrative,
      tokenId: row.token_id ?? null,
      createdAt: row.created_at,
    };
  }

  // ── Row Mappers ─────────────────────────────────────────────

  private rowToMemoryToken(row: any): MemoryToken {
    return {
      id: row.id,
      type: row.type,
      tier: row.tier,
      essence: JSON.parse(row.essence_json),
      strength: row.strength,
      spiralCount: row.spiral_count,
      sourceId: row.source_id,
      mergedFrom: JSON.parse(row.merged_from_json || '[]'),
      createdAt: row.created_at,
      lastSpiralAt: row.last_spiral_at,
      archivedAt: row.archived_at ?? null,
    };
  }

  private rowToMemoryEdge(row: any): MemoryEdge {
    return {
      id: row.id,
      fromTokenId: row.from_token_id,
      toTokenId: row.to_token_id,
      type: row.type,
      weight: row.weight,
      reinforceCount: row.reinforce_count,
      createdAt: row.created_at,
      lastReinforcedAt: row.last_reinforced_at,
    };
  }
}
