/**
 * AwarenessCore — Self-Knowledge Engine for SPARK.
 *
 * Maintains structured Beliefs about each CORD category and generates
 * full self-assessment AwarenessReports. The system knows:
 * - What it's good at (reliable categories)
 * - What it's still learning (building categories)
 * - What's unstable (volatile categories)
 * - What it doesn't know yet (insufficient data)
 *
 * Trust classification uses multiple signals:
 *   episode count + accuracy + stability variance
 *
 * All narratives are template-generated from data — no LLM calls.
 * Deterministic and testable.
 */

import type {
  SparkCategory,
  Belief,
  TrustLevel,
  TrendDirection,
  Insight,
  AwarenessReport,
  LearningEpisode,
} from '@ai-operations/shared-types';
import { SENTINEL_CATEGORIES } from '@ai-operations/shared-types';
import type { SparkStore } from '@ai-operations/ops-storage';
import { ALL_CATEGORIES, MAX_DEVIATION_PERCENT } from './constants';

// ── AwarenessCore ────────────────────────────────────────────────────

export class AwarenessCore {
  /** Minimum episodes for 'building' trust. */
  static readonly BUILDING_THRESHOLD = 3;

  /** Minimum episodes for 'reliable' trust. */
  static readonly RELIABLE_THRESHOLD = 20;

  /** Minimum accuracy for 'reliable' trust. */
  static readonly RELIABLE_ACCURACY = 0.7;

  /** Maximum variance for 'reliable' trust (lower = more stable). */
  static readonly STABILITY_THRESHOLD = 0.3;

  /** Minimum variance for 'volatile' classification. */
  static readonly VOLATILE_THRESHOLD = 0.6;

  /** Proximity to bounds that triggers alert. */
  static readonly BOUND_PROXIMITY = 0.1;

  /** Number of recent episodes for trend analysis. */
  static readonly TREND_WINDOW = 10;

  /** Report version for AwarenessReport metadata. */
  static readonly REPORT_VERSION = 1;

  private readonly store: SparkStore;

  constructor(store: SparkStore) {
    this.store = store;
  }

  /**
   * Assess a single category, producing a structured Belief.
   *
   * Computes accuracy, stability, calibration, trend, streak, trust level,
   * and generates a template-based narrative. Saves the belief to the store.
   *
   * @param category - The CORD tool category to assess.
   * @returns A structured Belief about the category.
   */
  assess(category: SparkCategory): Belief {
    const episodes = this.store.listEpisodes({ category, limit: 50 });
    const weight = this.store.getWeight(category);
    const episodeCount = weight?.episodeCount ?? 0;

    const accuracy = this.computeAccuracy(episodes);
    const stability = this.computeStability(episodes);
    const calibration = this.computeCalibration(episodeCount, accuracy);
    const trend = this.detectTrend(episodes);
    const streak = this.detectStreak(episodes);
    const trustLevel = this.classifyTrust(episodeCount, accuracy, stability);

    const narrative = this.generateNarrative(
      category,
      trustLevel,
      accuracy,
      episodeCount,
      stability,
      trend,
      streak,
    );

    const belief: Belief = {
      category,
      trustLevel,
      stability,
      calibration,
      narrative,
      evidence: {
        episodeCount,
        accuracy,
        recentTrend: trend,
        streakDirection: streak.direction,
        streakLength: streak.length,
      },
      updatedAt: new Date().toISOString(),
    };

    this.store.saveBelief(belief);
    return belief;
  }

  /**
   * Assess all 7 CORD categories.
   *
   * @returns A record mapping each category to its Belief.
   */
  assessAll(): Record<SparkCategory, Belief> {
    const beliefs = {} as Record<SparkCategory, Belief>;
    for (const category of ALL_CATEGORIES) {
      beliefs[category] = this.assess(category);
    }
    return beliefs;
  }

