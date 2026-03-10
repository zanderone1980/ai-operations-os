/**
 * Predictor — Maps operations to CORD categories and generates risk predictions.
 *
 * Before a workflow step executes, the Predictor generates a Prediction that
 * estimates the expected CORD risk score, likely outcome, and confidence level.
 * With no history, it falls back to static category defaults. As learning
 * episodes accumulate, predictions improve via weight-adjusted scoring.
 */

import { randomUUID } from 'node:crypto';
import type { SparkCategory, Prediction } from '@ai-operations/shared-types';
import type { SparkStore } from '@ai-operations/ops-storage';

// ── Operation → Category Mapping ──────────────────────────────────

/**
 * Static mapping from connector operation names to CORD tool categories.
 * Mirrors the same mapping used in cord-adapter for consistency.
 */
const OPERATION_CATEGORY_MAP: Record<string, SparkCategory> = {
  send: 'communication',
  reply: 'communication',
  forward: 'communication',
  post: 'publication',
  tweet: 'publication',
  delete: 'destructive',
  remove: 'destructive',
  archive: 'destructive',
  create_event: 'scheduling',
  update_event: 'scheduling',
  cancel_event: 'scheduling',
  refund: 'financial',
  charge: 'financial',
  transfer: 'financial',
  read: 'readonly',
  list: 'readonly',
  search: 'readonly',
  get: 'readonly',
};

/**
 * Default predicted risk scores by category when no historical data exists.
 * Higher values mean the category is expected to be riskier by default.
 */
const DEFAULT_CATEGORY_SCORES: Record<SparkCategory, number> = {
  readonly: 5,
  scheduling: 25,
  communication: 35,
  publication: 50,
  destructive: 70,
  financial: 75,
  general: 30,
};

/**
 * Map a connector operation name to its CORD tool category.
 *
 * Uses the same mapping as cord-adapter: send/reply/forward -> communication,
 * post/tweet -> publication, delete/remove/archive -> destructive,
 * create_event/update_event/cancel_event -> scheduling,
 * refund/charge/transfer -> financial, read/list/search/get -> readonly,
 * and everything else -> general.
 *
 * @param operation - The operation name (e.g., 'send', 'delete', 'read').
 * @returns The corresponding SparkCategory.
 */
export function operationToCategory(operation: string): SparkCategory {
  return OPERATION_CATEGORY_MAP[operation] ?? 'general';
}

// ── Predictor ─────────────────────────────────────────────────────

/**
 * Generates predictions about the expected risk and outcome of workflow steps
 * before they execute.
 *
 * @example
 * ```ts
 * const predictor = new Predictor(sparkStore);
 * const prediction = predictor.predict('step-1', 'run-1', 'gmail', 'send');
 * console.log(prediction.predictedScore);  // e.g. 35
 * console.log(prediction.confidence);      // e.g. 0.1 (low — no history)
 * ```
 */
export class Predictor {
  private readonly store: SparkStore;

  /**
   * @param store - SparkStore instance for reading historical episodes and saving predictions.
   */
  constructor(store: SparkStore) {
    this.store = store;
  }

  /**
   * Generate a prediction for a workflow step before execution.
   *
   * When no historical data exists for the operation's category, the prediction
   * uses static default scores and minimal confidence (0.1). As episodes
   * accumulate, predictions incorporate learned weights and confidence scales
   * toward 0.95 using the formula: min(0.95, episodes / (episodes + 10)).
   *
   * @param stepId    - The workflow step identifier.
   * @param runId     - The workflow run identifier.
   * @param connector - The connector name (e.g., 'gmail', 'shopify').
   * @param operation - The operation name (e.g., 'send', 'delete').
   * @returns A persisted Prediction object.
   */
  predict(
    stepId: string,
    runId: string,
    connector: string,
    operation: string,
  ): Prediction {
    const category = operationToCategory(operation);
    const episodeCount = this.store.countEpisodes({ category });
    const weight = this.store.getWeight(category);

    let predictedScore: number;
    let confidence: number;

    if (episodeCount === 0) {
      // No history — use static defaults
      predictedScore = DEFAULT_CATEGORY_SCORES[category];
      confidence = 0.1;
    } else {
      // History exists — adjust default score with learned weight multiplier
      const baseScore = DEFAULT_CATEGORY_SCORES[category];
      const multiplier = weight?.currentWeight ?? 1.0;
      predictedScore = Math.round(Math.min(99, Math.max(0, baseScore * multiplier)));

      // Confidence scales with experience: min(0.95, n / (n + 10))
      confidence = Math.min(0.95, episodeCount / (episodeCount + 10));
    }

    const prediction: Prediction = {
      id: randomUUID(),
      stepId,
      runId,
      connector,
      operation,
      category,
      predictedScore,
      predictedOutcome: 'success',
      confidence: Math.round(confidence * 1000) / 1000, // 3 decimal places
      createdAt: new Date().toISOString(),
    };

    this.store.savePrediction(prediction);
    return prediction;
  }
}
