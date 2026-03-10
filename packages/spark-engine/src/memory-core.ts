/**
 * MemoryCore — Memory Consolidation Engine for SPARK.
 *
 * Analyzes learning episode history to detect patterns and generate
 * Insight records. Insights are generated alongside raw data — episodes
 * are never deleted.
 *
 * Pattern detectors:
 * - Streaks:       3+ consecutive same-direction adjustments
 * - Oscillations:  4+ alternations between increase/decrease
 * - Convergence:   Magnitudes decreasing (approaching stability)
 * - Anomalies:     Sudden spike > 3× average magnitude
 * - Milestones:    Episode count thresholds (10, 25, 50, 100, 250, 500)
 *
 * All narratives are template-generated from data — no LLM calls.
 * Deterministic and testable.
 */

import { randomUUID } from 'node:crypto';
import type {
  Insight,
  InsightPattern,
  LearningEpisode,
  SparkCategory,
} from '@ai-ops/shared-types';
import { SENTINEL_CATEGORIES } from '@ai-ops/shared-types';
import type { SparkStore } from '@ai-ops/ops-storage';
import { ALL_CATEGORIES, MAX_DEVIATION_PERCENT } from './constants';

// ── MemoryCore ───────────────────────────────────────────────────────

export class MemoryCore {
  /** Minimum consecutive same-direction adjustments to flag a streak. */
  static readonly STREAK_THRESHOLD = 3;

  /** Minimum alternations to flag an oscillation pattern. */
  static readonly OSCILLATION_THRESHOLD = 4;

  /** Number of recent episodes to analyze per category. */
  static readonly ANALYSIS_WINDOW = 20;

  /** Episode count milestones that generate insights. */
  static readonly MILESTONES = [10, 25, 50, 100, 250, 500] as const;

  private readonly store: SparkStore;

  constructor(store: SparkStore) {
    this.store = store;
  }

  /**
   * Consolidate a newly created learning episode — detect patterns
   * in recent history for the episode's category.
   *
   * Called after each LearningCore.learn() invocation.
   *
   * @param episode - The episode just created.
   * @returns Array of insights generated (0 or more).
   */
  consolidate(episode: LearningEpisode): Insight[] {
    const category = episode.category;
    const episodes = this.store.listEpisodes({
      category,
      limit: MemoryCore.ANALYSIS_WINDOW,
    });

    return this.runDetectors(category, episodes);
  }

  /**
   * Full scan — analyze all categories for patterns.
   * Useful on startup or after bulk episode imports.
   *
   * @returns Array of all insights generated across all categories.
   */
  consolidateAll(): Insight[] {
    const allInsights: Insight[] = [];

    for (const category of ALL_CATEGORIES) {
      const episodes = this.store.listEpisodes({
        category,
        limit: MemoryCore.ANALYSIS_WINDOW,
      });
      if (episodes.length === 0) continue;

      const insights = this.runDetectors(category, episodes);
      allInsights.push(...insights);
    }

    return allInsights;
  }

  /**
   * Compute the impact score for a learning episode.
   *
   * Formula:
   *   base = magnitude / MAX_DEVIATION_PERCENT
   *   × 1.5 if outcome mismatch
   *   × 1.3 if SENTINEL category
   *   Clamped to [0, 1]
   *
   * @param episode - The episode to score.
   * @returns Impact score between 0.0 and 1.0.
   */
  computeImpactScore(episode: LearningEpisode): number {
    let impact = episode.adjustmentMagnitude / MAX_DEVIATION_PERCENT;

    if (episode.outcomeMismatch) {
      impact *= 1.5;
    }

    if ((SENTINEL_CATEGORIES as readonly string[]).includes(episode.category)) {
      impact *= 1.3;
    }

    return Math.min(1.0, Math.max(0, impact));
  }

  // ── Private ──────────────────────────────────────────────────────

