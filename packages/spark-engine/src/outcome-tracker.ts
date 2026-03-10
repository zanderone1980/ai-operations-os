/**
 * OutcomeTracker — Measures actual outcomes after workflow step execution.
 *
 * After a step completes (or fails, or is blocked), the OutcomeTracker
 * derives an OutcomeSignal from the step's final state. This signal feeds
 * into the LearningCore to compare predicted vs. actual results.
 */

import { randomUUID } from 'node:crypto';
import type { OutcomeSignal, ActualOutcome } from '@ai-ops/shared-types';
import type { WorkflowStep } from '@ai-ops/shared-types';
import type { SparkStore } from '@ai-ops/ops-storage';

// ── Outcome Derivation Constants ──────────────────────────────────

/** Steps longer than this (in milliseconds) are considered partial successes. */
const SLOW_STEP_THRESHOLD_MS = 30_000;

// ── OutcomeTracker ────────────────────────────────────────────────

/**
 * Measures and records the actual outcome of a workflow step after execution.
 *
 * The tracker inspects the step's status, duration, and approval state to
 * derive a categorical outcome signal that the LearningCore can compare
 * against the original prediction.
 *
 * @example
 * ```ts
 * const tracker = new OutcomeTracker(sparkStore);
 * const signal = tracker.measure(completedStep, 'run-1');
 * console.log(signal.actualOutcome); // 'success' | 'failure' | 'blocked' | ...
 * ```
 */
export class OutcomeTracker {
  private readonly store: SparkStore;

  /**
   * @param store - SparkStore instance for saving outcome signals.
   */
  constructor(store: SparkStore) {
    this.store = store;
  }

  /**
   * Derive an OutcomeSignal from a completed workflow step.
   *
   * Outcome derivation rules (in priority order):
   * 1. status='blocked'                        -> 'blocked'
   * 2. status='failed'                         -> 'failure'
   * 3. wasApproved && status='completed'        -> 'escalation'
   * 4. status='completed' && durationMs > 30s   -> 'partial'
   * 5. status='completed'                       -> 'success'
   * 6. everything else                          -> 'partial'
   *
   * @param step        - The workflow step to measure.
   * @param runId       - The workflow run this step belongs to.
   * @param wasApproved - Whether a human explicitly approved this step (optional).
   * @returns A persisted OutcomeSignal.
   */
  measure(
    step: WorkflowStep,
    runId: string,
    wasApproved?: boolean,
  ): OutcomeSignal {
    const actualOutcome = this.deriveOutcome(step, wasApproved);

    const signal: OutcomeSignal = {
      id: randomUUID(),
      stepId: step.id,
      runId,
      actualOutcome,
      actualCordScore: step.cordScore ?? 0,
      actualCordDecision: step.cordDecision ?? 'ALLOW',
      signals: {
        succeeded: step.status === 'completed' || step.status === 'approved',
        escalated: wasApproved !== undefined || step.status === 'approved',
        approvalGranted: wasApproved ?? (step.status === 'approved' ? true : undefined),
        durationMs: step.durationMs,
        hasError: step.status === 'failed',
        errorMessage: step.error,
      },
      measuredAt: new Date().toISOString(),
    };

    this.store.saveOutcome(signal);
    return signal;
  }

  /**
   * Derive the actual outcome category from step state and approval status.
   *
   * @param step        - The workflow step.
   * @param wasApproved - Whether human approval was granted.
   * @returns The derived ActualOutcome category.
   */
  private deriveOutcome(step: WorkflowStep, wasApproved?: boolean): ActualOutcome {
    if (step.status === 'blocked') {
      return 'blocked';
    }

    if (step.status === 'failed') {
      return 'failure';
    }

    // Step was challenged and human approved it — escalation
    if (step.status === 'approved') {
      return 'escalation';
    }

    if (wasApproved && step.status === 'completed') {
      return 'escalation';
    }

    if (step.status === 'completed') {
      if (step.durationMs !== undefined && step.durationMs > SLOW_STEP_THRESHOLD_MS) {
        return 'partial';
      }
      return 'success';
    }

    return 'partial';
  }
}
