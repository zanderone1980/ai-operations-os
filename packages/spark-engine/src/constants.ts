/**
 * SPARK Constants — Tuning parameters and default weight builders.
 *
 * These constants control the exponential moving average learning rate,
 * maximum weight deviation, minimum episode thresholds, and provide
 * factory functions for building default weight entries per CORD category.
 */

import type { SparkCategory, SparkWeightEntry } from '@ai-operations/shared-types';
import { SENTINEL_CATEGORIES } from '@ai-operations/shared-types';

// ── Learning Tuning Parameters ────────────────────────────────────

/** Exponential moving average smoothing factor for weight updates. */
export const EMA_ALPHA = 0.1;

/** Maximum +-30% deviation from base weight. */
export const MAX_DEVIATION_PERCENT = 0.30;

/** No weight changes until this many episodes have been observed. */
export const MIN_EPISODES_BEFORE_LEARNING = 3;

/** Default base weight multiplier for all categories. */
export const DEFAULT_BASE_WEIGHT = 1.0;

// ── All Categories ────────────────────────────────────────────────

/** All seven SPARK/CORD tool categories. */
export const ALL_CATEGORIES: SparkCategory[] = [
  'communication',
  'publication',
  'destructive',
  'scheduling',
  'financial',
  'readonly',
  'general',
];

// ── Default Weight Builders ───────────────────────────────────────

/**
 * Build a default SparkWeightEntry for the given category.
 *
 * SENTINEL categories (destructive, financial) have their lower bound
 * pinned to baseWeight so the system can never become LESS cautious
 * about them. All other categories allow the weight to drop to 70%
 * of base.
 *
 * @param category - The CORD tool category to build a default weight for.
 * @returns A fresh SparkWeightEntry with default values.
 */
export function buildDefaultWeight(category: SparkCategory): SparkWeightEntry {
  const baseWeight = DEFAULT_BASE_WEIGHT;
  const isSentinel = (SENTINEL_CATEGORIES as readonly string[]).includes(category);

  return {
    category,
    currentWeight: baseWeight,
    baseWeight,
    lowerBound: isSentinel ? baseWeight : baseWeight * (1 - MAX_DEVIATION_PERCENT),
    upperBound: baseWeight * (1 + MAX_DEVIATION_PERCENT),
    episodeCount: 0,
    lastAdjustedAt: new Date().toISOString(),
  };
}

/**
 * Build default SparkWeightEntry values for all seven categories.
 *
 * @returns An array of SparkWeightEntry objects with default values.
 */
export function buildAllDefaultWeights(): SparkWeightEntry[] {
  return ALL_CATEGORIES.map(buildDefaultWeight);
}
