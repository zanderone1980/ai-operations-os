/**
 * AdaptiveSafetyGate — CORD safety evaluation with learned SPARK weight adjustments.
 *
 * Wraps the CordSafetyGate from @ai-operations/cord-adapter and applies learned
 * weight multipliers to adjust CORD risk scores based on historical outcomes.
 * This allows the system to self-calibrate: becoming stricter for categories
 * that have historically been too permissive, and more lenient for categories
 * that have been too cautious.
 *
 * Hard blocks from CORD are always respected — SPARK never overrides them.
 *
 * @ai-operations/cord-adapter is an optional dependency. If it is not installed,
 * this module's import will fail gracefully at the consumer level.
 */

import type { CordDecision, SparkCategory } from '@ai-operations/shared-types';
import type { WeightManager } from './weight-manager';
import { operationToCategory } from './predictor';

// ── Graceful CordSafetyGate import ───────────────────────────────

/**
 * The SafetyResult interface from cord-adapter, replicated here so the
 * adaptive gate can extend it without requiring a hard import.
 */
export interface SafetyResult {
  /** The safety decision. */
  decision: CordDecision;
  /** Numeric risk score (0-99). */
  score: number;
  /** Human-readable reasons. */
  reasons: string[];
  /** Whether this is a hard block that cannot be overridden. */
  hardBlock: boolean;
}

/**
 * Minimal interface for the CordSafetyGate dependency.
 * This avoids a hard import of @ai-operations/cord-adapter.
 */
export interface CordSafetyGateInterface {
  evaluateAction(
    connector: string,
    operation: string,
    input: Record<string, unknown>,
  ): SafetyResult;
  isAvailable(): boolean;
}

/** Extended safety result with SPARK adjustment metadata. */
export interface AdaptiveSafetyResult extends SafetyResult {
  /** Whether SPARK adjusted the raw CORD score. */
  sparkAdjusted: boolean;
  /** The original unadjusted CORD score. */
  rawScore: number;
  /** The CORD tool category used for weight lookup. */
  category: SparkCategory;
}

// ── Score → Decision Mapping ──────────────────────────────────────

/**
 * Derive a CORD decision from a numeric risk score.
 *
 * @param score - Risk score (0-99).
 * @returns The corresponding CordDecision.
 */
function scoreToDecision(score: number): CordDecision {
  if (score < 20) return 'ALLOW';
  if (score < 50) return 'CONTAIN';
  if (score < 75) return 'CHALLENGE';
  return 'BLOCK';
}

// ── AdaptiveSafetyGate ────────────────────────────────────────────

/**
 * Safety gate that wraps CORD with learned SPARK weight adjustments.
 *
 * The evaluation flow:
 * 1. Get raw CORD evaluation (score, decision, reasons)
 * 2. Look up the learned weight multiplier for the operation's category
 * 3. Compute adjusted score = round(rawScore * multiplier), clamped 0-99
 * 4. Re-derive decision from the adjusted score
 * 5. If CORD issued a hardBlock, keep the original decision regardless
 * 6. Append a SPARK reason if the decision changed
 *
 * @example
 * ```ts
 * const gate = new AdaptiveSafetyGate(cordGate, weightManager);
 * const result = gate.evaluateAction('gmail', 'send', { to: 'user@example.com' });
 * console.log(result.sparkAdjusted); // true if weight != 1.0
 * console.log(result.rawScore);      // original CORD score
 * console.log(result.score);         // adjusted score
 * ```
 */
export class AdaptiveSafetyGate {
  private readonly cord: CordSafetyGateInterface;
  private readonly weights: WeightManager;

  /**
   * @param cord    - CordSafetyGate instance for raw safety evaluation.
   * @param weights - WeightManager for looking up learned weight multipliers.
   */
  constructor(cord: CordSafetyGateInterface, weights: WeightManager) {
    this.cord = cord;
    this.weights = weights;
  }

  /**
   * Evaluate a proposed connector action with SPARK-adjusted safety scoring.
   *
   * @param connector - The connector name (e.g., 'gmail', 'shopify').
   * @param operation - The operation to perform (e.g., 'send', 'delete').
   * @param input     - The input data for the operation.
   * @returns An AdaptiveSafetyResult with both raw and adjusted scoring.
   */
  evaluateAction(
    connector: string,
    operation: string,
    input: Record<string, unknown>,
  ): AdaptiveSafetyResult {
    // Step 1: Get raw CORD evaluation
    const rawResult = this.cord.evaluateAction(connector, operation, input);
    const rawScore = rawResult.score;

    // Step 2: Get weight multiplier for the operation's category
    const category = operationToCategory(operation);
    const multiplier = this.weights.getMultiplier(category);

    // Step 3: Compute adjusted score, clamped to 0-99
    const adjustedScore = Math.min(99, Math.max(0, Math.round(rawScore * multiplier)));

    // Step 4: Re-derive decision from adjusted score
    let adjustedDecision = scoreToDecision(adjustedScore);

    // Step 5: If hardBlock, keep original decision regardless
    if (rawResult.hardBlock) {
      adjustedDecision = rawResult.decision;
    }

    // Step 6: Build reasons list, adding SPARK reason if decision changed
    const reasons = [...rawResult.reasons];
    const sparkAdjusted = multiplier !== 1.0;

    if (sparkAdjusted && adjustedDecision !== rawResult.decision && !rawResult.hardBlock) {
      reasons.push(
        `SPARK adjusted score from ${rawScore} to ${adjustedScore} ` +
        `(weight: ${multiplier.toFixed(4)}, category: ${category}). ` +
        `Decision changed from ${rawResult.decision} to ${adjustedDecision}.`,
      );
    }

    return {
      decision: adjustedDecision,
      score: adjustedScore,
      reasons,
      hardBlock: rawResult.hardBlock,
      sparkAdjusted,
      rawScore,
      category,
    };
  }
}
