/**
 * PersonalityEngine — Evolving Personality Traits for SPARK.
 *
 * Gives SPARK an evolving personality that subtly shapes how it communicates.
 * Five traits (0.0-1.0) drift slowly based on interaction patterns:
 *
 * - curiosity:    ↑ with diverse topics
 * - caution:      ↑ with SENTINEL-category operations
 * - warmth:       ↑ with positive emotional valence
 * - directness:   ↑ with explain/diagnose intents
 * - playfulness:  ↑ with positive emotional momentum
 *
 * All traits are clamped to [0.1, 0.9] to prevent extreme behaviour.
 *
 * `modulateResponse()` applies personality-specific preambles, hedging
 * removal, casual phrasing, and qualifiers to a generated response.
 */

import type { SparkStore } from '@ai-operations/ops-storage';
import type { PersonalityProfile, PersonalityContext } from '@ai-operations/shared-types';
import {
  PERSONALITY_LEARNING_RATE,
  PERSONALITY_TRAIT_MIN,
  PERSONALITY_TRAIT_MAX,
  PERSONALITY_DEFAULT,
  PERSONALITY_CONSISTENCY_WINDOW,
} from './spiral-constants';

export class PersonalityEngine {
  private profile: PersonalityProfile;
  private readonly store: SparkStore;
  /** Ring buffer of recent absolute trait deltas for consistency scoring. */
  private readonly recentDeltas: number[] = [];

  constructor(store: SparkStore) {
    this.store = store;
    // Attempt to restore from persistence
    const saved = store.getPersonality();
    if (saved) {
      this.profile = saved;
    } else {
      this.profile = this.defaultProfile();
    }
  }

  /** Get the current personality profile. */
  getProfile(): PersonalityProfile {
    return { ...this.profile };
  }

  /**
   * Evolve personality traits based on interaction context.
   * Changes are tiny (learning rate 0.02) so personality drifts slowly.
   */
  evolve(context: PersonalityContext): void {
    const lr = PERSONALITY_LEARNING_RATE;
    const deltas: number[] = [];

    // Curiosity: increases with diverse topics
    const curiosityDelta = context.topicDiversity > 3
      ? lr * (context.topicDiversity / 10)
      : -lr * 0.2;
    this.profile.curiosity = this.clamp(this.profile.curiosity + curiosityDelta);
    deltas.push(Math.abs(curiosityDelta));

    // Caution: increases with SENTINEL categories
    const cautionDelta = context.hasSentinelCategories
      ? lr * 0.5
      : -lr * 0.1;
    this.profile.caution = this.clamp(this.profile.caution + cautionDelta);
    deltas.push(Math.abs(cautionDelta));

    // Warmth: increases with positive valence
    const warmthDelta = context.emotionalValence > 0
      ? lr * context.emotionalValence
      : lr * context.emotionalValence * 0.5; // Slower decrease
    this.profile.warmth = this.clamp(this.profile.warmth + warmthDelta);
    deltas.push(Math.abs(warmthDelta));

    // Directness: increases with explain/diagnose intents
    const directIntents = ['explain', 'diagnose', 'compare'];
    const directnessDelta = directIntents.includes(context.queryIntent)
      ? lr * 0.5
      : -lr * 0.1;
    this.profile.directness = this.clamp(this.profile.directness + directnessDelta);
    deltas.push(Math.abs(directnessDelta));

    // Playfulness: increases with positive momentum
    const playfulnessDelta = context.emotionalMomentum === 'improving'
      ? lr * 0.5
      : context.emotionalMomentum === 'declining'
        ? -lr * 0.3
        : 0;
    this.profile.playfulness = this.clamp(this.profile.playfulness + playfulnessDelta);
    deltas.push(Math.abs(playfulnessDelta));

    // Track deltas for consistency scoring
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    this.recentDeltas.push(avgDelta);
    if (this.recentDeltas.length > PERSONALITY_CONSISTENCY_WINDOW) {
      this.recentDeltas.shift();
    }

    // Persist
    this.store.savePersonality(this.profile);
  }

