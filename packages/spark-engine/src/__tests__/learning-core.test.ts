/**
 * Tests for the LearningCore class — the most critical component of SPARK.
 *
 * Proves the system actually learns:
 * - Weight increases when CORD was too permissive (ALLOW + failure)
 * - Weight decreases when CORD was too cautious (CHALLENGE + approved + success)
 * - No change when assessment is correct
 * - SENTINEL categories maintain constitutional bounds
 * - Minimum episode threshold before learning begins
 * - EMA convergence behavior (alpha=0.1)
 */

import { Database } from '@ai-operations/ops-storage';
import { SparkStore } from '@ai-operations/ops-storage';
import type {
  Prediction,
  OutcomeSignal,
  SparkCategory,
  SparkWeightEntry,
} from '@ai-operations/shared-types';
import { LearningCore } from '../learning-core';
import {
  EMA_ALPHA,
  MAX_DEVIATION_PERCENT,
  MIN_EPISODES_BEFORE_LEARNING,
  buildAllDefaultWeights,
  buildDefaultWeight,
} from '../constants';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-learning-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `learning-test-${dbCounter}.db`);
}

function createTestStore(): { db: Database; store: SparkStore } {
  const db = new Database(freshDbPath());
  const store = new SparkStore(db.db);
  return { db, store };
}

function initWeights(store: SparkStore): void {
  store.initializeWeights(buildAllDefaultWeights());
}

/** Build a test prediction. */
function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: `pred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stepId: 'step-1',
    runId: 'run-1',
    connector: 'gmail',
    operation: 'send',
    category: 'communication',
    predictedScore: 20,
    predictedOutcome: 'success',
    confidence: 0.5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a test outcome signal. */
function makeOutcome(overrides: Partial<OutcomeSignal> = {}): OutcomeSignal {
  return {
    id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stepId: 'step-1',
    runId: 'run-1',
    actualOutcome: 'success',
    actualCordScore: 20,
    actualCordDecision: 'ALLOW',
    signals: {
      succeeded: true,
      escalated: false,
      hasError: false,
      durationMs: 200,
    },
    measuredAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Seed enough episodes to surpass MIN_EPISODES_BEFORE_LEARNING.
 * These are "neutral" episodes that do not change weight.
 */
function seedMinEpisodes(
  store: SparkStore,
  category: SparkCategory,
  count: number = MIN_EPISODES_BEFORE_LEARNING + 1,
): void {
  for (let i = 0; i < count; i++) {
    store.saveEpisode({
      id: `seed-ep-${category}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      predictionId: `seed-pred-${i}`,
      outcomeId: `seed-out-${i}`,
      category,
      scoreDelta: 0,
      outcomeMismatch: false,
      adjustmentDirection: 'none',
      adjustmentMagnitude: 0,
      weightBefore: 1.0,
      weightAfter: 1.0,
      reason: 'seed episode for minimum threshold',
      createdAt: new Date().toISOString(),
    });
  }
  // Update the weight's episode count to reflect seeded episodes
  const weight = store.getWeight(category)!;
  store.saveWeight({
    ...weight,
    episodeCount: weight.episodeCount + count,
  });
}

// ── LearningCore ─────────────────────────────────────────────────

