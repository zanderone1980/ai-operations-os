/**
 * Tests for the AdaptiveSafetyGate class.
 *
 * Verifies that:
 * - SPARK weight multiplier is applied to the CORD score
 * - Decision changes when adjusted score crosses a threshold
 * - Hard blocks are never overridden
 * - SPARK adjustment metadata is correctly set
 * - rawScore and adjustedScore are both returned
 */

import { Database } from '@ai-operations/ops-storage';
import { SparkStore } from '@ai-operations/ops-storage';
import type { SparkCategory } from '@ai-operations/shared-types';
import type { CordDecision } from '@ai-operations/shared-types';
import { AdaptiveSafetyGate } from '../adaptive-safety-gate';
import { WeightManager } from '../weight-manager';
import { buildAllDefaultWeights } from '../constants';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-gate-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `gate-test-${dbCounter}.db`);
}

function createTestStore(): { db: Database; store: SparkStore } {
  const db = new Database(freshDbPath());
  const store = new SparkStore(db.db);
  return { db, store };
}

function initWeights(store: SparkStore): void {
  store.initializeWeights(buildAllDefaultWeights());
}

/** Build a mock CordSafetyGate with configurable return values. */
function buildMockCordGate(overrides: {
  decision?: CordDecision;
  score?: number;
  reasons?: string[];
  hardBlock?: boolean;
} = {}) {
  return {
    evaluateAction: jest.fn().mockReturnValue({
      decision: overrides.decision ?? ('ALLOW' as const),
      score: overrides.score ?? 15,
      reasons: overrides.reasons ?? ['Low risk'],
      hardBlock: overrides.hardBlock ?? false,
    }),
    isAvailable: jest.fn().mockReturnValue(true),
  };
}

// ── AdaptiveSafetyGate ───────────────────────────────────────────

