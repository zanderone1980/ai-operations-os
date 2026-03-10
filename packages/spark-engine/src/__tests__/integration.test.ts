/**
 * Integration tests for the full SPARK feedback loop.
 *
 * Verifies the complete predict -> act -> measure -> learn cycle
 * working end-to-end with real SQLite persistence:
 * - Full feedback loop works end to end
 * - System gets more cautious after repeated failures
 * - System relaxes after repeated approved successes
 * - SENTINEL categories stay protected across many episodes
 * - Prediction confidence increases with more data
 * - Snapshot and rollback preserve system state
 */

import { Database } from '@ai-operations/ops-storage';
import { SparkStore } from '@ai-operations/ops-storage';
import type {
  SparkCategory,
  Prediction,
  OutcomeSignal,
  WorkflowStep,
} from '@ai-operations/shared-types';
import { SENTINEL_CATEGORIES } from '@ai-operations/shared-types';
import { Predictor, operationToCategory } from '../predictor';
import { OutcomeTracker } from '../outcome-tracker';
import { LearningCore } from '../learning-core';
import { WeightManager } from '../weight-manager';
import { AdaptiveSafetyGate } from '../adaptive-safety-gate';
import {
  ALL_CATEGORIES,
  MIN_EPISODES_BEFORE_LEARNING,
  buildAllDefaultWeights,
} from '../constants';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-integration-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `integration-test-${dbCounter}.db`);
}

interface SparkSystem {
  db: Database;
  store: SparkStore;
  predictor: Predictor;
  tracker: OutcomeTracker;
  learner: LearningCore;
  manager: WeightManager;
}

function createSparkSystem(): SparkSystem {
  const db = new Database(freshDbPath());
  const store = new SparkStore(db.db);
  const manager = new WeightManager(store);
  manager.initialize();

  return {
    db,
    store,
    predictor: new Predictor(store),
    tracker: new OutcomeTracker(store),
    learner: new LearningCore(store),
    manager,
  };
}

/** Build a minimal WorkflowStep. */
function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    connector: 'gmail',
    operation: 'send',
    input: { to: 'user@example.com' },
    status: 'completed',
    ...overrides,
  };
}

/**
 * Run a complete predict -> measure -> learn cycle.
 *
 * @param sys      — The SPARK system components.
 * @param step     — The workflow step to process.
 * @param runId    — The workflow run ID.
 * @returns The learning episode from this cycle.
 */
function runCycle(sys: SparkSystem, step: WorkflowStep, runId: string) {
  // 1. PREDICT
  const prediction = sys.predictor.predict(
    step.id,
    runId,
    step.connector,
    step.operation,
  );

  // 2. MEASURE
  const outcome = sys.tracker.measure(step, runId);

  // 3. LEARN
  const episode = sys.learner.learn(prediction, outcome);

  return { prediction, outcome, episode };
}

/**
 * Seed enough neutral episodes to surpass the minimum learning threshold.
 */
