/**
 * Tests for the OutcomeTracker class.
 *
 * Verifies that:
 * - Step status is correctly mapped to outcome categories
 * - All signal fields are captured accurately
 * - Outcomes are persisted to the store
 */

import { Database } from '@ai-operations/ops-storage';
import { SparkStore } from '@ai-operations/ops-storage';
import type { WorkflowStep } from '@ai-operations/shared-types';
import type { OutcomeSignal } from '@ai-operations/shared-types';
import { OutcomeTracker } from '../outcome-tracker';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-outcome-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `outcome-test-${dbCounter}.db`);
}

function createTestStore(): { db: Database; store: SparkStore } {
  const db = new Database(freshDbPath());
  const store = new SparkStore(db.db);
  return { db, store };
}

/** Build a minimal WorkflowStep for testing. */
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

// ── OutcomeTracker ───────────────────────────────────────────────

describe('OutcomeTracker', () => {
  let db: Database;
  let store: SparkStore;
  let tracker: OutcomeTracker;

  beforeEach(() => {
    const setup = createTestStore();
    db = setup.db;
    store = setup.store;
    tracker = new OutcomeTracker(store);
  });

  afterEach(() => {
    db.close();
  });

  describe('measure', () => {
    it("derives 'success' from completed step", () => {
      const step = makeStep({
        id: 'step-success',
        status: 'completed',
        cordDecision: 'ALLOW',
        cordScore: 10,
        durationMs: 200,
      });

      const outcome = tracker.measure(step, 'run-1');

      expect(outcome.actualOutcome).toBe('success');
      expect(outcome.signals.succeeded).toBe(true);
      expect(outcome.signals.hasError).toBe(false);
      expect(outcome.signals.escalated).toBe(false);
    });

    it("derives 'failure' from failed step", () => {
      const step = makeStep({
        id: 'step-fail',
        status: 'failed',
        cordDecision: 'ALLOW',
        cordScore: 10,
        error: 'API timeout',
      });

      const outcome = tracker.measure(step, 'run-1');

      expect(outcome.actualOutcome).toBe('failure');
      expect(outcome.signals.succeeded).toBe(false);
      expect(outcome.signals.hasError).toBe(true);
      expect(outcome.signals.errorMessage).toBe('API timeout');
    });

    it("derives 'blocked' from blocked step", () => {
      const step = makeStep({
        id: 'step-block',
        status: 'blocked',
        cordDecision: 'BLOCK',
        cordScore: 90,
      });

      const outcome = tracker.measure(step, 'run-1');

      expect(outcome.actualOutcome).toBe('blocked');
      expect(outcome.signals.succeeded).toBe(false);
    });

    it("derives 'escalation' from approved + completed step", () => {
      const step = makeStep({
        id: 'step-escalated',
        status: 'approved',
        cordDecision: 'CHALLENGE',
        cordScore: 55,
        durationMs: 500,
      });

      const outcome = tracker.measure(step, 'run-1');

      expect(outcome.actualOutcome).toBe('escalation');
      expect(outcome.signals.escalated).toBe(true);
      expect(outcome.signals.approvalGranted).toBe(true);
    });

    it("derives 'partial' from very slow completed step (>30s)", () => {
      const step = makeStep({
        id: 'step-slow',
        status: 'completed',
        cordDecision: 'ALLOW',
        cordScore: 15,
        durationMs: 35000, // 35 seconds — very slow
      });

      const outcome = tracker.measure(step, 'run-1');

      expect(outcome.actualOutcome).toBe('partial');
      expect(outcome.signals.succeeded).toBe(true);
      expect(outcome.signals.durationMs).toBe(35000);
    });

    it('captures all signal fields correctly', () => {
      const step = makeStep({
        id: 'step-signals',
        status: 'failed',
        cordDecision: 'CONTAIN',
        cordScore: 45,
        durationMs: 1200,
        error: 'Rate limited',
      });

      const outcome = tracker.measure(step, 'run-signals');

      expect(outcome.stepId).toBe('step-signals');
      expect(outcome.runId).toBe('run-signals');
      expect(outcome.actualCordScore).toBe(45);
      expect(outcome.actualCordDecision).toBe('CONTAIN');
      expect(outcome.signals).toEqual(
        expect.objectContaining({
          succeeded: false,
          escalated: false,
          hasError: true,
          errorMessage: 'Rate limited',
          durationMs: 1200,
        }),
      );
      expect(outcome.measuredAt).toBeDefined();
      expect(outcome.id).toBeDefined();
    });

    it('saves outcome to store', () => {
      const step = makeStep({
        id: 'step-persist',
        status: 'completed',
        cordDecision: 'ALLOW',
        cordScore: 5,
      });

      const outcome = tracker.measure(step, 'run-persist');

      const stored = store.getOutcome(outcome.id);
      expect(stored).toBeDefined();
      expect(stored!.id).toBe(outcome.id);
      expect(stored!.stepId).toBe('step-persist');
      expect(stored!.runId).toBe('run-persist');
      expect(stored!.actualOutcome).toBe('success');
    });
  });
});
