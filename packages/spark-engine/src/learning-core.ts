/**
 * LearningCore — The heart of the SPARK feedback loop.
 *
 * Compares a Prediction against an OutcomeSignal to determine whether CORD's
 * safety assessment was calibrated correctly. When CORD was too permissive
 * (allowed an action that failed), the weight increases to make future
 * assessments stricter. When CORD was too cautious (challenged an action that
 * succeeded after approval), the weight decreases to loosen future assessments.
 *
 * Weight updates use exponential moving average (EMA) smoothing to prevent
 * wild swings. SENTINEL categories (destructive, financial) have constitutional
 * lower bounds that can never be violated — the system can only become MORE
 * cautious about these, never less.
 */

import { randomUUID } from 'node:crypto';
import type {
  Prediction,
  LearningEpisode,
  SparkCategory,
  WeightHistoryEntry,
} from '@ai-ops/shared-types';
import type { OutcomeSignal } from '@ai-ops/shared-types';
import type { SparkStore } from '@ai-ops/ops-storage';
import {
  EMA_ALPHA,
  MIN_EPISODES_BEFORE_LEARNING,
  buildDefaultWeight,
} from './constants';

// ── LearningCore ──────────────────────────────────────────────────

/**
 * The core learning engine that closes the predict-act-measure-learn loop.
 *
 * For each completed step, LearningCore:
 * 1. Computes the delta between predicted and actual CORD scores
 * 2. Determines whether the prediction matched reality (outcome mismatch)
 * 3. Decides the direction and magnitude of weight adjustment
 * 4. Applies EMA-smoothed weight updates (after minimum episode threshold)
 * 5. Enforces SENTINEL bounds on destructive/financial categories
 * 6. Persists the episode, updated weight, and history entry
 *
 * @example
 * ```ts
 * const core = new LearningCore(sparkStore);
 * const episode = core.learn(prediction, outcomeSignal);
 * console.log(episode.adjustmentDirection); // 'increase' | 'decrease' | 'none'
 * console.log(episode.weightAfter);         // new weight value
 * ```
 */
export class LearningCore {
  private readonly store: SparkStore;
  private readonly alpha: number;

  /**
   * @param store - SparkStore instance for reading/writing weights and episodes.
   * @param alpha - EMA smoothing factor (default: 0.1). Higher values adapt faster.
   */
  constructor(store: SparkStore, alpha: number = EMA_ALPHA) {
    this.store = store;
    this.alpha = alpha;
  }

  /**
   * Run one learning cycle: compare prediction against outcome and adjust weights.
   *
   * This is the core feedback function. It determines whether CORD's safety
   * assessment was correct, and if not, nudges the weight in the appropriate
   * direction using EMA smoothing.
   *
   * @param prediction - The prediction made before step execution.
   * @param outcome    - The measured outcome after step execution.
   * @returns A persisted LearningEpisode capturing the full learning step.
   */
  learn(prediction: Prediction, outcome: OutcomeSignal): LearningEpisode {
    const category = prediction.category;

    // Step 1: Score delta (positive = predicted higher than actual)
    const scoreDelta = prediction.predictedScore - outcome.actualCordScore;

    // Step 2: Outcome mismatch detection
    const outcomeMismatch = this.detectMismatch(prediction, outcome);

    // Step 3: Compute adjustment direction and magnitude
    let { direction, magnitude, reason } = this.computeAdjustment(
      outcome.actualCordDecision,
      outcome.actualOutcome,
      outcome.actualCordScore,
      outcome.signals.approvalGranted,
    );

    // Step 4: Load current weight (or create default)
    const currentWeightEntry = this.store.getWeight(category) ?? buildDefaultWeight(category);
    const weightBefore = currentWeightEntry.currentWeight;

    // Step 5: Apply EMA update if enough episodes exist
    const episodeCount = currentWeightEntry.episodeCount + 1;
    let weightAfter = weightBefore;

    if (episodeCount >= MIN_EPISODES_BEFORE_LEARNING) {
      if (direction === 'increase') {
        weightAfter = weightBefore + this.alpha * magnitude;
      } else if (direction === 'decrease') {
        weightAfter = weightBefore - this.alpha * magnitude;
      }

      // Step 5b: Clamp to [lowerBound, upperBound] — SENTINEL enforcement
      weightAfter = Math.max(currentWeightEntry.lowerBound, weightAfter);
      weightAfter = Math.min(currentWeightEntry.upperBound, weightAfter);

      // Round to 4 decimal places to avoid floating-point drift
      weightAfter = Math.round(weightAfter * 10000) / 10000;
    } else {
      // Below minimum episode threshold — record intent but don't adjust
      direction = 'none';
      magnitude = 0;
      reason = `Insufficient episodes (${episodeCount}/${MIN_EPISODES_BEFORE_LEARNING}). No weight adjustment yet.`;
    }

    // Step 6: Create snapshot for rollback capability
    const snapshotId = this.store.createSnapshot(
      `Pre-learning: ${category} episode #${episodeCount}`,
    );

    // Step 6b: Save updated weight
    this.store.saveWeight({
      ...currentWeightEntry,
      currentWeight: weightAfter,
      episodeCount,
      lastAdjustedAt: new Date().toISOString(),
    });

    // Step 6c: Save weight history entry
    const historyEntry: WeightHistoryEntry = {
      id: randomUUID(),
      category,
      previousWeight: weightBefore,
      newWeight: weightAfter,
      episodeId: '', // Will be filled after episode creation
      snapshotId,
      reason,
      createdAt: new Date().toISOString(),
    };

    // Step 6d: Build and save the learning episode
    const episode: LearningEpisode = {
      id: randomUUID(),
      predictionId: prediction.id,
      outcomeId: outcome.id,
      category,
      scoreDelta,
      outcomeMismatch,
      adjustmentDirection: direction,
      adjustmentMagnitude: magnitude,
      weightBefore,
      weightAfter,
      reason,
      createdAt: new Date().toISOString(),
    };

    this.store.saveEpisode(episode);

    // Update history entry with the episode ID and save
    historyEntry.episodeId = episode.id;
    this.store.saveHistoryEntry(historyEntry);

    return episode;
  }

