/**
 * EmotionalStateEngine — Tracks SPARK's persistent emotional state.
 *
 * Maintains a running emotional valence (EMA of recent sentiment),
 * computes momentum (improving/declining/stable) via linear regression,
 * and tracks volatility (stddev of recent readings). High-emotion
 * tokens are flagged for strength boosts during spiral passes.
 *
 * This gives SPARK a heart — an affective baseline that colors
 * its reasoning and strengthens emotionally significant memories.
 */

import type { SparkStore } from '@ai-operations/ops-storage';
import type { Essence, EmotionalState, EmotionalMomentum } from '@ai-operations/shared-types';
import {
  EMOTIONAL_EMA_ALPHA,
  EMOTIONAL_RING_BUFFER_SIZE,
  EMOTIONAL_HIGH_INTENSITY_THRESHOLD,
  EMOTIONAL_VOLATILITY_HIGH,
} from './spiral-constants';

export class EmotionalStateEngine {
  private readonly store: SparkStore;
  private valence: number;
  private valenceHistory: number[];
  private highEmotionTokenIds: Set<string>;
  private lastUpdatedAt: string;

  constructor(store: SparkStore) {
    this.store = store;
    this.valence = 0;
    this.valenceHistory = [];
    this.highEmotionTokenIds = new Set();
    this.lastUpdatedAt = new Date().toISOString();

    // Restore from storage if available
    this.restore();
  }

  /**
   * Update emotional state based on a new essence extraction.
   * Converts sentiment valence + intensity to a numeric signal
   * and blends via EMA.
   */
  updateFromEssence(essence: Essence, tokenId?: string): void {
    const signal = this.essenceToSignal(essence);
    this.applySignal(signal);

    // Track high-emotion tokens
    if (tokenId && essence.sentimentIntensity > EMOTIONAL_HIGH_INTENSITY_THRESHOLD) {
      this.highEmotionTokenIds.add(tokenId);
    }

    this.lastUpdatedAt = new Date().toISOString();
    this.persist();
  }

  /**
   * Check whether a token ID has been flagged as high-emotion.
   */
  isHighEmotion(tokenId: string): boolean {
    return this.highEmotionTokenIds.has(tokenId);
  }

  /**
   * Get the current emotional state snapshot.
   */
  getState(): EmotionalState {
    return {
      valence: parseFloat(this.valence.toFixed(4)),
      momentum: this.computeMomentum(),
      volatility: parseFloat(this.computeVolatility().toFixed(4)),
      highEmotionCount: this.highEmotionTokenIds.size,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  /**
   * Get a human-readable emotional summary for reasoning responses.
   */
  getSummary(): string {
    const state = this.getState();
    const valenceLabel = state.valence > 0.2 ? 'positive'
      : state.valence < -0.2 ? 'negative'
      : 'neutral';
    const momentumLabel = state.momentum === 'improving' ? 'trending upward'
      : state.momentum === 'declining' ? 'trending downward'
      : 'holding steady';
    const volatilityLabel = state.volatility > EMOTIONAL_VOLATILITY_HIGH ? 'turbulent' : 'calm';

    return `Emotionally ${valenceLabel} (valence ${state.valence.toFixed(2)}), ${momentumLabel}, and ${volatilityLabel}.`;
  }

  // ── Private ────────────────────────────────────────────────────

  /**
   * Convert an Essence's sentiment into a numeric signal (-1 to +1).
   */
  private essenceToSignal(essence: Essence): number {
    const { sentiment, sentimentIntensity } = essence;
    const intensity = Math.min(1.0, sentimentIntensity);

    switch (sentiment) {
      case 'positive':
        return intensity;
      case 'negative':
        return -intensity;
      case 'mixed':
        return intensity * 0.1; // Slightly positive bias for mixed
      case 'neutral':
      default:
        return 0;
    }
  }

  /**
   * Apply a new signal via EMA and update ring buffer.
   */
  private applySignal(signal: number): void {
    // EMA: valence = α * signal + (1 - α) * valence
    this.valence = EMOTIONAL_EMA_ALPHA * signal + (1 - EMOTIONAL_EMA_ALPHA) * this.valence;

    // Clamp to [-1, 1]
    this.valence = Math.max(-1.0, Math.min(1.0, this.valence));

    // Add to ring buffer
    this.valenceHistory.push(this.valence);
    if (this.valenceHistory.length > EMOTIONAL_RING_BUFFER_SIZE) {
      this.valenceHistory.shift();
    }
  }

  /**
   * Compute momentum via linear regression slope over the ring buffer.
   */
  private computeMomentum(): EmotionalMomentum {
    if (this.valenceHistory.length < 3) return 'stable';

    const n = this.valenceHistory.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += this.valenceHistory[i];
      sumXY += i * this.valenceHistory[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    if (slope > 0.02) return 'improving';
    if (slope < -0.02) return 'declining';
    return 'stable';
  }

  /**
   * Compute volatility as standard deviation of the ring buffer.
   */
  private computeVolatility(): number {
    if (this.valenceHistory.length < 2) return 0;

    const n = this.valenceHistory.length;
    const mean = this.valenceHistory.reduce((s, v) => s + v, 0) / n;
    const variance = this.valenceHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

    return Math.min(1.0, Math.sqrt(variance));
  }

  /**
   * Persist current state to storage.
   */
  private persist(): void {
    this.store.saveEmotionalState({
      valence: this.valence,
      momentum: this.computeMomentum(),
      volatility: this.computeVolatility(),
      highEmotionCount: this.highEmotionTokenIds.size,
      lastUpdatedAt: this.lastUpdatedAt,
      valenceHistory: this.valenceHistory,
      highEmotionTokenIds: [...this.highEmotionTokenIds],
    });
  }

  /**
   * Restore state from storage.
   */
  private restore(): void {
    const saved = this.store.getEmotionalState();
    if (saved) {
      this.valence = saved.valence;
      this.valenceHistory = saved.valenceHistory || [];
      this.highEmotionTokenIds = new Set(saved.highEmotionTokenIds || []);
      this.lastUpdatedAt = saved.lastUpdatedAt;
    }
  }
}
