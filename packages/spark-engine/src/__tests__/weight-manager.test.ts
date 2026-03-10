/**
 * Tests for the WeightManager class.
 *
 * Verifies that:
 * - Default weights are seeded correctly for all 7 categories
 * - Initialization is idempotent (safe to call multiple times)
 * - SENTINEL categories have lowerBound = baseWeight
 * - getMultiplier returns correct values for initialized/uninitialized categories
 * - getAllWeights returns complete weight state
 * - Snapshot/rollback preserves and restores system state
 */

import { Database } from '@ai-ops/ops-storage';
import { SparkStore } from '@ai-ops/ops-storage';
import type { SparkCategory, SparkWeightEntry } from '@ai-ops/shared-types';
import { SENTINEL_CATEGORIES } from '@ai-ops/shared-types';
import { WeightManager } from '../weight-manager';
import { ALL_CATEGORIES, buildDefaultWeight } from '../constants';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-weight-mgr-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `weight-mgr-test-${dbCounter}.db`);
}

function createTestStore(): { db: Database; store: SparkStore } {
  const db = new Database(freshDbPath());
  const store = new SparkStore(db.db);
  return { db, store };
}

// ── WeightManager ────────────────────────────────────────────────

describe('WeightManager', () => {
  let db: Database;
  let store: SparkStore;
  let manager: WeightManager;

  beforeEach(() => {
    const setup = createTestStore();
    db = setup.db;
    store = setup.store;
    manager = new WeightManager(store);
  });

  afterEach(() => {
    db.close();
  });

  describe('initialize', () => {
    it('seeds default weights for all 7 categories', () => {
      manager.initialize();

      const allWeights = store.getAllWeights();
      expect(allWeights).toHaveLength(ALL_CATEGORIES.length);

      const categories = allWeights.map((w) => w.category);
      for (const cat of ALL_CATEGORIES) {
        expect(categories).toContain(cat);
      }
    });

    it('safe to call multiple times (idempotent)', () => {
      manager.initialize();
      manager.initialize();
      manager.initialize();

      const allWeights = store.getAllWeights();
      expect(allWeights).toHaveLength(ALL_CATEGORIES.length);

      // All weights should still be at their defaults
      for (const w of allWeights) {
        expect(w.currentWeight).toBe(w.baseWeight);
      }
    });

    it('SENTINEL categories have lowerBound = baseWeight', () => {
      manager.initialize();

      for (const sentinel of SENTINEL_CATEGORIES) {
        const weight = store.getWeight(sentinel);
        expect(weight).toBeDefined();
        // SENTINEL categories: their lower bound equals base weight (1.0)
        // This means the system can only become MORE cautious, never less
        expect(weight!.lowerBound).toBe(weight!.baseWeight);
      }
    });

    it('non-SENTINEL categories have lowerBound < baseWeight', () => {
      manager.initialize();

      const nonSentinel: SparkCategory[] = ALL_CATEGORIES.filter(
        (c) => !(SENTINEL_CATEGORIES as readonly string[]).includes(c),
      );

      for (const cat of nonSentinel) {
        const weight = store.getWeight(cat);
        expect(weight).toBeDefined();
        // Non-SENTINEL categories can decrease below base weight
        expect(weight!.lowerBound).toBeLessThan(weight!.baseWeight);
      }
    });
  });

  describe('getMultiplier', () => {
    it('returns 1.0 for uninitialized category', () => {
      // Before initialization, getMultiplier should return a safe default
      const multiplier = manager.getMultiplier('communication');
      expect(multiplier).toBe(1.0);
    });

    it('returns current weight for initialized category', () => {
      manager.initialize();

      // Manually set a weight to verify the multiplier reflects it
      const weight = store.getWeight('communication')!;
      store.saveWeight({ ...weight, currentWeight: 1.15 });

      const multiplier = manager.getMultiplier('communication');
      expect(multiplier).toBe(1.15);
    });

    it('returns correct weight for each category after initialization', () => {
      manager.initialize();

      for (const cat of ALL_CATEGORIES) {
        const multiplier = manager.getMultiplier(cat);
        const expected = buildDefaultWeight(cat).currentWeight;
        expect(multiplier).toBe(expected);
      }
    });
  });

  describe('getAllWeights', () => {
    it('returns all categories with defaults for missing', () => {
      manager.initialize();

      const result = manager.getAllWeights();
      const entries = Object.values(result.weights);

      expect(entries).toHaveLength(ALL_CATEGORIES.length);

      // All default weights should be 1.0
      for (const w of entries) {
        expect(w.baseWeight).toBe(1.0);
        expect(w.currentWeight).toBe(1.0);
        expect(w.episodeCount).toBe(0);
      }
    });

    it('returns updated weights after modification', () => {
      manager.initialize();

      // Update one weight
      const commWeight = store.getWeight('communication')!;
      store.saveWeight({ ...commWeight, currentWeight: 1.1, episodeCount: 5 });

      const result = manager.getAllWeights();
      const comm = result.weights['communication'];
      expect(comm).toBeDefined();
      expect(comm.currentWeight).toBe(1.1);
      expect(comm.episodeCount).toBe(5);
    });
  });

  describe('snapshot/rollback', () => {
    it('creates snapshot of current weights', () => {
      manager.initialize();

      // Modify some weights
      const commWeight = store.getWeight('communication')!;
      store.saveWeight({ ...commWeight, currentWeight: 1.2 });

      const snapshotId = manager.createSnapshot('test snapshot');
      expect(snapshotId).toBeDefined();
      expect(typeof snapshotId).toBe('string');

      // Verify snapshot appears in listing
      const snapshots = store.listSnapshots();
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
      expect(snapshots.some((s) => s.id === snapshotId)).toBe(true);
    });

    it('restores weights from snapshot', () => {
      manager.initialize();

      // Record initial state
      const snapshotId = manager.createSnapshot('before changes');

      // Modify weights
      const commWeight = store.getWeight('communication')!;
      store.saveWeight({ ...commWeight, currentWeight: 1.25 });

      const finWeight = store.getWeight('financial')!;
      store.saveWeight({ ...finWeight, currentWeight: 1.15 });

      // Verify weights changed
      expect(store.getWeight('communication')!.currentWeight).toBe(1.25);
      expect(store.getWeight('financial')!.currentWeight).toBe(1.15);

      // Rollback to snapshot
      manager.restoreSnapshot(snapshotId);

      // Verify weights are restored
      expect(store.getWeight('communication')!.currentWeight).toBe(1.0);
      expect(store.getWeight('financial')!.currentWeight).toBe(1.0);
    });

    it('rollback to unknown snapshot throws error', () => {
      manager.initialize();

      expect(() => {
        manager.restoreSnapshot('non-existent-snapshot-id');
      }).toThrow();
    });

    it('multiple snapshots are independent', () => {
      manager.initialize();

      // Snapshot 1: all defaults
      const snap1 = manager.createSnapshot('snapshot 1');

      // Change communication weight
      const commWeight = store.getWeight('communication')!;
      store.saveWeight({ ...commWeight, currentWeight: 1.2 });

      // Snapshot 2: communication at 1.2
      const snap2 = manager.createSnapshot('snapshot 2');

      // Change further
      store.saveWeight({
        ...store.getWeight('communication')!,
        currentWeight: 1.3,
      });

      // Rollback to snap2 should give communication=1.2
      manager.restoreSnapshot(snap2);
      expect(store.getWeight('communication')!.currentWeight).toBe(1.2);

      // Rollback to snap1 should give communication=1.0
      manager.restoreSnapshot(snap1);
      expect(store.getWeight('communication')!.currentWeight).toBe(1.0);
    });
  });
});