  /**
   * Modulate a response string based on current personality traits.
   * Applied as a post-processing step after composeResponse().
   */
  modulateResponse(text: string): string {
    let result = text;

    // High warmth (> 0.65): add empathetic preamble
    if (this.profile.warmth > 0.65) {
      const warmPreambles = [
        'I appreciate you asking — ',
        'Great question — ',
        'Thanks for checking in — ',
      ];
      const preamble = warmPreambles[text.length % warmPreambles.length];
      result = preamble + result.charAt(0).toLowerCase() + result.slice(1);
    }

    // High directness (> 0.65): remove hedging words
    if (this.profile.directness > 0.65) {
      result = result
        .replace(/\bI think\b/gi, '')
        .replace(/\bperhaps\b/gi, '')
        .replace(/\bmaybe\b/gi, '')
        .replace(/\bpossibly\b/gi, '')
        .replace(/\bit seems like\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    // High playfulness (> 0.65): add casual closing
    if (this.profile.playfulness > 0.65) {
      if (!result.endsWith('!') && !result.endsWith('?')) {
        const closings = [
          ' — pretty interesting, right?',
          ' — let me know what you think!',
          ' — fun stuff.',
        ];
        result += closings[text.length % closings.length];
      }
    }

    // High caution (> 0.65): add qualifier
    if (this.profile.caution > 0.65) {
      result += ' (Note: confidence varies by category — see introspection for details.)';
    }

    // High curiosity (> 0.65): add exploration prompt
    if (this.profile.curiosity > 0.65) {
      result += ' Want me to dig deeper into any aspect of this?';
    }

    return result;
  }

  /**
   * Compute how consistent recent trait changes have been.
   * Returns 0.0 (erratic) to 1.0 (perfectly stable).
   * Based on variance of recent deltas — low variance = high consistency.
   */
  getConsistencyScore(): number {
    if (this.recentDeltas.length < 2) return 1.0;

    const mean = this.recentDeltas.reduce((s, d) => s + d, 0) / this.recentDeltas.length;
    const variance = this.recentDeltas.reduce((s, d) => s + (d - mean) ** 2, 0) / this.recentDeltas.length;

    // Map variance to 0-1 scale (lower variance = higher consistency)
    // Variance of ~0.001 maps to ~0.9 consistency
    return Math.max(0, Math.min(1, 1 - variance * 100));
  }

  /**
   * Get a human-readable summary of the current personality.
   */
  getSummary(): string {
    const p = this.profile;
    const traits: string[] = [];

    if (p.curiosity > 0.6) traits.push('curious');
    else if (p.curiosity < 0.4) traits.push('focused');

    if (p.caution > 0.6) traits.push('cautious');
    else if (p.caution < 0.4) traits.push('bold');

    if (p.warmth > 0.6) traits.push('warm');
    else if (p.warmth < 0.4) traits.push('reserved');

    if (p.directness > 0.6) traits.push('direct');
    else if (p.directness < 0.4) traits.push('nuanced');

    if (p.playfulness > 0.6) traits.push('playful');
    else if (p.playfulness < 0.4) traits.push('serious');

    if (traits.length === 0) traits.push('balanced');

    return `Personality: ${traits.join(', ')}. Consistency: ${(this.getConsistencyScore() * 100).toFixed(0)}%.`;
  }

  // ── Private ──────────────────────────────────────────────────────

  private defaultProfile(): PersonalityProfile {
    return {
      curiosity: PERSONALITY_DEFAULT,
      caution: PERSONALITY_DEFAULT,
      warmth: PERSONALITY_DEFAULT,
      directness: PERSONALITY_DEFAULT,
      playfulness: PERSONALITY_DEFAULT,
    };
  }

  private clamp(value: number): number {
    return Math.max(PERSONALITY_TRAIT_MIN, Math.min(PERSONALITY_TRAIT_MAX, value));
  }
}
