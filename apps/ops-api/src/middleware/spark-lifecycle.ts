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

export { orchestrator };