  /**
   * Generate a full self-assessment report.
   *
   * Includes beliefs for all categories, recent insights, system state
   * summary, and alert conditions.
   *
   * @returns A complete AwarenessReport.
   */
  report(): AwarenessReport {
    const beliefs = this.assessAll();
    const insights = this.store.listInsights({ limit: 10 });

    // System state
    const beliefValues = Object.values(beliefs);
    const totalEpisodes = beliefValues.reduce(
      (sum, b) => sum + b.evidence.episodeCount,
      0,
    );

    // Weighted average confidence (weight by episodeCount)
    let overallConfidence = 0;
    if (totalEpisodes > 0) {
      const weightedSum = beliefValues.reduce(
        (sum, b) => sum + b.calibration * b.evidence.episodeCount,
        0,
      );
      overallConfidence = Math.round((weightedSum / totalEpisodes) * 10000) / 10000;
    }

    const categoriesLearning = beliefValues
      .filter(b => b.trustLevel === 'building')
      .map(b => b.category);
    const categoriesStable = beliefValues
      .filter(b => b.trustLevel === 'reliable')
      .map(b => b.category);
    const categoriesVolatile = beliefValues
      .filter(b => b.trustLevel === 'volatile')
      .map(b => b.category);

    // Alerts
    const oscillating = beliefValues
      .filter(b => b.evidence.recentTrend === 'oscillating')
      .map(b => b.category);

    const lowConfidence = beliefValues
      .filter(
        b =>
          b.calibration < 0.4 &&
          b.evidence.episodeCount >= AwarenessCore.BUILDING_THRESHOLD,
      )
      .map(b => b.category);

    const nearingBounds: SparkCategory[] = [];
    for (const category of ALL_CATEGORIES) {
      const w = this.store.getWeight(category);
      if (w) {
        const distToUpper = w.upperBound - w.currentWeight;
        const distToLower = w.currentWeight - w.lowerBound;
        if (
          distToUpper <= AwarenessCore.BOUND_PROXIMITY ||
          distToLower <= AwarenessCore.BOUND_PROXIMITY
        ) {
          nearingBounds.push(category);
        }
      }
    }

    const sentinelActive: SparkCategory[] = [];
    for (const cat of SENTINEL_CATEGORIES) {
      const w = this.store.getWeight(cat);
      if (w && w.currentWeight > w.baseWeight) {
        sentinelActive.push(cat);
      }
    }

    // Episode window
    const allEpisodes = this.store.listEpisodes({ limit: 1 });
    const oldestEpisodes = this.store.listEpisodes({
      limit: 1,
      offset: Math.max(0, totalEpisodes - 1),
    });

    const now = new Date().toISOString();
    const episodeWindow = {
      from: oldestEpisodes.length > 0 ? oldestEpisodes[0].createdAt : now,
      to: allEpisodes.length > 0 ? allEpisodes[0].createdAt : now,
    };

    return {
      beliefs: beliefs as Record<SparkCategory, Belief>,
      systemState: {
        overallConfidence,
        totalEpisodes,
        categoriesLearning,
        categoriesStable,
        categoriesVolatile,
      },
      insights,
      alerts: {
        oscillating,
        lowConfidence,
        nearingBounds,
        sentinelActive,
      },
      meta: {
        reportVersion: AwarenessCore.REPORT_VERSION,
        generatedAt: now,
        episodeWindow,
      },
    };
  }

  // ── Private Methods ──────────────────────────────────────────────

  /**
   * Classify the trust level for a category based on multiple signals.
   */
  private classifyTrust(
    episodeCount: number,
    accuracy: number,
    stability: number,
  ): TrustLevel {
    if (episodeCount < AwarenessCore.BUILDING_THRESHOLD) {
      return 'insufficient';
    }

    if (stability < (1.0 - AwarenessCore.VOLATILE_THRESHOLD)) {
      return 'volatile';
    }

    if (
      episodeCount >= AwarenessCore.RELIABLE_THRESHOLD &&
      accuracy >= AwarenessCore.RELIABLE_ACCURACY &&
      stability >= (1.0 - AwarenessCore.STABILITY_THRESHOLD)
    ) {
      return 'reliable';
    }

    return 'building';
  }

  /**
   * Compute stability index from episode adjustment magnitudes.
   * Uses variance of magnitudes normalized by MAX_DEVIATION_PERCENT.
   */
  private computeStability(episodes: LearningEpisode[]): number {
    const directed = episodes.filter(e => e.adjustmentDirection !== 'none');
    if (directed.length === 0) return 1.0;

    const magnitudes = directed.map(e => e.adjustmentMagnitude);
    const mean = magnitudes.reduce((s, m) => s + m, 0) / magnitudes.length;
    const variance =
      magnitudes.reduce((s, m) => s + (m - mean) ** 2, 0) / magnitudes.length;

    // Use standard deviation (not raw variance) for dimensional consistency
    const stdDev = Math.sqrt(variance);
    const normalizedStdDev = stdDev / MAX_DEVIATION_PERCENT;
    const stability = 1.0 - Math.min(1.0, normalizedStdDev);

    return Math.round(stability * 10000) / 10000;
  }