describe('LearningCore', () => {
  let db: Database;
  let store: SparkStore;
  let core: LearningCore;

  beforeEach(() => {
    const setup = createTestStore();
    db = setup.db;
    store = setup.store;
    initWeights(store);
    core = new LearningCore(store);
  });

  afterEach(() => {
    db.close();
  });

  // ── Weight increases when CORD is too permissive ─────────────

  describe('weight increases when CORD is too permissive', () => {
    it('increases weight when ALLOW leads to failure', () => {
      const category: SparkCategory = 'communication';
      seedMinEpisodes(store, category);

      const prediction = makePrediction({
        category,
        predictedScore: 15,
        predictedOutcome: 'success',
      });
      store.savePrediction(prediction);

      const outcome = makeOutcome({
        stepId: prediction.stepId,
        runId: prediction.runId,
        actualOutcome: 'failure',
        actualCordScore: 15,
        actualCordDecision: 'ALLOW',
        signals: {
          succeeded: false,
          escalated: false,
          hasError: true,
          errorMessage: 'API error',
        },
      });
      store.saveOutcome(outcome);

      const weightBefore = store.getWeight(category)!.currentWeight;
      const episode = core.learn(prediction, outcome);
      const weightAfter = store.getWeight(category)!.currentWeight;

      expect(episode.adjustmentDirection).toBe('increase');
      expect(weightAfter).toBeGreaterThan(weightBefore);
      expect(episode.weightAfter).toBeGreaterThan(episode.weightBefore);
    });

    it('increases weight when CONTAIN leads to failure', () => {
      const category: SparkCategory = 'publication';
      seedMinEpisodes(store, category);

      const prediction = makePrediction({
        category,
        operation: 'post',
        predictedScore: 35,
        predictedOutcome: 'success',
      });
      store.savePrediction(prediction);

      const outcome = makeOutcome({
        stepId: prediction.stepId,
        runId: prediction.runId,
        actualOutcome: 'failure',
        actualCordScore: 35,
        actualCordDecision: 'CONTAIN',
        signals: {
          succeeded: false,
          escalated: false,
          hasError: true,
          errorMessage: 'Post rejected by platform',
        },
      });
      store.saveOutcome(outcome);

      const weightBefore = store.getWeight(category)!.currentWeight;
      const episode = core.learn(prediction, outcome);
      const weightAfter = store.getWeight(category)!.currentWeight;

      expect(episode.adjustmentDirection).toBe('increase');
      expect(weightAfter).toBeGreaterThan(weightBefore);
    });

    it('magnitude is proportional to how low the score was', () => {
      const category: SparkCategory = 'communication';
      seedMinEpisodes(store, category);

      // Low score failure (score=5) — should have larger magnitude
      const predLow = makePrediction({
        id: 'pred-low',
        stepId: 'step-low',
        category,
        predictedScore: 5,
      });
      store.savePrediction(predLow);

      const outLow = makeOutcome({
        id: 'out-low',
        stepId: 'step-low',
        actualOutcome: 'failure',
        actualCordScore: 5,
        actualCordDecision: 'ALLOW',
        signals: { succeeded: false, escalated: false, hasError: true },
      });
      store.saveOutcome(outLow);

      const episodeLow = core.learn(predLow, outLow);

      // Reset weight for fair comparison
      const weight = store.getWeight(category)!;
      store.saveWeight({ ...weight, currentWeight: 1.0 });

      // Higher score failure (score=40) — should have smaller magnitude
      const predHigh = makePrediction({
        id: 'pred-high',
        stepId: 'step-high',
        category,
        predictedScore: 40,
      });
      store.savePrediction(predHigh);

      const outHigh = makeOutcome({
        id: 'out-high',
        stepId: 'step-high',
        actualOutcome: 'failure',
        actualCordScore: 40,
        actualCordDecision: 'CONTAIN',
        signals: { succeeded: false, escalated: false, hasError: true },
      });
      store.saveOutcome(outHigh);

      const episodeHigh = core.learn(predHigh, outHigh);

      // A failure at score=5 (very permissive) should produce a larger adjustment
      // than a failure at score=40 (already somewhat cautious)
      expect(episodeLow.adjustmentMagnitude).toBeGreaterThanOrEqual(
        episodeHigh.adjustmentMagnitude,
      );
    });
  });

  // ── Weight decreases when CORD is too cautious ──────────────

  describe('weight decreases when CORD is too cautious', () => {
    it('decreases weight when CHALLENGE + approval + success', () => {
      const category: SparkCategory = 'communication';
      seedMinEpisodes(store, category);

      const prediction = makePrediction({
        category,
        predictedScore: 55,
        predictedOutcome: 'escalation',
      });
      store.savePrediction(prediction);

      const outcome = makeOutcome({
        stepId: prediction.stepId,
        runId: prediction.runId,
        actualOutcome: 'escalation',
        actualCordScore: 55,
        actualCordDecision: 'CHALLENGE',
        signals: {
          succeeded: true,
          escalated: true,
          approvalGranted: true,
          hasError: false,
          durationMs: 500,
        },
      });
      store.saveOutcome(outcome);

      const weightBefore = store.getWeight(category)!.currentWeight;
      const episode = core.learn(prediction, outcome);
      const weightAfter = store.getWeight(category)!.currentWeight;

      expect(episode.adjustmentDirection).toBe('decrease');
      expect(weightAfter).toBeLessThan(weightBefore);
    });

    it('decreases weight when BLOCK overridden', () => {
      const category: SparkCategory = 'scheduling';
      seedMinEpisodes(store, category);

      const prediction = makePrediction({
        category,
        operation: 'create_event',
        predictedScore: 85,
      });
      store.savePrediction(prediction);

      const outcome = makeOutcome({
        stepId: prediction.stepId,
        runId: prediction.runId,
        actualOutcome: 'escalation',
        actualCordScore: 85,
        actualCordDecision: 'BLOCK',
        signals: {
          succeeded: true,
          escalated: true,
          approvalGranted: true,
          hasError: false,
        },
      });
      store.saveOutcome(outcome);

      const weightBefore = store.getWeight(category)!.currentWeight;
      const episode = core.learn(prediction, outcome);
      const weightAfter = store.getWeight(category)!.currentWeight;

      expect(episode.adjustmentDirection).toBe('decrease');
      expect(weightAfter).toBeLessThan(weightBefore);
    });

    it('magnitude is proportional to how high the score was', () => {
      const category: SparkCategory = 'communication';
      seedMinEpisodes(store, category);

      // High score override (score=85) — should have larger decrease magnitude
      const predHigh = makePrediction({
        id: 'pred-dec-high',
        stepId: 'step-dec-high',
        category,
        predictedScore: 85,
      });
      store.savePrediction(predHigh);

      const outHigh = makeOutcome({
        id: 'out-dec-high',
        stepId: 'step-dec-high',
        actualOutcome: 'escalation',
        actualCordScore: 85,
        actualCordDecision: 'CHALLENGE',
        signals: {
          succeeded: true,
          escalated: true,
          approvalGranted: true,
          hasError: false,
        },
      });
      store.saveOutcome(outHigh);

      const episodeHigh = core.learn(predHigh, outHigh);

      // Reset weight for fair comparison
      const weight = store.getWeight(category)!;
      store.saveWeight({ ...weight, currentWeight: 1.0 });

      // Medium score override (score=55) — should have smaller decrease magnitude
      const predMed = makePrediction({
        id: 'pred-dec-med',
        stepId: 'step-dec-med',
        category,
        predictedScore: 55,
      });
      store.savePrediction(predMed);

      const outMed = makeOutcome({
        id: 'out-dec-med',
        stepId: 'step-dec-med',
        actualOutcome: 'escalation',
        actualCordScore: 55,
        actualCordDecision: 'CHALLENGE',
        signals: {
          succeeded: true,
          escalated: true,
          approvalGranted: true,
          hasError: false,
        },
      });
      store.saveOutcome(outMed);

      const episodeMed = core.learn(predMed, outMed);

      // A CHALLENGE at score=85 (very cautious) should produce a larger decrease
      // than one at score=55 (moderately cautious)
      expect(episodeHigh.adjustmentMagnitude).toBeGreaterThanOrEqual(
        episodeMed.adjustmentMagnitude,
      );
    });
  });

  // ── No change when assessment is correct ────────────────────

  describe('no change when assessment is correct', () => {
    it('no weight change when ALLOW + success', () => {
      const category: SparkCategory = 'readonly';
      seedMinEpisodes(store, category);

      const prediction = makePrediction({
        category,
        operation: 'read',
        predictedScore: 5,
        predictedOutcome: 'success',
      });
      store.savePrediction(prediction);

      const outcome = makeOutcome({
        stepId: prediction.stepId,
        runId: prediction.runId,
        actualOutcome: 'success',
        actualCordScore: 5,
        actualCordDecision: 'ALLOW',
        signals: {
          succeeded: true,
          escalated: false,
          hasError: false,
          durationMs: 100,
        },
      });
      store.saveOutcome(outcome);

      const weightBefore = store.getWeight(category)!.currentWeight;
      const episode = core.learn(prediction, outcome);
      const weightAfter = store.getWeight(category)!.currentWeight;

      expect(episode.adjustmentDirection).toBe('none');
      expect(weightAfter).toBeCloseTo(weightBefore, 10);
      expect(episode.adjustmentMagnitude).toBe(0);
    });

    it('no weight change when CHALLENGE + denied', () => {
      const category: SparkCategory = 'communication';
      seedMinEpisodes(store, category);

      const prediction = makePrediction({
        category,
        predictedScore: 60,
        predictedOutcome: 'escalation',
      });
      store.savePrediction(prediction);

      const outcome = makeOutcome({
        stepId: prediction.stepId,
        runId: prediction.runId,
        actualOutcome: 'blocked',
        actualCordScore: 60,
        actualCordDecision: 'CHALLENGE',
        signals: {
          succeeded: false,
          escalated: true,
          approvalGranted: false,
          hasError: false,
        },
      });
      store.saveOutcome(outcome);

      const weightBefore = store.getWeight(category)!.currentWeight;
      const episode = core.learn(prediction, outcome);
      const weightAfter = store.getWeight(category)!.currentWeight;

      expect(episode.adjustmentDirection).toBe('none');
      expect(weightAfter).toBeCloseTo(weightBefore, 10);
    });
  });

  // ── SENTINEL bounds enforcement ─────────────────────────────

  describe('SENTINEL bounds enforcement', () => {
    it('destructive category weight NEVER goes below 1.0', () => {
      const category: SparkCategory = 'destructive';
      seedMinEpisodes(store, category);

      // Attempt to decrease the destructive weight repeatedly
      for (let i = 0; i < 20; i++) {
        const prediction = makePrediction({
          id: `pred-sentinel-dest-${i}`,
          stepId: `step-sentinel-dest-${i}`,
          category,
          operation: 'delete',
          predictedScore: 75,
        });
        store.savePrediction(prediction);

        const outcome = makeOutcome({
          id: `out-sentinel-dest-${i}`,
          stepId: `step-sentinel-dest-${i}`,
          actualOutcome: 'escalation',
          actualCordScore: 75,
          actualCordDecision: 'CHALLENGE',
          signals: {
            succeeded: true,
            escalated: true,
            approvalGranted: true,
            hasError: false,
          },
        });
        store.saveOutcome(outcome);

        core.learn(prediction, outcome);
      }

      const weight = store.getWeight(category)!;
      // SENTINEL: destructive weight must NEVER drop below 1.0
      expect(weight.currentWeight).toBeGreaterThanOrEqual(1.0);
    });

    it('financial category weight NEVER goes below 1.0', () => {
      const category: SparkCategory = 'financial';
      seedMinEpisodes(store, category);

      // Attempt to decrease the financial weight repeatedly
      for (let i = 0; i < 20; i++) {
        const prediction = makePrediction({
          id: `pred-sentinel-fin-${i}`,
          stepId: `step-sentinel-fin-${i}`,
          category,
          operation: 'refund',
          predictedScore: 80,
        });
        store.savePrediction(prediction);

        const outcome = makeOutcome({
          id: `out-sentinel-fin-${i}`,
          stepId: `step-sentinel-fin-${i}`,
          actualOutcome: 'escalation',
          actualCordScore: 80,
          actualCordDecision: 'CHALLENGE',
          signals: {
            succeeded: true,
            escalated: true,
            approvalGranted: true,
            hasError: false,
          },
        });
        store.saveOutcome(outcome);

        core.learn(prediction, outcome);
      }

      const weight = store.getWeight(category)!;
      // SENTINEL: financial weight must NEVER drop below 1.0
      expect(weight.currentWeight).toBeGreaterThanOrEqual(1.0);
    });

    it('non-SENTINEL categories CAN decrease to 0.7', () => {
      const category: SparkCategory = 'readonly';
      seedMinEpisodes(store, category);

      // Attempt to decrease the readonly weight repeatedly
      for (let i = 0; i < 50; i++) {
        const prediction = makePrediction({
          id: `pred-nonsent-${i}`,
          stepId: `step-nonsent-${i}`,
          category,
          operation: 'read',
          predictedScore: 60,
        });
        store.savePrediction(prediction);

        const outcome = makeOutcome({
          id: `out-nonsent-${i}`,
          stepId: `step-nonsent-${i}`,
          actualOutcome: 'escalation',
          actualCordScore: 60,
          actualCordDecision: 'CHALLENGE',
          signals: {
            succeeded: true,
            escalated: true,
            approvalGranted: true,
            hasError: false,
          },
        });
        store.saveOutcome(outcome);

        core.learn(prediction, outcome);
      }

      const weight = store.getWeight(category)!;
      // Non-SENTINEL categories can go below 1.0
      expect(weight.currentWeight).toBeLessThan(1.0);
      // But should have a lower bound (0.7 based on MAX_DEVIATION_PERCENT=0.30)
      expect(weight.currentWeight).toBeGreaterThanOrEqual(0.7);
    });

    it('no category weight exceeds 1.3', () => {
      const category: SparkCategory = 'communication';
      seedMinEpisodes(store, category);

      // Push weight up with repeated failures
      for (let i = 0; i < 50; i++) {
        const prediction = makePrediction({
          id: `pred-cap-${i}`,
          stepId: `step-cap-${i}`,
          category,
          predictedScore: 5,
        });
        store.savePrediction(prediction);

        const outcome = makeOutcome({
          id: `out-cap-${i}`,
          stepId: `step-cap-${i}`,
          actualOutcome: 'failure',
          actualCordScore: 5,
          actualCordDecision: 'ALLOW',
          signals: {
            succeeded: false,
            escalated: false,
            hasError: true,
            errorMessage: 'Repeated failure',
          },
        });
        store.saveOutcome(outcome);

        core.learn(prediction, outcome);
      }

      const weight = store.getWeight(category)!;
      // Upper bound: 1.0 + MAX_DEVIATION_PERCENT = 1.3
      expect(weight.currentWeight).toBeLessThanOrEqual(1.3);
    });
  });

  // ── Minimum episodes before learning ────────────────────────

  describe('minimum episodes before learning', () => {
    it('no weight adjustment with fewer than 3 episodes', () => {
      const category: SparkCategory = 'general';
      // Do NOT seed min episodes — test starts with 0

      const prediction = makePrediction({
        category,
        predictedScore: 10,
      });
      store.savePrediction(prediction);

      const outcome = makeOutcome({
        stepId: prediction.stepId,
        runId: prediction.runId,
        actualOutcome: 'failure',
        actualCordScore: 10,
        actualCordDecision: 'ALLOW',
        signals: { succeeded: false, escalated: false, hasError: true },
      });
      store.saveOutcome(outcome);

      const weightBefore = store.getWeight(category)!.currentWeight;
      const episode = core.learn(prediction, outcome);
      const weightAfter = store.getWeight(category)!.currentWeight;

      // With fewer than MIN_EPISODES_BEFORE_LEARNING episodes,
      // the weight should not change
      expect(episode.adjustmentDirection).toBe('none');
      expect(weightAfter).toBeCloseTo(weightBefore, 10);
    });

    it('starts adjusting on 4th+ episode', () => {
      const category: SparkCategory = 'general';

      // Seed exactly MIN_EPISODES_BEFORE_LEARNING episodes (3)
      seedMinEpisodes(store, category, MIN_EPISODES_BEFORE_LEARNING);

      // The next episode (4th) should now trigger learning
      const prediction = makePrediction({
        id: 'pred-4th',
        stepId: 'step-4th',
        category,
        predictedScore: 10,
      });
      store.savePrediction(prediction);

      const outcome = makeOutcome({
        id: 'out-4th',
        stepId: 'step-4th',
        actualOutcome: 'failure',
        actualCordScore: 10,
        actualCordDecision: 'ALLOW',
        signals: { succeeded: false, escalated: false, hasError: true },
      });
      store.saveOutcome(outcome);

      const weightBefore = store.getWeight(category)!.currentWeight;
      const episode = core.learn(prediction, outcome);
      const weightAfter = store.getWeight(category)!.currentWeight;

      // With enough episodes, weight should increase for ALLOW + failure
      expect(episode.adjustmentDirection).toBe('increase');
      expect(weightAfter).toBeGreaterThan(weightBefore);
    });
  });

  // ── EMA convergence ─────────────────────────────────────────

  describe('EMA convergence', () => {
    it('weight increases gradually, not jumping (alpha=0.1)', () => {
      const category: SparkCategory = 'communication';
      seedMinEpisodes(store, category);

      const weights: number[] = [];
      weights.push(store.getWeight(category)!.currentWeight);

      for (let i = 0; i < 5; i++) {
        const prediction = makePrediction({
          id: `pred-ema-${i}`,
          stepId: `step-ema-${i}`,
          category,
          predictedScore: 10,
        });
        store.savePrediction(prediction);

        const outcome = makeOutcome({
          id: `out-ema-${i}`,
          stepId: `step-ema-${i}`,
          actualOutcome: 'failure',
          actualCordScore: 10,
          actualCordDecision: 'ALLOW',
          signals: { succeeded: false, escalated: false, hasError: true },
        });
        store.saveOutcome(outcome);

        core.learn(prediction, outcome);
        weights.push(store.getWeight(category)!.currentWeight);
      }

      // Verify weights are monotonically increasing (failures increase weight)
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]);
      }

      // Verify the increments are small (EMA smoothing with alpha=0.1)
      for (let i = 1; i < weights.length; i++) {
        const increment = weights[i] - weights[i - 1];
        // Each step should be a small fraction — not jumping more than
        // alpha * MAX_DEVIATION_PERCENT in a single step
        expect(increment).toBeLessThan(MAX_DEVIATION_PERCENT);
      }
    });

    it('10 consecutive failures increase weight but stay bounded', () => {
      const category: SparkCategory = 'scheduling';
      seedMinEpisodes(store, category);

      for (let i = 0; i < 10; i++) {
        const prediction = makePrediction({
          id: `pred-conv-${i}`,
          stepId: `step-conv-${i}`,
          category,
          operation: 'create_event',
          predictedScore: 8,
        });
        store.savePrediction(prediction);

        const outcome = makeOutcome({
          id: `out-conv-${i}`,
          stepId: `step-conv-${i}`,
          actualOutcome: 'failure',
          actualCordScore: 8,
          actualCordDecision: 'ALLOW',
          signals: {
            succeeded: false,
            escalated: false,
            hasError: true,
            errorMessage: `Failure ${i}`,
          },
        });
        store.saveOutcome(outcome);

        core.learn(prediction, outcome);
      }

      const finalWeight = store.getWeight(category)!.currentWeight;

      // Weight should have increased from 1.0
      expect(finalWeight).toBeGreaterThan(1.0);
      // But must stay within upper bound (1.0 + 0.30 = 1.3)
      expect(finalWeight).toBeLessThanOrEqual(1.3);
    });
  });
});