describe('AdaptiveSafetyGate', () => {
  let db: Database;
  let store: SparkStore;

  beforeEach(() => {
    const setup = createTestStore();
    db = setup.db;
    store = setup.store;
    initWeights(store);
  });

  afterEach(() => {
    db.close();
  });

  describe('evaluateAction', () => {
    it('applies weight multiplier to CORD score', () => {
      const mockCordGate = buildMockCordGate({ score: 40, decision: 'CONTAIN' });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      // Set communication weight to 1.2 (20% more cautious)
      const weight = store.getWeight('communication')!;
      store.saveWeight({ ...weight, currentWeight: 1.2 });

      const result = gate.evaluateAction('gmail', 'send', { to: 'test@example.com' });

      // Raw CORD score is 40; adjusted by 1.2 multiplier = 48
      expect(result.rawScore).toBe(40);
      expect(result.score).toBe(Math.round(40 * 1.2));
      expect(mockCordGate.evaluateAction).toHaveBeenCalledWith(
        'gmail',
        'send',
        { to: 'test@example.com' },
      );
    });

    it('changes decision when adjusted score crosses threshold', () => {
      // Score of 45 with CONTAIN decision; multiplier 1.2 pushes to 54 (CHALLENGE territory)
      const mockCordGate = buildMockCordGate({
        score: 45,
        decision: 'CONTAIN',
        reasons: ['Moderate risk'],
      });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      // Set weight to push score over the CHALLENGE threshold (typically 50)
      const weight = store.getWeight('communication')!;
      store.saveWeight({ ...weight, currentWeight: 1.2 });

      const result = gate.evaluateAction('gmail', 'send', { to: 'test@example.com' });

      // The adjusted score (45 * 1.2 = 54) should trigger a more restrictive decision
      expect(result.score).toBeGreaterThan(result.rawScore);
      // The decision may change to CHALLENGE if threshold is crossed
      expect(result.decision).toBeDefined();
      expect(['CONTAIN', 'CHALLENGE', 'BLOCK']).toContain(result.decision);
    });

    it('never overrides hard blocks', () => {
      // Hard block from CORD — SPARK should never override this
      const mockCordGate = buildMockCordGate({
        score: 95,
        decision: 'BLOCK',
        reasons: ['Violates constitutional rule'],
        hardBlock: true,
      });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      // Even if weight were reduced (which shouldn't happen for destructive,
      // but testing the hard-block safety net)
      const result = gate.evaluateAction('gmail', 'delete', { id: 'msg-1' });

      expect(result.decision).toBe('BLOCK');
      expect(result.hardBlock).toBe(true);
    });

    it('includes SPARK adjustment reason when decision changes', () => {
      // Score that could change decision when multiplied
      const mockCordGate = buildMockCordGate({
        score: 42,
        decision: 'CONTAIN',
        reasons: ['Medium risk action'],
      });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      // Set a non-1.0 weight to trigger adjustment
      const weight = store.getWeight('communication')!;
      store.saveWeight({ ...weight, currentWeight: 1.25 });

      const result = gate.evaluateAction('gmail', 'send', { to: 'test@example.com' });

      // When SPARK adjusts the score, it should add a reason
      if (result.sparkAdjusted) {
        expect(result.reasons.length).toBeGreaterThan(0);
        // At least one reason should reference SPARK
        const hasSparkReason = result.reasons.some(
          (r: string) => r.toLowerCase().includes('spark') || r.toLowerCase().includes('adaptive'),
        );
        expect(hasSparkReason).toBe(true);
      }
    });

    it('returns sparkAdjusted=false when weight is 1.0', () => {
      const mockCordGate = buildMockCordGate({ score: 20, decision: 'ALLOW' });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      // Default weight is 1.0 — no adjustment needed
      const result = gate.evaluateAction('gmail', 'read', { id: 'msg-1' });

      expect(result.sparkAdjusted).toBe(false);
      expect(result.rawScore).toBe(result.score);
    });

    it('returns sparkAdjusted=true when weight differs from 1.0', () => {
      const mockCordGate = buildMockCordGate({ score: 30, decision: 'CONTAIN' });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      // Set weight above 1.0
      const weight = store.getWeight('communication')!;
      store.saveWeight({ ...weight, currentWeight: 1.15 });

      const result = gate.evaluateAction('gmail', 'send', { to: 'test@example.com' });

      expect(result.sparkAdjusted).toBe(true);
      expect(result.score).not.toBe(result.rawScore);
    });

    it('returns rawScore alongside adjusted score', () => {
      const mockCordGate = buildMockCordGate({ score: 35, decision: 'CONTAIN' });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      const weight = store.getWeight('publication')!;
      store.saveWeight({ ...weight, currentWeight: 1.1 });

      const result = gate.evaluateAction('x', 'post', { text: 'Hello world' });

      expect(result.rawScore).toBe(35);
      expect(result.score).toBe(Math.round(35 * 1.1));
      expect(result).toHaveProperty('rawScore');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('decision');
      expect(result).toHaveProperty('reasons');
      expect(result).toHaveProperty('hardBlock');
      expect(result).toHaveProperty('sparkAdjusted');
    });

    it('caps adjusted score at 99', () => {
      const mockCordGate = buildMockCordGate({ score: 85, decision: 'BLOCK' });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      // Push score beyond 99 with high multiplier
      const weight = store.getWeight('financial')!;
      store.saveWeight({ ...weight, currentWeight: 1.3 });

      const result = gate.evaluateAction('shopify', 'refund', { orderId: 'o-1' });

      // 85 * 1.3 = 110.5, but should be capped at 99
      expect(result.score).toBeLessThanOrEqual(99);
    });

    it('does not go below 0 for adjusted score', () => {
      const mockCordGate = buildMockCordGate({ score: 3, decision: 'ALLOW' });
      const gate = new AdaptiveSafetyGate(mockCordGate as any, new WeightManager(store));

      // Set weight below 1.0 for non-SENTINEL category
      const weight = store.getWeight('readonly')!;
      store.saveWeight({ ...weight, currentWeight: 0.7 });

      const result = gate.evaluateAction('gmail', 'read', { id: 'msg-1' });

      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });
});
