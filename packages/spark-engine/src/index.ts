/**
 * @ai-operations/spark-engine — Self-Perpetuating Adaptive Reasoning Kernel.
 *
 * Closed feedback loop that wraps CORD safety scoring with
 * predict -> act -> measure -> learn -> consolidate -> assess.
 *
 * Exports:
 * - Predictor:           Generates risk predictions before step execution.
 * - OutcomeTracker:      Measures actual outcomes after step execution.
 * - LearningCore:        Compares predictions against outcomes and adjusts weights.
 * - WeightManager:       Manages weight state, initialization, and snapshots.
 * - AdaptiveSafetyGate:  CORD evaluation with learned weight adjustments.
 * - MemoryCore:          Detects episode patterns and generates insights.
 * - AwarenessCore:       Maintains structured beliefs and self-assessment reports.
 * - SparkOrchestrator:   Composes all engines into a single facade.
 * - operationToCategory: Maps operation names to CORD tool categories.
 * - Constants:           EMA_ALPHA, MAX_DEVIATION_PERCENT, etc.
 */

// ── Core Classes ──────────────────────────────────────────────────
export { Predictor, operationToCategory } from './predictor';
export { OutcomeTracker } from './outcome-tracker';
export { LearningCore } from './learning-core';
export { WeightManager } from './weight-manager';
export {
  AdaptiveSafetyGate,
} from './adaptive-safety-gate';
export type {
  AdaptiveSafetyResult,
  SafetyResult,
  CordSafetyGateInterface,
} from './adaptive-safety-gate';

// ── Memory & Awareness ──────────────────────────────────────────
export { MemoryCore } from './memory-core';
export { AwarenessCore } from './awareness-core';
export { ReasoningCore } from './reasoning-core';
export { SparkOrchestrator } from './orchestrator';

// ── Emotional State ─────────────────────────────────────────────
export { EmotionalStateEngine } from './emotional-state';

// ── Self-Reflection ────────────────────────────────────────────
export { SelfReflectionEngine } from './self-reflection';

// ── Personality ────────────────────────────────────────────────
export { PersonalityEngine } from './personality-engine';

// ── Spiral Memory ───────────────────────────────────────────────
export { EssenceExtractor } from './essence-extractor';
export { MemoryTokenManager } from './memory-token-manager';
export { SpiralLoop } from './spiral-loop';
export type { SpiralPassResult, SpiralMaintenanceResult } from './spiral-loop';
export { ContextReconstructor } from './context-reconstructor';
export { FeedbackIntegrator } from './feedback-integrator';

// ── Constants ─────────────────────────────────────────────────────
export {
  EMA_ALPHA,
  MAX_DEVIATION_PERCENT,
  MIN_EPISODES_BEFORE_LEARNING,
  DEFAULT_BASE_WEIGHT,
  ALL_CATEGORIES,
  buildDefaultWeight,
  buildAllDefaultWeights,
} from './constants';

export {
  REINFORCE_RATE,
  DECAY_RATE,
  PASSIVE_DECAY_PER_DAY,
  INITIAL_TOKEN_STRENGTH,
  ARCHIVE_STRENGTH_THRESHOLD,
  MAX_CONTEXT_TOKENS,
  MAX_GRAPH_DEPTH,
} from './spiral-constants';