function seedMinEpisodes(sys: SparkSystem, category: SparkCategory): void {
  const count = MIN_EPISODES_BEFORE_LEARNING + 1;
  for (let i = 0; i < count; i++) {
    const step = makeStep({
      id: `seed-${category}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      connector: category === 'financial' ? 'shopify' : 'gmail',
      operation:
        category === 'readonly'
          ? 'read'
          : category === 'financial'
            ? 'refund'
            : category === 'destructive'
              ? 'delete'
              : category === 'publication'
                ? 'post'
                : category === 'scheduling'
                  ? 'create_event'
                  : 'send',
      status: 'completed',
      cordDecision: 'ALLOW',
      cordScore: 10,
      durationMs: 200,
    });
    runCycle(sys, step, `seed-run-${i}`);
  }
}

// ── Integration Tests ────────────────────────────────────────────

describe('SPARK Feedback Loop Integration', () => {
  let sys: SparkSystem;

  beforeEach(() => {
    sys = createSparkSystem();
  });

  afterEach(() => {
    sys.db.close();
  });

  it('full predict -> measure -> learn cycle works end to end', () => {
    const step = makeStep({
      id: 'integration-step-1',
      connector: 'gmail',
      operation: 'send',
      status: 'completed',
      cordDecision: 'ALLOW',
      cordScore: 15,
      durationMs: 300,
    });

    const { prediction, outcome, episode } = runCycle(
      sys,
      step,
      'integration-run-1',
    );

    // Prediction was created and saved
    expect(prediction.id).toBeDefined();
    expect(prediction.category).toBe('communication');
    expect(sys.store.getPrediction(prediction.id)).toBeDefined();

    // Outcome was created and saved
    expect(outcome.id).toBeDefined();
    expect(outcome.actualOutcome).toBe('success');
    expect(sys.store.getOutcome(outcome.id)).toBeDefined();

    // Episode was created and saved
    expect(episode.id).toBeDefined();
    expect(episode.category).toBe('communication');
    expect(sys.store.getEpisode(episode.id)).toBeDefined();
  });

  it('system gets more cautious after repeated failures', () => {
    const category: SparkCategory = 'communication';
    seedMinEpisodes(sys, category);

    const weightBefore = sys.store.getWeight(category)!.currentWeight;

    // Run 10 failure cycles
    for (let i = 0; i < 10; i++) {
      const step = makeStep({
        id: `fail-step-${i}-${Math.random().toString(36).slice(2, 8)}`,
        connector: 'gmail',
        operation: 'send',
        status: 'failed',
        cordDecision: 'ALLOW',
        cordScore: 10,
        error: `API failure ${i}`,
      });
      runCycle(sys, step, `fail-run-${i}`);
    }

    const weightAfter = sys.store.getWeight(category)!.currentWeight;

    // System should be more cautious (higher weight) after repeated failures
    expect(weightAfter).toBeGreaterThan(weightBefore);
  });

  it('system relaxes after repeated approved successes', () => {
    const category: SparkCategory = 'scheduling';
    seedMinEpisodes(sys, category);

    // First, increase the weight by simulating some failures
    for (let i = 0; i < 5; i++) {
      const failStep = makeStep({
        id: `pre-fail-${i}-${Math.random().toString(36).slice(2, 8)}`,
        connector: 'calendar',
        operation: 'create_event',
        status: 'failed',
        cordDecision: 'ALLOW',
        cordScore: 10,
        error: 'Calendar API error',
      });
      runCycle(sys, failStep, `pre-fail-run-${i}`);
    }

    const weightAfterFailures = sys.store.getWeight(category)!.currentWeight;
    expect(weightAfterFailures).toBeGreaterThan(1.0);

    // Now run approved success cycles (CHALLENGE + approved + success)
    for (let i = 0; i < 15; i++) {
      const successStep = makeStep({
        id: `approve-step-${i}-${Math.random().toString(36).slice(2, 8)}`,
        connector: 'calendar',
        operation: 'create_event',
        status: 'approved',
        cordDecision: 'CHALLENGE',
        cordScore: 55,
        durationMs: 200,
      });
      runCycle(sys, successStep, `approve-run-${i}`);
    }

    const weightAfterSuccesses = sys.store.getWeight(category)!.currentWeight;

    // System should have relaxed (lower weight) after repeated approved successes
    expect(weightAfterSuccesses).toBeLessThan(weightAfterFailures);
  });

  it('SENTINEL categories stay protected across many episodes', () => {
    for (const sentinel of SENTINEL_CATEGORIES) {
      const mySys = createSparkSystem();
      seedMinEpisodes(mySys, sentinel);

      // Run 30 approved-success cycles trying to decrease the weight
      for (let i = 0; i < 30; i++) {
        const step = makeStep({
          id: `sentinel-${sentinel}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          connector: sentinel === 'financial' ? 'shopify' : 'gmail',
          operation: sentinel === 'financial' ? 'refund' : 'delete',
          status: 'approved',
          cordDecision: 'CHALLENGE',
          cordScore: 70,
          durationMs: 200,
        });
        runCycle(mySys, step, `sentinel-run-${i}`);
      }

      const weight = mySys.store.getWeight(sentinel)!;
      // SENTINEL categories must NEVER drop below their base weight (1.0)
      expect(weight.currentWeight).toBeGreaterThanOrEqual(1.0);

      mySys.db.close();
    }
  });

  it('prediction confidence increases with more data', () => {
    const category: SparkCategory = 'communication';

    // First prediction with no history: low confidence
    const firstPrediction = sys.predictor.predict(
      'first-step',
      'run-1',
      'gmail',
      'send',
    );
    const initialConfidence = firstPrediction.confidence;

    // Run many cycles to build up history
    seedMinEpisodes(sys, category);
    for (let i = 0; i < 20; i++) {
      const step = makeStep({
        id: `conf-step-${i}-${Math.random().toString(36).slice(2, 8)}`,
        connector: 'gmail',
        operation: 'send',
        status: 'completed',
        cordDecision: 'ALLOW',
        cordScore: 15,
        durationMs: 200,
      });
      runCycle(sys, step, `conf-run-${i}`);
    }

    // After many episodes, confidence should be higher
    const laterPrediction = sys.predictor.predict(
      'later-step',
      'run-later',
      'gmail',
      'send',
    );

    expect(laterPrediction.confidence).toBeGreaterThan(initialConfidence);
  });

  it('snapshot and rollback preserve system state', () => {
    const category: SparkCategory = 'communication';
    seedMinEpisodes(sys, category);

    // Record initial state
    const snapshotId = sys.manager.createSnapshot('before failures');
    const weightAtSnapshot = sys.store.getWeight(category)!.currentWeight;

    // Run failures to change the weight
    for (let i = 0; i < 8; i++) {
      const step = makeStep({
        id: `snap-fail-${i}-${Math.random().toString(36).slice(2, 8)}`,
        connector: 'gmail',
        operation: 'send',
        status: 'failed',
        cordDecision: 'ALLOW',
        cordScore: 10,
        error: 'Failure for snapshot test',
      });
      runCycle(sys, step, `snap-fail-run-${i}`);
    }

    const weightAfterFailures = sys.store.getWeight(category)!.currentWeight;
    expect(weightAfterFailures).toBeGreaterThan(weightAtSnapshot);

    // Rollback to the snapshot
    sys.manager.restoreSnapshot(snapshotId);

    const weightAfterRollback = sys.store.getWeight(category)!.currentWeight;
    expect(weightAfterRollback).toBeCloseTo(weightAtSnapshot, 10);

    // Episodes are still in the database (rollback only restores weights, not history)
    const episodes = sys.store.listEpisodes({ category });
    expect(episodes.length).toBeGreaterThan(0);
  });

  it('all 7 categories can be processed independently', () => {
    const operationMap: Record<SparkCategory, { connector: string; operation: string }> = {
      communication: { connector: 'gmail', operation: 'send' },
      publication: { connector: 'x', operation: 'post' },
      destructive: { connector: 'gmail', operation: 'delete' },
      scheduling: { connector: 'calendar', operation: 'create_event' },
      financial: { connector: 'shopify', operation: 'refund' },
      readonly: { connector: 'gmail', operation: 'read' },
      general: { connector: 'custom', operation: 'do_something' },
    };

    for (const cat of ALL_CATEGORIES) {
      const info = operationMap[cat];
      const step = makeStep({
        id: `cat-${cat}-${Math.random().toString(36).slice(2, 8)}`,
        connector: info.connector,
        operation: info.operation,
        status: 'completed',
        cordDecision: 'ALLOW',
        cordScore: 10,
        durationMs: 100,
      });

      const { prediction, outcome, episode } = runCycle(
        sys,
        step,
        `cat-run-${cat}`,
      );

      expect(prediction.category).toBe(cat);
      expect(episode.category).toBe(cat);
    }

    // Verify all categories have at least one episode
    for (const cat of ALL_CATEGORIES) {
      const count = sys.store.countEpisodes({ category: cat });
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('multiple categories learn independently without interference', () => {
    seedMinEpisodes(sys, 'communication');
    seedMinEpisodes(sys, 'readonly');

    // Cause failures in communication
    for (let i = 0; i < 5; i++) {
      const step = makeStep({
        id: `indep-comm-${i}-${Math.random().toString(36).slice(2, 8)}`,
        connector: 'gmail',
        operation: 'send',
        status: 'failed',
        cordDecision: 'ALLOW',
        cordScore: 8,
        error: 'Communication failure',
      });
      runCycle(sys, step, `indep-comm-run-${i}`);
    }

    // Cause successes in readonly
    for (let i = 0; i < 5; i++) {
      const step = makeStep({
        id: `indep-read-${i}-${Math.random().toString(36).slice(2, 8)}`,
        connector: 'gmail',
        operation: 'read',
        status: 'completed',
        cordDecision: 'ALLOW',
        cordScore: 5,
        durationMs: 100,
      });
      runCycle(sys, step, `indep-read-run-${i}`);
    }

    const commWeight = sys.store.getWeight('communication')!.currentWeight;
    const readWeight = sys.store.getWeight('readonly')!.currentWeight;

    // Communication should have increased (failures)
    expect(commWeight).toBeGreaterThan(1.0);
    // Readonly should still be at base (successes = no change)
    expect(readWeight).toBeCloseTo(1.0, 1);
  });
});
