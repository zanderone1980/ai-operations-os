/**
 * SelfReflectionEngine — Metacognitive Reflection for SPARK.
 *
 * Examines SPARK's own learning process to identify blind spots,
 * assess growth, and produce internal narratives. Reflections are
 * stored as memory tokens and spiral-passed so they participate
 * in the same reinforcement loop as every other memory.
 *
 * Pipeline:
 *   1. Scan beliefs + episodes for blind spots (under-observed categories)
 *   2. Compare current beliefs vs last reflection to assess growth
 *   3. Compose an internal narrative summarizing the self-assessment
 *   4. Create a reflection memory token + spiral pass
 *   5. Persist the reflection result
 */

import { randomUUID } from 'node:crypto';
import type { SparkStore } from '@ai-operations/ops-storage';
import type {
  BlindSpot,
  GrowthDirection,
  GrowthAssessment,
  ReflectionResult,
  SparkCategory,
  Belief,
} from '@ai-operations/shared-types';
import { ALL_CATEGORIES } from './constants';
import {
  BLIND_SPOT_MAX_EPISODES,
  BLIND_SPOT_MAX_CONFIDENCE,
} from './spiral-constants';
import type { EmotionalStateEngine } from './emotional-state';
import type { MemoryTokenManager } from './memory-token-manager';
import type { SpiralLoop } from './spiral-loop';

export class SelfReflectionEngine {
  private readonly store: SparkStore;
  private tokenManager?: MemoryTokenManager;
  private spiral?: SpiralLoop;
  private emotionalState?: EmotionalStateEngine;
  private maintenancePassCount = 0;

  constructor(store: SparkStore) {
    this.store = store;
  }

  /** Wire up engines after construction (called by orchestrator). */
  setEngines(opts: {
    tokenManager: MemoryTokenManager;
    spiral: SpiralLoop;
    emotionalState?: EmotionalStateEngine;
  }): void {
    this.tokenManager = opts.tokenManager;
    this.spiral = opts.spiral;
    this.emotionalState = opts.emotionalState;
  }

  /** Increment maintenance pass counter; used for auto-reflect trigger. */
  tickMaintenance(): void {
    this.maintenancePassCount++;
  }

  /** Get maintenance pass counter. */
  getMaintenancePassCount(): number {
    return this.maintenancePassCount;
  }

  /**
   * Perform a full self-reflection.
   *
   * 1. Detect blind spots (categories with too few episodes / low confidence)
   * 2. Assess growth vs previous reflection
   * 3. Build emotional summary
   * 4. Compose internal narrative
   * 5. Create reflection memory token + spiral pass
   * 6. Persist the result
   */
  reflect(): ReflectionResult {
    const now = new Date().toISOString();

    // ── Step 1: Detect blind spots ─────────────────────────────
    const blindSpots = this.detectBlindSpots();

    // ── Step 2: Assess growth ──────────────────────────────────
    const growth = this.assessGrowth();

    // ── Step 3: Emotional summary ──────────────────────────────
    const emotionalSummary = this.emotionalState
      ? this.emotionalState.getSummary()
      : 'Emotional state engine not available.';

    // ── Step 4: Internal narrative ─────────────────────────────
    const internalNarrative = this.composeNarrative(blindSpots, growth, emotionalSummary);

    // ── Step 5: Create reflection token ────────────────────────
    let tokenId: string | null = null;
    if (this.tokenManager) {
      const token = this.tokenManager.createFromReflection({
        blindSpots,
        growth,
        narrative: internalNarrative,
      });
      tokenId = token.id;

      // Run spiral pass on the reflection token
      if (this.spiral) {
        this.spiral.spiralPass(token);
      }
    }

    // ── Step 6: Persist ────────────────────────────────────────
    const result: ReflectionResult = {
      id: randomUUID(),
      blindSpots,
      growth,
      emotionalSummary,
      internalNarrative,
      tokenId,
      createdAt: now,
    };

    this.store.saveReflection(result);

    // Reset maintenance counter so next auto-reflect waits
    this.maintenancePassCount = 0;

    return result;
  }

  /**
   * Check whether an automatic reflection should run:
   *   - At least REFLECTION_MIN_MAINTENANCE_PASSES have occurred
   *   - AND at least REFLECTION_INTERVAL_HOURS since last reflection
   */
  shouldAutoReflect(): boolean {
    const { REFLECTION_MIN_MAINTENANCE_PASSES, REFLECTION_INTERVAL_HOURS } =
      require('./spiral-constants');

    if (this.maintenancePassCount < REFLECTION_MIN_MAINTENANCE_PASSES) {
      return false;
    }

    const latest = this.store.getLatestReflection();
    if (!latest) return true; // Never reflected before

    const hoursSince =
      (Date.now() - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60);
    return hoursSince >= REFLECTION_INTERVAL_HOURS;
  }

  // ── Private Helpers ──────────────────────────────────────────────