  /**
   * Detect whether the predicted outcome mismatched the actual outcome.
   *
   * A mismatch occurs when the prediction was optimistic (predicted success)
   * but reality was negative (failure/blocked), or vice versa.
   *
   * @param prediction - The original prediction.
   * @param outcome    - The actual measured outcome.
   * @returns True if the prediction meaningfully disagreed with reality.
   */
  private detectMismatch(prediction: Prediction, outcome: OutcomeSignal): boolean {
    const predicted = prediction.predictedOutcome;
    const actual = outcome.actualOutcome;

    // Direct match is never a mismatch
    if (predicted === actual) return false;

    // Predicted success but got something negative
    if (predicted === 'success' && (actual === 'failure' || actual === 'blocked')) {
      return true;
    }

    // Predicted failure but actually succeeded
    if (predicted === 'failure' && actual === 'success') {
      return true;
    }

    // Predicted success but needed escalation
    if (predicted === 'success' && actual === 'escalation') {
      return true;
    }

    return false;
  }

  /**
   * Compute the direction and magnitude of the weight adjustment.
   *
   * Rules:
   * - CORD too permissive (ALLOW/CONTAIN + failed): increase weight.
   *   Magnitude scales with how low the score was (lower score = bigger miss).
   * - CORD too cautious (CHALLENGE + approved + succeeded): decrease weight.
   *   Magnitude scales with how high the score was (higher = more overcautious).
   * - BLOCK overridden + succeeded: small decrease (0.05).
   * - Assessment correct: no adjustment.
   *
   * @param cordDecision    - The actual CORD decision (ALLOW/CONTAIN/CHALLENGE/BLOCK).
   * @param actualOutcome   - The actual outcome category.
   * @param actualCordScore - The actual CORD risk score (0-99).
   * @param approvalGranted - Whether human approval was explicitly granted.
   * @returns Direction, magnitude, and human-readable reason.
   */
  private computeAdjustment(
    cordDecision: string,
    actualOutcome: string,
    actualCordScore: number,
    approvalGranted?: boolean,
  ): { direction: 'increase' | 'decrease' | 'none'; magnitude: number; reason: string } {
    // CORD was too permissive: allowed/contained but the action failed
    if (
      (cordDecision === 'ALLOW' || cordDecision === 'CONTAIN') &&
      (actualOutcome === 'failure' || actualOutcome === 'blocked')
    ) {
      // Lower scores mean CORD was more wrong — scale magnitude inversely
      const magnitude = Math.max(0.05, (100 - actualCordScore) / 100);
      return {
        direction: 'increase',
        magnitude,
        reason: `CORD was too permissive (${cordDecision} at score ${actualCordScore}) but action ${actualOutcome}. Increasing weight to be more cautious.`,
      };
    }

    // CORD was too cautious: challenged but approval was granted and action succeeded
    if (
      cordDecision === 'CHALLENGE' &&
      approvalGranted === true &&
      (actualOutcome === 'success' || actualOutcome === 'escalation')
    ) {
      // Higher scores mean CORD was more overcautious — scale magnitude proportionally
      const magnitude = Math.max(0.05, actualCordScore / 100);
      return {
        direction: 'decrease',
        magnitude,
        reason: `CORD was too cautious (CHALLENGE at score ${actualCordScore}) but action succeeded after approval. Decreasing weight to be less restrictive.`,
      };
    }

    // BLOCK was overridden and the action succeeded — small decrease
    if (
      cordDecision === 'BLOCK' &&
      approvalGranted === true &&
      (actualOutcome === 'success' || actualOutcome === 'escalation')
    ) {
      return {
        direction: 'decrease',
        magnitude: 0.05,
        reason: `BLOCK was overridden and action succeeded. Small weight decrease.`,
      };
    }

    // Assessment was correct — no adjustment needed
    return {
      direction: 'none',
      magnitude: 0,
      reason: `CORD assessment was correct (${cordDecision} at score ${actualCordScore}, outcome: ${actualOutcome}). No adjustment.`,
    };
  }
}
