/**
 * Tests for the AwarenessCore — Self-Knowledge Engine.
 *
 * Proves the system accurately knows what it knows:
 * - Trust level classification (reliable, building, volatile, insufficient)
 * - Stability index computation
 * - Calibration scoring (confidence vs accuracy)
 * - Trend direction detection
 * - Narrative generation (template-based, SENTINEL annotations)
 * - Full report generation with alerts and SENTINEL tracking
 */

import { Database, SparkStore } from '@ai-operations/ops-storage';
import type { SparkCategory, LearningEpisode } from '@ai-operations/shared-types';
import { AwarenessCore } from '../awareness-core';
import { buildAllDefaultWeights } from '../constants';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-awareness-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `awareness-test-${dbCounter}.db`);
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

// ── AwarenessCore ───────────────────────────────────────────────

describe('AwarenessCore', () => {
  let db: Database;
  let store: SparkStore;
  let awareness: AwarenessCore;

  beforeEach(() => {
    const setup = createTestStore();
    db = setup.db;
    store = setup.store;
    initWeights(store);
    awareness = new AwarenessCore(store);
  });

  afterEach(() => {
    db.close();
  });

  // ── Trust classification ──────────────────────────────────────

  describe('trust classification', () => {
    it('returns insufficient with 0 episodes', () => {
      const belief = awareness.assess('readonly');

      expect(belief.trustLevel).toBe('insufficient');
      expect(belief.category).toBe('readonly');
    });

    it('returns insufficient with fewer than 3 episodes', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 2; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('communication');

      expect(belief.trustLevel).toBe('insufficient');
    });

    it('returns building with 5 episodes', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 5; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            outcomeMismatch: false,
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('communication');

      expect(belief.trustLevel).toBe('building');
    });

    it('returns reliable with 20+ episodes, high accuracy, low variance', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 25; i++) {
        episodes.push(
          makeEpisode({
            category: 'readonly',
            outcomeMismatch: false,
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('readonly');

      expect(belief.trustLevel).toBe('reliable');
    });

    it('returns volatile with high variance adjustments', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      // Use extreme magnitude swings to produce high stddev > 0.6 * MAX_DEVIATION
      for (let i = 0; i < 10; i++) {
        episodes.push(
          makeEpisode({
            category: 'scheduling',
            adjustmentDirection: i % 2 === 0 ? 'increase' : 'decrease',
            adjustmentMagnitude: i % 2 === 0 ? 0.6 : 0.01,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('scheduling');

      expect(belief.trustLevel).toBe('volatile');
    });
  });

  // ── Stability index ──────────────────────────────────────────

  describe('stability index', () => {
    it('returns 1.0 with no adjustments', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 5; i++) {
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
      const belief = awareness.assess('readonly');

      expect(belief.stability).toBeCloseTo(1.0, 1);
    });

    it('returns low stability with large varying magnitudes', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      // Extreme swings: stddev will be ~0.295 → normalized ~0.98 → stability ~0.02
      const magnitudes = [0.01, 0.6, 0.01, 0.6, 0.01, 0.6, 0.01, 0.6, 0.01, 0.6];
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < magnitudes.length; i++) {
        episodes.push(
          makeEpisode({
            category: 'general',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: magnitudes[i],
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('general');

      expect(belief.stability).toBeLessThan(0.5);
    });
  });

  // ── Calibration ──────────────────────────────────────────────

  describe('calibration', () => {
    it('high calibration when confidence matches accuracy', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      // 10 episodes, all correct (accuracy = 1.0)
      // expectedConfidence = 10/(10+10) = 0.5
      // calibration = 1.0 - |0.5 - 1.0| = 0.5
      for (let i = 0; i < 10; i++) {
        episodes.push(
          makeEpisode({
            category: 'communication',
            outcomeMismatch: false,
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('communication');

      // calibration = 1.0 - |0.5 - 1.0| = 0.5
      expect(belief.calibration).toBeCloseTo(0.5, 1);
    });

    it('calibration approaches 1.0 with many accurate episodes', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      // 50 episodes, all correct (accuracy = 1.0)
      // expectedConfidence = 50/(50+10) = 0.833
      // calibration = 1.0 - |0.833 - 1.0| = 0.833
      for (let i = 0; i < 50; i++) {
        episodes.push(
          makeEpisode({
            category: 'readonly',
            outcomeMismatch: false,
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('readonly');

      expect(belief.calibration).toBeGreaterThan(0.8);
    });
  });

  // ── Trend detection ──────────────────────────────────────────

  describe('trend detection', () => {
    it('detects stable when all directions are none', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 10; i++) {
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
      const belief = awareness.assess('readonly');

      expect(belief.evidence.recentTrend).toBe('stable');
    });

    it('detects improving when mostly decreasing', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 10; i++) {
        episodes.push(
          makeEpisode({
            category: 'scheduling',
            adjustmentDirection: i < 8 ? 'decrease' : 'none',
            adjustmentMagnitude: i < 8 ? 0.05 : 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('scheduling');

      expect(belief.evidence.recentTrend).toBe('improving');
    });

    it('detects oscillating with alternating directions', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 10; i++) {
        episodes.push(
          makeEpisode({
            category: 'publication',
            adjustmentDirection: i % 2 === 0 ? 'increase' : 'decrease',
            adjustmentMagnitude: 0.1,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('publication');

      expect(belief.evidence.recentTrend).toBe('oscillating');
    });
  });

  // ── Narrative generation ─────────────────────────────────────

  describe('narrative generation', () => {
    it('produces readable narrative for reliable category', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 25; i++) {
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
      const belief = awareness.assess('readonly');

      expect(belief.narrative).toBeDefined();
      expect(belief.narrative.length).toBeGreaterThan(0);
      // Should contain the category name
      expect(belief.narrative.toLowerCase()).toContain('readonly');
      // Should contain accuracy percentage
      expect(belief.narrative).toContain('100%');
    });

    it('includes SENTINEL note for destructive category', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 5; i++) {
        episodes.push(
          makeEpisode({
            category: 'destructive',
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);
      const belief = awareness.assess('destructive');

      expect(belief.narrative).toBeDefined();
      expect(belief.narrative).toContain('SENTINEL');
    });
  });

  // ── Full report ──────────────────────────────────────────────

  describe('full report', () => {
    it('generates report with all 7 categories', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');

      // Seed a few episodes for some categories
      const commEpisodes: LearningEpisode[] = [];
      for (let i = 0; i < 3; i++) {
        commEpisodes.push(
          makeEpisode({
            category: 'communication',
            adjustmentDirection: 'none',
            adjustmentMagnitude: 0,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }
      seedEpisodes(store, commEpisodes);

      const report = awareness.report();

      expect(Object.keys(report.beliefs).length).toBe(7);
      const expectedCategories: SparkCategory[] = [
        'communication',
        'publication',
        'destructive',
        'scheduling',
        'financial',
        'readonly',
        'general',
      ];
      for (const cat of expectedCategories) {
        expect(report.beliefs[cat]).toBeDefined();
        expect(report.beliefs[cat].category).toBe(cat);
      }
    });

    it('populates alerts for elevated SENTINEL categories', () => {
      const baseTime = new Date('2025-01-01T00:00:00Z');
      const episodes: LearningEpisode[] = [];

      for (let i = 0; i < 5; i++) {
        episodes.push(
          makeEpisode({
            category: 'financial',
            adjustmentDirection: 'increase',
            adjustmentMagnitude: 0.05,
            createdAt: new Date(baseTime.getTime() + i * 60000).toISOString(),
          }),
        );
      }

      seedEpisodes(store, episodes);

      // Push weight above base (1.0) to trigger sentinelActive
      const weight = store.getWeight('financial')!;
      store.saveWeight({ ...weight, currentWeight: 1.1 });

      const report = awareness.report();

      expect(report.alerts.sentinelActive).toContain('financial');
    });
  });
});