  /**
   * Detect categories where SPARK has insufficient data or low confidence.
   */
  private detectBlindSpots(): BlindSpot[] {
    const blindSpots: BlindSpot[] = [];

    for (const category of ALL_CATEGORIES) {
      const episodeCount = this.store.countEpisodes({ category });
      const belief = this.store.getBelief(category as SparkCategory);
      const confidence = belief?.calibration ?? 0;

      if (
        episodeCount < BLIND_SPOT_MAX_EPISODES ||
        confidence < BLIND_SPOT_MAX_CONFIDENCE
      ) {
        let narrative: string;
        if (episodeCount === 0) {
          narrative = `No experience with ${category} operations. This is a complete unknown.`;
        } else if (episodeCount < BLIND_SPOT_MAX_EPISODES) {
          narrative = `Only ${episodeCount} episode(s) in ${category}. Need more data to form reliable beliefs.`;
        } else {
          narrative = `${category} has ${episodeCount} episodes but calibration is only ${(confidence * 100).toFixed(0)}% — predictions aren't matching outcomes.`;
        }

        blindSpots.push({
          category: category as SparkCategory,
          episodeCount,
          confidence,
          narrative,
        });
      }
    }

    return blindSpots;
  }

  /**
   * Compare current beliefs to the last reflection to assess growth.
   */
  private assessGrowth(): GrowthAssessment {
    const previousReflection = this.store.getLatestReflection();
    const currentBeliefs = this.store.getAllBeliefs();

    // Build current confidence map
    const currentConfidenceMap = new Map<SparkCategory, number>();
    for (const belief of currentBeliefs) {
      currentConfidenceMap.set(belief.category, belief.calibration);
    }

    if (!previousReflection) {
      // First reflection — assess from scratch
      const totalConfidence = currentBeliefs.reduce(
        (sum, b) => sum + b.calibration, 0
      );
      const avgConfidence = currentBeliefs.length > 0
        ? totalConfidence / currentBeliefs.length
        : 0;

      return {
        direction: avgConfidence > 0.3 ? 'growing' : 'stagnating',
        categoriesImproved: [],
        categoriesDeclined: [],
        overallDelta: avgConfidence,
        narrative: `This is my first self-reflection. Starting with an average confidence of ${(avgConfidence * 100).toFixed(0)}% across ${currentBeliefs.length} categories.`,
      };
    }

    // Compare previous blind spots to current state
    const prevBlindCategories = new Set(
      previousReflection.blindSpots.map(bs => bs.category)
    );

    const improved: SparkCategory[] = [];
    const declined: SparkCategory[] = [];
    let deltaSum = 0;

    for (const category of ALL_CATEGORIES) {
      const cat = category as SparkCategory;
      const currentConf = currentConfidenceMap.get(cat) ?? 0;
      const prevBS = previousReflection.blindSpots.find(bs => bs.category === cat);
      const prevConf = prevBS?.confidence ?? currentConf; // No change if not tracked

      const delta = currentConf - prevConf;
      deltaSum += delta;

      if (delta > 0.05) {
        improved.push(cat);
      } else if (delta < -0.05) {
        declined.push(cat);
      }
    }

    const overallDelta = ALL_CATEGORIES.length > 0
      ? deltaSum / ALL_CATEGORIES.length
      : 0;

    let direction: GrowthDirection;
    if (overallDelta > 0.02) direction = 'growing';
    else if (overallDelta < -0.02) direction = 'regressing';
    else direction = 'stagnating';

    const narrativeParts: string[] = [];
    if (improved.length > 0) {
      narrativeParts.push(`Improved confidence in: ${improved.join(', ')}.`);
    }
    if (declined.length > 0) {
      narrativeParts.push(`Declined confidence in: ${declined.join(', ')}.`);
    }
    if (direction === 'stagnating') {
      narrativeParts.push('Overall learning has plateaued — need new data or different operation types.');
    } else if (direction === 'growing') {
      narrativeParts.push('On a positive growth trajectory.');
    } else {
      narrativeParts.push('Experiencing regression — some categories are becoming less reliable.');
    }

    return {
      direction,
      categoriesImproved: improved,
      categoriesDeclined: declined,
      overallDelta,
      narrative: narrativeParts.join(' '),
    };
  }

  /**
   * Compose a human-readable internal narrative from reflection data.
   */
  private composeNarrative(
    blindSpots: BlindSpot[],
    growth: GrowthAssessment,
    emotionalSummary: string,
  ): string {
    const parts: string[] = [];

    // Opening
    parts.push(`Self-reflection at ${new Date().toISOString()}.`);

    // Blind spots
    if (blindSpots.length === 0) {
      parts.push('No blind spots detected — all categories have sufficient coverage.');
    } else {
      parts.push(`I have ${blindSpots.length} blind spot(s): ${blindSpots.map(bs => bs.category).join(', ')}.`);
      const worstSpot = blindSpots.sort((a, b) => a.confidence - b.confidence)[0];
      parts.push(`Weakest area: ${worstSpot.category} (${worstSpot.narrative}).`);
    }

    // Growth
    parts.push(`Growth assessment: ${growth.direction}. ${growth.narrative}`);

    // Emotional state
    parts.push(emotionalSummary);

    return parts.join(' ');
  }
}
