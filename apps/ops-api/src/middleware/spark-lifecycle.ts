/**
 * SPARK Lifecycle Middleware — Reusable predict/learn helpers for route handlers.
 *
 * Provides sparkPredict() and sparkLearn() functions that any connector route
 * (gmail, x-twitter, calendar, shopify) can call to wire into SPARK's
 * predict → measure → learn → consolidate pipeline.
 */

import { randomUUID } from 'node:crypto';
import { SparkOrchestrator } from '@ai-ops/spark-engine';
import { stores } from '../storage';
import type { WorkflowStep, CordDecision, Prediction, LearningEpisode, Insight } from '@ai-ops/shared-types';

// Single orchestrator instance shared across all route handlers
const orchestrator = new SparkOrchestrator(stores.spark);

export interface SparkCycleInput {
  stepId: string;
  connector: string;
  operation: string;
  cordScore: number;
  cordDecision: CordDecision;
  success: boolean;
  wasApproved?: boolean;
  durationMs: number;
  error?: string;
}

export interface SparkCycleResult {
  episode: LearningEpisode;
  insights: Insight[];
}

/**
 * Call BEFORE safety evaluation to generate a risk prediction.
 */
export function sparkPredict(
  stepId: string,
  connector: string,
  operation: string,
): Prediction {
  return orchestrator.predictor.predict(stepId, stepId, connector, operation);
}

/**
 * Call AFTER execution completes to close the feedback loop.
 * Returns null if no prediction was made for this stepId (graceful skip).
 */
export function sparkLearn(input: SparkCycleInput): SparkCycleResult | null {
  const prediction = stores.spark.getPredictionByStepId(input.stepId);
  if (!prediction) return null;

  // Build a WorkflowStep-compatible object for the OutcomeTracker
  const step: WorkflowStep = {
    id: input.stepId,
    connector: input.connector,
    operation: input.operation,
    input: {},
    status: input.success ? 'completed' : 'failed',
    cordDecision: input.cordDecision,
    cordScore: input.cordScore,
    durationMs: input.durationMs,
    error: input.error,
  };

  const outcome = orchestrator.tracker.measure(step, input.stepId, input.wasApproved);
  return orchestrator.learn(prediction, outcome);
}

// ── Pending approval context store ──────────────────────────────────────────
// When a pipeline hits CHALLENGE and returns early, we store the SPARK context
// here so that when the approval decision comes in, we can close the loop.

const pendingContexts = new Map<string, SparkCycleInput>();

/**
 * Register a pending SPARK context when an approval is created.
 * Called from route handlers when CORD returns CHALLENGE.
 */
export function registerPendingApproval(approvalId: string, context: Omit<SparkCycleInput, 'success' | 'durationMs'>): void {
  pendingContexts.set(approvalId, {
    ...context,
    success: false,     // placeholder — will be set on resolution
    durationMs: 0,      // placeholder — will be computed on resolution
  });
}

/**
 * Resolve a pending SPARK context when an approval decision is made.
 * Triggers sparkLearn with the decision outcome.
 * Returns the learning result, or null if no pending context exists.
 */
export function resolvePendingApproval(
  approvalId: string,
  decision: 'approved' | 'denied' | 'modified',
): SparkCycleResult | null {
  const context = pendingContexts.get(approvalId);
  if (!context) return null;

  pendingContexts.delete(approvalId);

  // Approved = success, denied = not success (action didn't happen)
  const wasApproved = decision === 'approved' || decision === 'modified';
  const updatedContext: SparkCycleInput = {
    ...context,
    success: wasApproved,   // approved means action will proceed
    wasApproved,
    durationMs: Date.now(), // total time from prediction to decision
  };

  return sparkLearn(updatedContext);
}

/** Get count of pending contexts (for debugging/monitoring) */
export function getPendingCount(): number {
  return pendingContexts.size;
}

export { orchestrator };
