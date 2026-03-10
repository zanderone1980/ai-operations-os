/**
 * Tests for the MemoryCore — Memory Consolidation Engine.
 *
 * Proves the system detects meaningful patterns:
 * - Streak detection (3+ consecutive same-direction adjustments)
 * - Oscillation detection (alternating increase/decrease)
 * - Convergence detection (magnitudes decreasing over time)
 * - Anomaly detection (sudden large adjustment after stability)
 * - Milestone detection (episode count thresholds)
 * - Impact scoring (magnitude, mismatch, SENTINEL weighting)
 * - Integration (empty results, persistence)
 */

import { Database, SparkStore } from '@ai-operations/ops-storage';
import type { LearningEpisode, SparkCategory } from '@ai-operations/shared-types';
import { MemoryCore } from '../memory-core';
import { buildAllDefaultWeights } from '../constants';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-memory-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `memory-test-${dbCounter}.db`);
}

function createTestStore(): { db: Database; store: SparkStore } {
  const db = new Database(freshDbPath());
  const store = new SparkStore(db.db);
  return { db, store };
}

function initWeights(store: SparkStore): void {
  store.initializeWeights(buildAllDefaultWeights());
}

function makeEpisode(overrides: Partial<LearningEpisode> = {}): LearningEpisode {
  return {
    id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    predictionId: 'pred-1',
    outcomeId: 'out-1',
    category: 'communication',
    scoreDelta: 0,
    outcomeMismatch: false,
    adjustmentDirection: 'none',
    adjustmentMagnitude: 0,
    weightBefore: 1.0,
    weightAfter: 1.0,
    reason: 'test episode',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function seedEpisodes(store: SparkStore, episodes: LearningEpisode[]): void {
  for (const ep of episodes) {
    store.saveEpisode(ep);
  }
  // Update weight episode count
  const categories = new Set(episodes.map(e => e.category));
  for (const cat of categories) {
    const count = episodes.filter(e => e.category === cat).length;
    const weight = store.getWeight(cat as SparkCategory);
    if (weight) {
      store.saveWeight({ ...weight, episodeCount: weight.episodeCount + count });
    }
  }
}

// ── MemoryCore ──────────────────────────────────────────────────

describe('MemoryCore', () => {
  let db: Database;
  let store: SparkStore;
  let memory: MemoryCore;

  beforeEach(() => {
    const setup = createTestStore();
    db = setup.db;
    store = setup.store;
    initWeights(store);
    memory = new MemoryCore(store);
  });

  afterEach(() => {
    db.close();
  });

  // ── Streak detection ──────────────────────────────────────────

  describe('streak detection', () => {
    it('detects 3+ consecutive increases', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 4; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: 0.1,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);
      const streakInsight = insights.find(ins => ins.pattern === 'streak');

      expect(streakInsight).toBeDefined();
      expect(streakInsight!.category).toBe('communication');
    });

    it('does not detect streak with mixed directions', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const directions: Array<'increase' | 'decrease'> = [
        'increase',
        'decrease',
        'increase',
        'decrease',
      ];
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < directions.length; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: directions[i],
            adjustmentMagnitude: 0.1,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);
      const streakInsight = insights.find(ins => ins.pattern === 'streak');

      expect(streakInsight).toBeUndefined();
    });

    it('streak length matches actual consecutive count', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 5; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: 0.1,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);
      const streakInsight = insights.find(ins => ins.pattern === 'streak');

      expect(streakInsight).toBeDefined();
      expect(streakInsight!.summary).toContain('5');
    });
  });

  // ── Oscillation detection ────────────────────────────────────

  describe('oscillation detection', () => {
    it('detects alternating increase/decrease pattern', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const directions: Array<'increase' | 'decrease'> = [
        'increase',
        'decrease',
        'increase',
        'decrease',
        'increase',
      ];
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < directions.length; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: directions[i],
            adjustmentMagnitude: 0.1,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);
      const oscillationInsight = insights.find(ins => ins.pattern === 'oscillation');

      expect(oscillationInsight).toBeDefined();
      expect(oscillationInsight!.category).toBe('communication');
    });

    it('does not detect oscillation with consistent direction', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 5; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: 0.1,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);
      const oscillationInsight = insights.find(ins => ins.pattern === 'oscillation');

      expect(oscillationInsight).toBeUndefined();
    });
  });

  // ── Convergence detection ────────────────────────────────────

  describe('convergence detection', () => {
    it('detects decreasing magnitudes', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const magnitudes = [0.5, 0.4, 0.3, 0.2, 0.15, 0.1];
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < magnitudes.length; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: magnitudes[i],
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);
      const convergenceInsight = insights.find(ins => ins.pattern === 'convergence');

      expect(convergenceInsight).toBeDefined();
      expect(convergenceInsight!.category).toBe('communication');
    });

    it('does not detect convergence with increasing magnitudes', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const magnitudes = [0.1, 0.2, 0.3, 0.4, 0.5];
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < magnitudes.length; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: magnitudes[i],
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);
      const convergenceInsight = insights.find(ins => ins.pattern === 'convergence');

      expect(convergenceInsight).toBeUndefined();
    });
  });

  // ── Anomaly detection ────────────────────────────────────────

  describe('anomaly detection', () => {
    it('detects sudden large magnitude after stability', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      // 10 stable episodes with small magnitude
      for (let i = 0; i < 10; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: 0.05,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      // 1 anomalous episode with large magnitude
      const anomalousEpisode = makeEpisode({
        category: 'communication',
        adjustmentDirection: 'increase',
        adjustmentMagnitude: 0.5,
        createdAt: new Date(baseTime.getTime() + 10 * 60000).toISOString(),
      });
      episodes.push(anomalousEpisode);

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(anomalousEpisode);
      const anomalyInsight = insights.find(ins => ins.pattern === 'anomaly');

      expect(anomalyInsight).toBeDefined();
      expect(anomalyInsight!.category).toBe('communication');
    });

    it('no anomaly with consistent magnitudes', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      // 10 stable episodes with small magnitude
      for (let i = 0; i < 10; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: 0.05,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      // 1 episode with only slightly higher magnitude (not anomalous)
      const normalEpisode = makeEpisode({
        category: 'communication',
        adjustmentDirection: 'increase',
        adjustmentMagnitude: 0.06,
        createdAt: new Date(baseTime.getTime() + 10 * 60000).toISOString(),
      });
      episodes.push(normalEpisode);

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(normalEpisode);
      const anomalyInsight = insights.find(ins => ins.pattern === 'anomaly');

      expect(anomalyInsight).toBeUndefined();
    });
  });

  // ── Milestone detection ──────────────────────────────────────

  describe('milestone detection', () => {
    it('detects milestone at exactly 10 episodes', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      // Seed 9 episodes first
      for (let i = 0; i < 9; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      // Save the 9 episodes and set weight episodeCount to 10
      // (In real flow, LearningCore.learn() increments count BEFORE consolidate() is called)
      for (const ep of episodes) {
        store.saveEpisode(ep);
      }
      const weight = store.getWeight('communication')!;
      store.saveWeight({ ...weight, episodeCount: 10 });

      // Add the 10th episode
      const tenthEpisode = makeEpisode({
        category: 'communication',
        adjustmentDirection: 'none',
        adjustmentMagnitude: 0,
        createdAt: new Date(baseTime.getTime() + 9 * 60000).toISOString(),
      });
      store.saveEpisode(tenthEpisode);

      const insights = memory.consolidate(tenthEpisode);
      const milestoneInsight = insights.find(ins => ins.pattern === 'milestone');

      expect(milestoneInsight).toBeDefined();
      expect(milestoneInsight!.category).toBe('communication');
    });

    it('does not trigger milestone at 11', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      // Seed 10 episodes
      for (let i = 0; i < 10; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      for (const ep of episodes) {
        store.saveEpisode(ep);
      }
      const weight = store.getWeight('communication')!;
      // In real flow, LearningCore.learn() increments to 11 BEFORE consolidate()
      store.saveWeight({ ...weight, episodeCount: 11 });

      // Add the 11th episode
      const eleventhEpisode = makeEpisode({
        category: 'communication',
        adjustmentDirection: 'none',
        adjustmentMagnitude: 0,
        createdAt: new Date(baseTime.getTime() + 10 * 60000).toISOString(),
      });
      store.saveEpisode(eleventhEpisode);

      const insights = memory.consolidate(eleventhEpisode);
      const milestoneInsight = insights.find(ins => ins.pattern === 'milestone');

      expect(milestoneInsight).toBeUndefined();
    });
  });

  // ── Impact scoring ───────────────────────────────────────────

  describe('impact scoring', () => {
    it('scales with magnitude', () => {
      const lowMagEpisode = makeEpisode({
        adjustmentMagnitude: 0.05,
        outcomeMismatch: false,
        category: 'communication',
      });

      const highMagEpisode = makeEpisode({
        adjustmentMagnitude: 0.2,
        outcomeMismatch: false,
        category: 'communication',
      });

      const lowImpact = memory.computeImpactScore(lowMagEpisode);
      const highImpact = memory.computeImpactScore(highMagEpisode);

      expect(highImpact).toBeGreaterThan(lowImpact);
    });

    it('boosts for mismatch', () => {
      const noMismatch = makeEpisode({
        adjustmentMagnitude: 0.1,
        outcomeMismatch: false,
        category: 'communication',
      });

      const withMismatch = makeEpisode({
        adjustmentMagnitude: 0.1,
        outcomeMismatch: true,
        category: 'communication',
      });

      const noMismatchImpact = memory.computeImpactScore(noMismatch);
      const mismatchImpact = memory.computeImpactScore(withMismatch);

      expect(mismatchImpact).toBeGreaterThan(noMismatchImpact);
    });

    it('boosts for SENTINEL category', () => {
      const normalEpisode = makeEpisode({
        adjustmentMagnitude: 0.1,
        outcomeMismatch: false,
        category: 'communication',
      });

      const sentinelEpisode = makeEpisode({
        adjustmentMagnitude: 0.1,
        outcomeMismatch: false,
        category: 'destructive',
      });

      const normalImpact = memory.computeImpactScore(normalEpisode);
      const sentinelImpact = memory.computeImpactScore(sentinelEpisode);

      expect(sentinelImpact).toBeGreaterThan(normalImpact);
    });
  });

  // ── Integration ──────────────────────────────────────────────

  describe('integration', () => {
    it('returns empty array when no patterns detected', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 2; i++) {
        episodes.push(
          makeEpisode({
            category: 'readonly',
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);

      expect(insights).toEqual([]);
    });

    it('persists insights to store', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      // Seed a streak to trigger an insight
      for (let i = 0; i < 4; i++) {
        episodes.push(
          makeEpisode({
            category: 'general',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: 0.1,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const insights = memory.consolidate(episodes[episodes.length - 1]);

      expect(insights.length).toBeGreaterThan(0);

      // Verify insight was persisted to the store
      const storedInsights = store.listInsights({ category: 'general' });
      expect(storedInsights.length).toBeGreaterThanOrEqual(1);

      const storedInsight = store.getInsight(insights[0].id);
      expect(storedInsight).toBeDefined();
      expect(storedInsight!.pattern).toBe(insights[0].pattern);
      expect(storedInsight!.category).toBe('general');
    });
  });
});