  /**
   * Run all pattern detectors and collect non-null insights.
   */
  private runDetectors(category: SparkCategory, episodes: LearningEpisode[]): Insight[] {
    const insights: Insight[] = [];

    const detectors = [
      this.detectStreaks(category, episodes),
      this.detectOscillations(category, episodes),
      this.detectConvergence(category, episodes),
      this.detectAnomalies(category, episodes),
      this.checkMilestones(category, episodes),
    ];

    for (const insight of detectors) {
      if (insight) {
        this.store.saveInsight(insight);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Detect 3+ consecutive same-direction adjustments (ignoring 'none').
   * Impact = min(1.0, length / 10).
   */
  private detectStreaks(
    category: SparkCategory,
    episodes: LearningEpisode[],
  ): Insight | null {
    // Episodes come ordered by created_at DESC — newest first
    const directed = episodes.filter(e => e.adjustmentDirection !== 'none');
    if (directed.length < MemoryCore.STREAK_THRESHOLD) return null;

    // Count consecutive same direction from the newest
    const firstDir = directed[0].adjustmentDirection;
    let streakLength = 1;

    for (let i = 1; i < directed.length; i++) {
      if (directed[i].adjustmentDirection === firstDir) {
        streakLength++;
      } else {
        break;
      }
    }

    if (streakLength < MemoryCore.STREAK_THRESHOLD) return null;

    const streakEpisodes = directed.slice(0, streakLength);
    const dirLabel = firstDir === 'increase' ? 'upward' : 'downward';
    const behavior = firstDir === 'increase'
      ? 'Becoming more cautious'
      : 'Becoming more permissive';

    return {
      id: randomUUID(),
      category,
      pattern: 'streak' as InsightPattern,
      summary: `${category} has ${streakLength} consecutive ${dirLabel} adjustments. ${behavior} — persistent signal.`,
      evidence: {
        episodeIds: streakEpisodes.map(e => e.id),
        window: {
          from: streakEpisodes[streakEpisodes.length - 1].createdAt,
          to: streakEpisodes[0].createdAt,
        },
      },
      impact: Math.min(1.0, streakLength / 10),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Detect 4+ alternations between increase/decrease in window.
   * Impact = min(1.0, alternationCount / 8).
   */
  private detectOscillations(
    category: SparkCategory,
    episodes: LearningEpisode[],
  ): Insight | null {
    const directed = episodes.filter(e => e.adjustmentDirection !== 'none');
    if (directed.length < MemoryCore.OSCILLATION_THRESHOLD) return null;

    let alternations = 0;
    for (let i = 1; i < directed.length; i++) {
      if (directed[i].adjustmentDirection !== directed[i - 1].adjustmentDirection) {
        alternations++;
      }
    }

    if (alternations < MemoryCore.OSCILLATION_THRESHOLD) return null;

    return {
      id: randomUUID(),
      category,
      pattern: 'oscillation' as InsightPattern,
      summary: `${category} is oscillating between increasing and decreasing weight (${alternations} alternations). Environmental instability or conflicting signals.`,
      evidence: {
        episodeIds: directed.map(e => e.id),
        window: {
          from: directed[directed.length - 1].createdAt,
          to: directed[0].createdAt,
        },
      },
      impact: Math.min(1.0, alternations / 8),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Detect convergence — magnitudes decreasing over time.
   * Requires 5+ non-zero episodes. Checks if 80% of consecutive
   * pairs have decreasing magnitude.
   * Impact = 0.6.
   */
  private detectConvergence(
    category: SparkCategory,
    episodes: LearningEpisode[],
  ): Insight | null {
    const nonZero = episodes.filter(e => e.adjustmentMagnitude > 0);
    if (nonZero.length < 5) return null;

    // Episodes are newest-first — reverse to get chronological order
    const chronological = [...nonZero].reverse();

    let decreasingPairs = 0;
    const totalPairs = chronological.length - 1;

    for (let i = 1; i < chronological.length; i++) {
      if (chronological[i].adjustmentMagnitude <= chronological[i - 1].adjustmentMagnitude) {
        decreasingPairs++;
      }
    }

    const ratio = decreasingPairs / totalPairs;
    if (ratio < 0.8) return null;

    return {
      id: randomUUID(),
      category,
      pattern: 'convergence' as InsightPattern,
      summary: `${category} weight adjustments are converging — approaching stable calibration.`,
      evidence: {
        episodeIds: nonZero.map(e => e.id),
        window: {
          from: nonZero[nonZero.length - 1].createdAt,
          to: nonZero[0].createdAt,
        },
      },
      impact: 0.6,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Detect anomalies — latest magnitude > 3× average of prior episodes.
   * Impact scales with ratio: min(1.0, ratio / 5).
   */
  private detectAnomalies(
    category: SparkCategory,
    episodes: LearningEpisode[],
  ): Insight | null {
    const nonZero = episodes.filter(e => e.adjustmentMagnitude > 0);
    if (nonZero.length < 3) return null;

    const latest = nonZero[0];
    const priors = nonZero.slice(1, 11); // Up to 10 prior episodes
    if (priors.length === 0) return null;

    const avgMagnitude = priors.reduce((s, e) => s + e.adjustmentMagnitude, 0) / priors.length;
    if (avgMagnitude === 0) return null;

    const ratio = latest.adjustmentMagnitude / avgMagnitude;
    if (ratio < 3) return null;

    return {
      id: randomUUID(),
      category,
      pattern: 'anomaly' as InsightPattern,
      summary: `${category} experienced an anomalous adjustment (${latest.adjustmentMagnitude.toFixed(4)} vs avg ${avgMagnitude.toFixed(4)}). Unusual event.`,
      evidence: {
        episodeIds: [latest.id, ...priors.map(e => e.id)],
        window: {
          from: priors[priors.length - 1].createdAt,
          to: latest.createdAt,
        },
      },
      impact: Math.min(1.0, ratio / 5),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Check if the total episode count hits an exact milestone.
   * Milestones: 10, 25, 50, 100, 250, 500.
   * Impact = 0.3.
   */
  private checkMilestones(
    category: SparkCategory,
    episodes: LearningEpisode[],
  ): Insight | null {
    const weight = this.store.getWeight(category);
    const episodeCount = weight?.episodeCount ?? episodes.length;

    const milestoneMessages: Record<number, string> = {
      10: 'initial patterns forming',
      25: 'building confidence',
      50: 'substantial learning history',
      100: 'mature learning state',
      250: 'extensive experience',
      500: 'expert-level calibration',
    };

    for (const milestone of MemoryCore.MILESTONES) {
      if (episodeCount === milestone) {
        const message = milestoneMessages[milestone];

        return {
          id: randomUUID(),
          category,
          pattern: 'milestone' as InsightPattern,
          summary: `${category} reached ${milestone} learning episodes — ${message}.`,
          evidence: {
            episodeIds: episodes.slice(0, 5).map(e => e.id),
            window: {
              from: episodes.length > 0 ? episodes[episodes.length - 1].createdAt : new Date().toISOString(),
              to: episodes.length > 0 ? episodes[0].createdAt : new Date().toISOString(),
            },
          },
          impact: 0.3,
          createdAt: new Date().toISOString(),
        };
      }
    }

    return null;
  }
}
