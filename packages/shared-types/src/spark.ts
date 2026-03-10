/**
 * SPARK Types — Self-Perpetuating Adaptive Reasoning Kernel.
 *
 * Data structures for the predict → act → measure → learn feedback loop.
 */

// ── Categories ──────────────────────────────────────────────────

/** CORD tool category that SPARK tracks weights for. */
export type SparkCategory =
  | 'communication'
  | 'publication'
  | 'destructive'
  | 'scheduling'
  | 'financial'
  | 'readonly'
  | 'general';

/** Predicted outcome category for a step. */
export type PredictedOutcome = 'success' | 'partial' | 'failure' | 'escalation';

/** Actual outcome category after step execution. */
export type ActualOutcome = 'success' | 'partial' | 'failure' | 'escalation' | 'blocked';

// ── Prediction ──────────────────────────────────────────────────

/** A prediction made before step execution. */
export interface Prediction {
  /** Unique prediction identifier (UUID v4). */
  id: string;
  /** The step this prediction is for. */
  stepId: string;
  /** The workflow run containing the step. */
  runId: string;
  /** Connector name. */
  connector: string;
  /** Operation name. */
  operation: string;
  /** CORD tool category. */
  category: SparkCategory;
  /** Predicted CORD risk score (0-99). */
  predictedScore: number;
  /** Predicted outcome category. */
  predictedOutcome: PredictedOutcome;
  /** Confidence in this prediction (0.0-1.0). */
  confidence: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Outcome Signal ──────────────────────────────────────────────

/** Measured outcome after step execution. */
export interface OutcomeSignal {
  /** Unique outcome identifier (UUID v4). */
  id: string;
  /** The step this outcome is for. */
  stepId: string;
  /** The workflow run containing the step. */
  runId: string;
  /** What actually happened. */
  actualOutcome: ActualOutcome;
  /** The CORD score that was actually assigned. */
  actualCordScore: number;
  /** The CORD decision that was actually made. */
  actualCordDecision: string;
  /** Individual signal components. */
  signals: {
    /** Did the step complete without error? */
    succeeded: boolean;
    /** Was the step escalated to human approval? */
    escalated: boolean;
    /** Was approval granted (if escalated)? */
    approvalGranted?: boolean;
    /** Step duration in milliseconds. */
    durationMs?: number;
    /** Was there an error? */
    hasError: boolean;
    /** Error message if any. */
    errorMessage?: string;
  };
  /** ISO 8601 measurement timestamp. */
  measuredAt: string;
}

// ── Learning Episode ────────────────────────────────────────────

/** A single learning step comparing prediction against reality. */
export interface LearningEpisode {
  /** Unique episode identifier (UUID v4). */
  id: string;
  /** Link to the prediction. */
  predictionId: string;
  /** Link to the outcome. */
  outcomeId: string;
  /** CORD tool category affected. */
  category: SparkCategory;
  /** Score delta: predicted score - actual score. */
  scoreDelta: number;
  /** Did prediction match reality? */
  outcomeMismatch: boolean;
  /** Direction of weight adjustment. */
  adjustmentDirection: 'increase' | 'decrease' | 'none';
  /** Magnitude of weight adjustment applied. */
  adjustmentMagnitude: number;
  /** Weight value before adjustment. */
  weightBefore: number;
  /** Weight value after adjustment. */
  weightAfter: number;
  /** Human-readable reason for the adjustment. */
  reason: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Weights ─────────────────────────────────────────────────────

/** A single category's learned weight entry. */
export interface SparkWeightEntry {
  /** The CORD tool category. */
  category: SparkCategory;
  /** Current learned weight multiplier (default 1.0). */
  currentWeight: number;
  /** The base weight this category started at (immutable). */
  baseWeight: number;
  /** Lower bound — SENTINEL floor. */
  lowerBound: number;
  /** Upper bound — SENTINEL ceiling. */
  upperBound: number;
  /** Number of learning episodes that have influenced this weight. */
  episodeCount: number;
  /** ISO 8601 timestamp of last adjustment. */
  lastAdjustedAt: string;
}

/** Full weight state across all categories. */
export interface SparkWeights {
  /** Map from category to weight entry. */
  weights: Record<SparkCategory, SparkWeightEntry>;
  /** Schema version. */
  version: string;
  /** ISO 8601 timestamp of last persistence. */
  updatedAt: string;
}

// ── Weight History ──────────────────────────────────────────────

/** Historical record of a weight change. */
export interface WeightHistoryEntry {
  /** Unique entry identifier (UUID v4). */
  id: string;
  /** Which category was adjusted. */
  category: SparkCategory;
  /** Weight before the change. */
  previousWeight: number;
  /** Weight after the change. */
  newWeight: number;
  /** The learning episode that caused this change. */
  episodeId: string;
  /** Snapshot ID for rollback capability. */
  snapshotId: string;
  /** Human-readable reason. */
  reason: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── SENTINEL ────────────────────────────────────────────────────

/**
 * Categories protected by SENTINEL constitutional rules.
 * Their lower bounds can NEVER go below base weight (1.0).
 * The system can only become MORE cautious about these, never less.
 */
export const SENTINEL_CATEGORIES: readonly SparkCategory[] = [
  'destructive',
  'financial',
] as const;
