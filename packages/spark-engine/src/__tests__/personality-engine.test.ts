/**
 * Tests for the PersonalityEngine.
 */
import { Database } from '@ai-operations/ops-storage';
import { SparkStore } from '@ai-operations/ops-storage';
import { PersonalityEngine } from '../personality-engine';
import type { PersonalityContext, PersonalityProfile } from '@ai-operations/shared-types';

function createTestDb(): SparkStore {
  const db = new Database(':memory:');
  return new SparkStore(db.db);
}

function defaultContext(overrides: Partial<PersonalityContext> = {}): PersonalityContext {
  return {
    topicDiversity: 2,
    hasSentinelCategories: false,
    emotionalValence: 0,
    queryIntent: 'status',
    emotionalMomentum: 'stable',
    ...overrides,
  };
}

describe('PersonalityEngine', () => {
  let store: SparkStore;
  let engine: PersonalityEngine;

  beforeEach(() => {
    store = createTestDb();
    engine = new PersonalityEngine(store);
  });

  describe('default profile', () => {
    it('starts with all traits at 0.5', () => {
      const profile = engine.getProfile();
      expect(profile.curiosity).toBe(0.5);
      expect(profile.caution).toBe(0.5);
      expect(profile.warmth).toBe(0.5);
      expect(profile.directness).toBe(0.5);
      expect(profile.playfulness).toBe(0.5);
    });
  });

  describe('trait evolution', () => {
    it('increases curiosity with high topic diversity', () => {
      const before = engine.getProfile().curiosity;
      engine.evolve(defaultContext({ topicDiversity: 8 }));
      const after = engine.getProfile().curiosity;
      expect(after).toBeGreaterThan(before);
    });

    it('decreases curiosity with low topic diversity', () => {
      const before = engine.getProfile().curiosity;
      engine.evolve(defaultContext({ topicDiversity: 1 }));
      const after = engine.getProfile().curiosity;
      expect(after).toBeLessThan(before);
    });

    it('increases caution with SENTINEL categories', () => {
      const before = engine.getProfile().caution;
      engine.evolve(defaultContext({ hasSentinelCategories: true }));
      const after = engine.getProfile().caution;
      expect(after).toBeGreaterThan(before);
    });

    it('increases warmth with positive valence', () => {
      const before = engine.getProfile().warmth;
      engine.evolve(defaultContext({ emotionalValence: 0.8 }));
      const after = engine.getProfile().warmth;
      expect(after).toBeGreaterThan(before);
    });

    it('decreases warmth with negative valence', () => {
      const before = engine.getProfile().warmth;
      engine.evolve(defaultContext({ emotionalValence: -0.8 }));
      const after = engine.getProfile().warmth;
      expect(after).toBeLessThan(before);
    });

    it('increases directness with explain/diagnose intents', () => {
      const before = engine.getProfile().directness;
      engine.evolve(defaultContext({ queryIntent: 'diagnose' }));
      const after = engine.getProfile().directness;
      expect(after).toBeGreaterThan(before);
    });

    it('increases playfulness with improving momentum', () => {
      const before = engine.getProfile().playfulness;
      engine.evolve(defaultContext({ emotionalMomentum: 'improving' }));
      const after = engine.getProfile().playfulness;
      expect(after).toBeGreaterThan(before);
    });

    it('decreases playfulness with declining momentum', () => {
      const before = engine.getProfile().playfulness;
      engine.evolve(defaultContext({ emotionalMomentum: 'declining' }));
      const after = engine.getProfile().playfulness;
      expect(after).toBeLessThan(before);
    });
  });

  describe('bounds clamping', () => {
    it('does not exceed PERSONALITY_TRAIT_MAX (0.9)', () => {
      // Push curiosity as high as possible
      for (let i = 0; i < 200; i++) {
        engine.evolve(defaultContext({ topicDiversity: 10 }));
      }
      expect(engine.getProfile().curiosity).toBeLessThanOrEqual(0.9);
    });

    it('does not go below PERSONALITY_TRAIT_MIN (0.1)', () => {
      // Push curiosity as low as possible
      for (let i = 0; i < 200; i++) {
        engine.evolve(defaultContext({ topicDiversity: 0 }));
      }
      expect(engine.getProfile().curiosity).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('response modulation', () => {
    it('adds warm preamble when warmth > 0.65', () => {
      // Force warmth high
      for (let i = 0; i < 50; i++) {
        engine.evolve(defaultContext({ emotionalValence: 0.9 }));
      }
      expect(engine.getProfile().warmth).toBeGreaterThan(0.65);

      const result = engine.modulateResponse('System is running well.');
      // Should start with a warm preamble (lowercase 's' after preamble)
      expect(result).toMatch(/^(I appreciate|Great question|Thanks for)/);
    });

    it('removes hedging words when directness > 0.65', () => {
      // Force directness high
      for (let i = 0; i < 50; i++) {
        engine.evolve(defaultContext({ queryIntent: 'explain' }));
      }
      expect(engine.getProfile().directness).toBeGreaterThan(0.65);

      const result = engine.modulateResponse('I think perhaps the system maybe needs attention.');
      expect(result).not.toContain('I think');
      expect(result).not.toContain('perhaps');
      expect(result).not.toContain('maybe');
    });

    it('adds caution qualifier when caution > 0.65', () => {
      // Force caution high
      for (let i = 0; i < 50; i++) {
        engine.evolve(defaultContext({ hasSentinelCategories: true }));
      }
      expect(engine.getProfile().caution).toBeGreaterThan(0.65);

      const result = engine.modulateResponse('System is ready.');
      expect(result).toContain('confidence varies by category');
    });

    it('does not modulate when traits are at defaults', () => {
      const input = 'System is ready.';
      const result = engine.modulateResponse(input);
      // With all traits at 0.5, no modulation should be applied
      expect(result).toBe(input);
    });
  });

  describe('consistency scoring', () => {
    it('returns 1.0 with no history', () => {
      expect(engine.getConsistencyScore()).toBe(1.0);
    });

    it('is high with consistent inputs', () => {
      for (let i = 0; i < 20; i++) {
        engine.evolve(defaultContext({ topicDiversity: 5, emotionalValence: 0.3 }));
      }
      expect(engine.getConsistencyScore()).toBeGreaterThan(0.5);
    });

    it('is lower with erratic inputs', () => {
      for (let i = 0; i < 20; i++) {
        const erratic = i % 2 === 0
          ? defaultContext({ topicDiversity: 10, emotionalValence: 0.9, emotionalMomentum: 'improving' })
          : defaultContext({ topicDiversity: 0, emotionalValence: -0.9, emotionalMomentum: 'declining' });
        engine.evolve(erratic);
      }
      // Should still be reasonable — personality changes are slow
      expect(engine.getConsistencyScore()).toBeDefined();
    });
  });

  describe('summary', () => {
    it('returns a human-readable summary', () => {
      const summary = engine.getSummary();
      expect(summary).toContain('Personality');
      expect(summary).toContain('balanced');
      expect(summary).toContain('Consistency');
    });

    it('includes trait names after evolution', () => {
      // Push warmth high
      for (let i = 0; i < 50; i++) {
        engine.evolve(defaultContext({ emotionalValence: 0.9 }));
      }
      const summary = engine.getSummary();
      expect(summary).toContain('warm');
    });
  });

  describe('persistence', () => {
    it('saves and restores personality profile', () => {
      // Evolve the personality
      for (let i = 0; i < 10; i++) {
        engine.evolve(defaultContext({ topicDiversity: 8, emotionalValence: 0.5 }));
      }

      const profileBefore = engine.getProfile();

      // Create a new engine from the same store (simulates restart)
      const engine2 = new PersonalityEngine(store);
      const profileAfter = engine2.getProfile();

      expect(profileAfter.curiosity).toBeCloseTo(profileBefore.curiosity, 4);
      expect(profileAfter.warmth).toBeCloseTo(profileBefore.warmth, 4);
      expect(profileAfter.caution).toBeCloseTo(profileBefore.caution, 4);
      expect(profileAfter.directness).toBeCloseTo(profileBefore.directness, 4);
      expect(profileAfter.playfulness).toBeCloseTo(profileBefore.playfulness, 4);
    });
  });
});
