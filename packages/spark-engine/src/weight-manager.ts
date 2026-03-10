/**
 * WeightManager — Manages SPARK weight state, initialization, and snapshots.
 *
 * Provides a high-level interface for reading and initializing category weights,
 * getting weight multipliers for CORD score adjustment, and creating/restoring
 * weight snapshots for rollback capability.
 */

import type { SparkCategory, SparkWeights, SparkWeightEntry } from '@ai-ops/shared-types';
import type { SparkStore } from '@ai-ops/ops-storage';
import { ALL_CATEGORIES, buildDefaultWeight } from './constants';

// ── WeightManager ─────────────────────────────────────────────────

/**
 * Manages the full lifecycle of SPARK learned weights: initialization,
 * retrieval, snapshot creation, and restoration.
 *
 * @example
 * ```ts
 * const manager = new WeightManager(sparkStore);
 * manager.initialize();
 * const multiplier = manager.getMultiplier('communication');
 * console.log(multiplier); // 1.0 initially, adjusts over time
 * ```
 */
export class WeightManager {
  private readonly store: SparkStore;

  /**
   * @param store - SparkStore instance for weight persistence.
   */
  constructor(store: SparkStore) {
    this.store = store;
  }

  /**
   * Seed default weights for any categories that don't yet have stored values.
   *
   * This is safe to call multiple times — it only inserts weights for
   * categories that are missing from the store.
   */
  initialize(): void {
    const existing = this.store.getAllWeights();
    const existingCategories = new Set(existing.map(w => w.category));

    const missing: SparkWeightEntry[] = [];
    for (const category of ALL_CATEGORIES) {
      if (!existingCategories.has(category)) {
        missing.push(buildDefaultWeight(category));
      }
    }

    if (missing.length > 0) {
      this.store.initializeWeights(missing);
    }
  }

  /**
   * Get the current weight multiplier for a CORD tool category.
   *
   * Returns the stored currentWeight value, or 1.0 if the category
   * has no stored weight (neutral multiplier).
   *
   * @param category - The CORD tool category.
   * @returns The weight multiplier (typically 0.70 - 1.30).
   */
  getMultiplier(category: SparkCategory): number {
    const entry = this.store.getWeight(category);
    return entry?.currentWeight ?? 1.0;
  }

  /**
   * Build the full SparkWeights state object across all categories.
   *
   * Fills in default values for any categories missing from the store,
   * ensuring the returned object always contains all seven categories.
   *
   * @returns Complete SparkWeights state with all categories populated.
   */
  getAllWeights(): SparkWeights {
    const stored = this.store.getAllWeights();
    const storedMap = new Map(stored.map(w => [w.category, w]));

    const weights: Record<string, SparkWeightEntry> = {};
    for (const category of ALL_CATEGORIES) {
      weights[category] = storedMap.get(category) ?? buildDefaultWeight(category);
    }

    return {
      weights: weights as Record<SparkCategory, SparkWeightEntry>,
      version: '0.1.0',
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Create a named snapshot of all current weights for rollback capability.
   *
   * @param reason - Human-readable reason for the snapshot (e.g., "Pre-deployment backup").
   * @returns The snapshot identifier for later restoration.
   */
  createSnapshot(reason: string): string {
    return this.store.createSnapshot(reason);
  }

  /**
   * Restore weights from a previously saved snapshot.
   *
   * @param snapshotId - The snapshot identifier returned from createSnapshot.
   * @throws If the snapshot ID is not found.
   */
  restoreSnapshot(snapshotId: string): void {
    this.store.restoreSnapshot(snapshotId);
  }
}
