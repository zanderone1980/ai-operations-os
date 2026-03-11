/**
 * Tests for the SelfReflectionEngine.
 */
import { Database } from '@ai-operations/ops-storage';
import { SparkStore } from '@ai-operations/ops-storage';
import { SelfReflectionEngine } from '../self-reflection';
import { EssenceExtractor } from '../essence-extractor';
import { MemoryTokenManager } from '../memory-token-manager';
import { SpiralLoop } from '../spiral-loop';
import { EmotionalStateEngine } from '../emotional-state';
import { ALL_CATEGORIES } from '../constants';
import type { SparkCategory, Belief, BlindSpot } from '@ai-operations/shared-types';

function createTestDb(): SparkStore {
  const db = new Database(':memory:');
  return new SparkStore(db.db);
}

function createFullEngine(store: SparkStore) {
  const extractor = new EssenceExtractor(store);
  const tokenManager = new MemoryTokenManager(store, extractor);
  const emotionalState = new EmotionalStateEngine(store);
  const spiral = new SpiralLoop(store, tokenManager, extractor, emotionalState);
  const engine = new SelfReflectionEngine(store);
  engine.setEngines({ tokenManager, spiral, emotionalState });
  return { engine, tokenManager, spiral, emotionalState, extractor };
}

function seedBelief(store: SparkStore, category: SparkCategory, overrides: Partial<Belief> = {}): void {
  store.saveBelief({
    category,
    trustLevel: 'building',
    stability: 0.5,
    calibration: 0.6,
    narrative: `Belief for ${category}`,
    evidence: {
      episodeCount: 10,
      accuracy: 0.8,
      recentTrend: 'improving',
      streakDirection: 'none',
      streakLength: 0,
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  });
}

describe('SelfReflectionEngine', () => {
  let store: SparkStore;
  let engine: SelfReflectionEngine;

  beforeEach(() => {
    store = createTestDb();
    const full = createFullEngine(store);
    engine = full.engine;
  });

  describe('blind spot detection', () => {
    it('detects categories with no episodes as blind spots', () => {
      // No episodes at all — every category is a blind spot
      const result = engine.reflect();
      expect(result.blindSpots.length).toBe(ALL_CATEGORIES.length);
      expect(result.blindSpots.every(bs => bs.episodeCount === 0)).toBe(true);
    });

    it('does not flag categories with enough episodes and high confidence', () => {
      // Seed a belief with sufficient data for 'communication'
      seedBelief(store, 'communication', {
        calibration: 0.8,
        evidence: { episodeCount: 20, accuracy: 0.9, recentTrend: 'stable', streakDirection: 'none', streakLength: 0 },
      });
      // Seed some episodes so the count check passes
      for (let i = 0; i < 5; i++) {
        store.saveEpisode({
          id: `ep-comm-${i}`,
          predictionId: `pred-${i}`,
          outcomeId: `out-${i}`,
          category: 'communication',
          scoreDelta: 0,
          outcomeMismatch: false,
          adjustmentDirection: 'none',
          adjustmentMagnitude: 0,
          weightBefore: 1.0,
          weightAfter: 1.0,
          reason: 'test',
          createdAt: new Date().toISOString(),
        });
      }

      const result = engine.reflect();
      const commBlindSpot = result.blindSpots.find(bs => bs.category === 'communication');
      expect(commBlindSpot).toBeUndefined();
    });

    it('flags categories with low confidence despite episodes', () => {
      seedBelief(store, 'financial', {
        calibration: 0.2,
        evidence: { episodeCount: 10, accuracy: 0.4, recentTrend: 'degrading', streakDirection: 'down', streakLength: 3 },
      });
      for (let i = 0; i < 5; i++) {
        store.saveEpisode({
          id: `ep-fin-${i}`,
          predictionId: `pred-${i}`,
          outcomeId: `out-${i}`,
          category: 'financial',
          scoreDelta: 5,
          outcomeMismatch: true,
          adjustmentDirection: 'increase',
          adjustmentMagnitude: 0.05,
          weightBefore: 1.0,
          weightAfter: 1.05,
          reason: 'test',
          createdAt: new Date().toISOString(),
        });
      }

      const result = engine.reflect();
      const finBlindSpot = result.blindSpots.find(bs => bs.category === 'financial');
      expect(finBlindSpot).toBeDefined();
      expect(finBlindSpot!.confidence).toBe(0.2);
    });
  });

  describe('growth assessment', () => {
    it('reports stagnating growth on first reflection with no beliefs', () => {
      const result = engine.reflect();
      expect(result.growth.direction).toBe('stagnating');
      expect(result.growth.overallDelta).toBe(0);
    });

    it('reports growing when beliefs have high confidence on first reflection', () => {
      seedBelief(store, 'communication', {
        calibration: 0.8,
      });
      seedBelief(store, 'scheduling', {
        calibration: 0.7,
      });

      const result = engine.reflect();
      expect(result.growth.direction).toBe('growing');
      expect(result.growth.overallDelta).toBeGreaterThan(0.3);
    });

    it('detects improvement between reflections', () => {
      // First reflection with low confidence
      seedBelief(store, 'communication', { calibration: 0.2 });
      const first = engine.reflect();
      expect(first.blindSpots.find(bs => bs.category === 'communication')).toBeDefined();

      // Update belief to high confidence
      seedBelief(store, 'communication', { calibration: 0.8 });

      // Second reflection should detect improvement
      const second = engine.reflect();
      expect(second.growth.categoriesImproved).toContain('communication');
    });

    it('detects decline between reflections', () => {
      // First reflection with high confidence
      seedBelief(store, 'scheduling', { calibration: 0.9 });
      engine.reflect();

      // Decline confidence
      seedBelief(store, 'scheduling', { calibration: 0.3 });

      // Second reflection should detect decline
      const second = engine.reflect();
      expect(second.growth.categoriesDeclined).toContain('scheduling');
    });
  });

  describe('reflection token creation', () => {
    it('creates a memory token from reflection', () => {
      const result = engine.reflect();
      expect(result.tokenId).not.toBeNull();

      const token = store.getMemoryToken(result.tokenId!);
      expect(token).toBeDefined();
      expect(token!.type).toBe('reflection');
      expect(token!.strength).toBe(0.7);
    });
  });

  describe('internal narrative', () => {
    it('includes blind spot information in narrative', () => {
      const result = engine.reflect();
      expect(result.internalNarrative).toContain('blind spot');
      expect(result.internalNarrative).toContain('Self-reflection');
    });

    it('includes growth direction in narrative', () => {
      seedBelief(store, 'communication', { calibration: 0.8 });
      seedBelief(store, 'scheduling', { calibration: 0.7 });
      const result = engine.reflect();
      expect(result.internalNarrative).toContain('growing');
    });
  });

  describe('auto-reflect trigger', () => {
    it('does not trigger before minimum maintenance passes', () => {
      expect(engine.shouldAutoReflect()).toBe(false);
    });

    it('triggers after sufficient maintenance passes with no prior reflection', () => {
      for (let i = 0; i < 10; i++) {
        engine.tickMaintenance();
      }
      expect(engine.shouldAutoReflect()).toBe(true);
    });

    it('resets maintenance counter after reflection', () => {
      for (let i = 0; i < 10; i++) {
        engine.tickMaintenance();
      }
      engine.reflect();
      expect(engine.getMaintenancePassCount()).toBe(0);
      expect(engine.shouldAutoReflect()).toBe(false);
    });
  });

  describe('persistence', () => {
    it('saves and retrieves reflections', () => {
      const result = engine.reflect();
      const saved = store.getLatestReflection();
      expect(saved).not.toBeNull();
      expect(saved!.id).toBe(result.id);
      expect(saved!.blindSpots.length).toBe(result.blindSpots.length);
      expect(saved!.growth.direction).toBe(result.growth.direction);
    });

    it('lists multiple reflections in order', () => {
      engine.reflect();
      engine.reflect();
      engine.reflect();

      const list = store.listReflections(10);
      expect(list.length).toBe(3);
      // Most recent first
      expect(new Date(list[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(list[1].createdAt).getTime()
      );
    });
  });

  describe('emotional summary', () => {
    it('includes emotional summary in reflection', () => {
      const result = engine.reflect();
      expect(result.emotionalSummary).toBeDefined();
      expect(result.emotionalSummary.length).toBeGreaterThan(0);
    });
  });
});