  /**
   * Compute calibration score — how well confidence matches actual accuracy.
   * Mirrors Predictor formula: min(0.95, n / (n + 10)).
   */
  private computeCalibration(episodeCount: number, accuracy: number): number {
    if (episodeCount === 0) return 0;

    const expectedConfidence = Math.min(0.95, episodeCount / (episodeCount + 10));
    const calibration = 1.0 - Math.abs(expectedConfidence - accuracy);

    return Math.round(Math.max(0, Math.min(1.0, calibration)) * 10000) / 10000;
  }

  /**
   * Compute accuracy — proportion of episodes without outcome mismatch.
   */
  private computeAccuracy(episodes: LearningEpisode[]): number {
    if (episodes.length === 0) return 0;

    const correct = episodes.filter(e => !e.outcomeMismatch).length;
    return correct / episodes.length;
  }

  /**
   * Detect the recent trend direction from episode adjustments.
   */
  private detectTrend(episodes: LearningEpisode[]): TrendDirection {
    const recent = episodes.slice(0, AwarenessCore.TREND_WINDOW);
    const directed = recent.filter(e => e.adjustmentDirection !== 'none');

    if (directed.length < 3) return 'stable';

    // Count direction changes
    let directionChanges = 0;
    for (let i = 1; i < directed.length; i++) {
      if (directed[i].adjustmentDirection !== directed[i - 1].adjustmentDirection) {
        directionChanges++;
      }
    }

    const changeRatio = directionChanges / (directed.length - 1);
    if (changeRatio > 0.5) return 'oscillating';

    const increases = directed.filter(e => e.adjustmentDirection === 'increase').length;
    const decreases = directed.filter(e => e.adjustmentDirection === 'decrease').length;

    if (increases / directed.length >= 0.6) return 'degrading';
    if (decreases / directed.length >= 0.6) return 'improving';

    return 'stable';
  }

  /**
   * Detect the current streak from most recent episodes.
   */
  private detectStreak(
    episodes: LearningEpisode[],
  ): { direction: 'up' | 'down' | 'none'; length: number } {
    const directed = episodes.filter(e => e.adjustmentDirection !== 'none');
    if (directed.length < 2) return { direction: 'none', length: 0 };

    const firstDir = directed[0].adjustmentDirection;
    let streakLength = 1;

    for (let i = 1; i < directed.length; i++) {
      if (directed[i].adjustmentDirection === firstDir) {
        streakLength++;
      } else {
        break;
      }
    }

    if (streakLength < 2) return { direction: 'none', length: 0 };

    return {
      direction: firstDir === 'increase' ? 'up' : 'down',
      length: streakLength,
    };
  }

  /**
   * Generate a template-based narrative for a category's belief.
   * No LLM calls — fully deterministic and testable.
   */
  private generateNarrative(
    category: SparkCategory,
    trustLevel: TrustLevel,
    accuracy: number,
    episodeCount: number,
    _stability: number,
    trend: TrendDirection,
    streak: { direction: 'up' | 'down' | 'none'; length: number },
  ): string {
    const isSentinel = (SENTINEL_CATEGORIES as readonly string[]).includes(category);
    let narrative: string;

    switch (trustLevel) {
      case 'insufficient':
        narrative = `${category} has insufficient data — only ${episodeCount} episode${episodeCount !== 1 ? 's' : ''}. Need at least ${AwarenessCore.BUILDING_THRESHOLD} before learning begins.`;
        break;

      case 'reliable':
        narrative = `${category} is well-calibrated — ${(accuracy * 100).toFixed(0)}% accuracy over ${episodeCount} episodes with ${trend === 'stable' ? 'stable' : trend} weights.`;
        break;

      case 'volatile':
        narrative = `${category} is volatile — weight adjustments show high variance. ${
          trend === 'oscillating'
            ? 'Oscillating signals suggest environmental instability.'
            : 'Inconsistent outcomes suggest unpredictable conditions.'
        }`;
        break;

      case 'building': {
        narrative = `${category} is building trust — ${episodeCount} episodes, ${(accuracy * 100).toFixed(0)}% accuracy.`;
        if (streak.direction === 'up') {
          narrative += ` Trending more cautious (${streak.length} consecutive increases).`;
        } else if (streak.direction === 'down') {
          narrative += ` Trending more permissive (${streak.length} consecutive decreases).`;
        }
        break;
      }
    }

    if (isSentinel) {
      narrative += ' SENTINEL protection ensures it never drops below base weight.';
    }

    return narrative;
  }
}
