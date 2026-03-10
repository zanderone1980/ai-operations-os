/**
 * SparkOrchestrator — Composes all SPARK engines into a single facade.
 *
 * Provides the complete predict -> act -> measure -> learn -> consolidate -> assess
 * pipeline in one class.
 */

import type {
  Prediction,
  OutcomeSignal,
  LearningEpisode,
  Insight,
  ReasoningResult,
} from '@ai-ops/shared-types';
import type { SparkStore } from '@ai-ops/ops-storage';
import { Predictor } from './predictor';
import { OutcomeTracker } from './outcome-tracker';
import { LearningCore } from './learning-core';
import { WeightManager } from './weight-manager';
import { MemoryCore } from './memory-core';
import { AwarenessCore } from './awareness-core';
import { ReasoningCore } from './reasoning-core';

// ── SparkOrchestrator ───────────────────────────────────────────

/**
 * Composition facade that wires together all SPARK engines and provides
 * the full feedback pipeline through a single entry point.
 *
 * Creates and owns instances of every engine subsystem:
 * - Predictor:      generates risk predictions before step execution
 * - OutcomeTracker: measures actual outcomes after step execution
 * - LearningCore:   compares predictions against outcomes and adjusts weights
 * - WeightManager:  manages weight state, initialization, and snapshots
 * - MemoryCore:     analyzes episode patterns and generates insights
 * - AwarenessCore:  maintains structured beliefs and self-assessment reports
 *
 * @example
 * ```ts
 * const orchestrator = new SparkOrchestrator(sparkStore);
 *
 * // Predict before execution
 * const prediction = orchestrator.predictor.predict(stepId, runId, connector, op);
 *
 * // ... execute step ...
 *
 * // Measure outcome
 * const outcome = orchestrator.tracker.measure(completedStep, runId);
 *
 * // Learn + consolidate in one call
 * const { episode, insights } = orchestrator.learn(prediction, outcome);
 *
 * // Generate full self-assessment
 * const report = orchestrator.awareness.report();
 * ```
 */
export class SparkOrchestrator {
  /** Risk prediction engine. */
  public readonly predictor: Predictor;

  /** Outcome measurement engine. */
  public readonly tracker: OutcomeTracker;

  /** Core learning engine (prediction vs. outcome comparison). */
  public readonly learner: LearningCore;

  /** Memory consolidation engine (pattern detection + insight generation). */
  public readonly memory: MemoryCore;

  /** Self-knowledge engine (beliefs, trust classification, reporting). */
  public readonly awareness: AwarenessCore;

  /** Weight state manager (initialization, multipliers, snapshots). */
  public readonly weights: WeightManager;

  /** Conversational reasoning engine. */
  public readonly reasoning: ReasoningCore;

  /**
   * @param store - SparkStore instance shared across all engines.
   */
  constructor(store: SparkStore) {
    this.predictor = new Predictor(store);
    this.tracker = new OutcomeTracker(store);
    this.learner = new LearningCore(store);
    this.weights = new WeightManager(store);
    this.memory = new MemoryCore(store);
    this.awareness = new AwarenessCore(store);
    this.reasoning = new ReasoningCore(store);
  }

  /**
   * Run the learn + consolidate pipeline in a single call.
   *
   * 1. Calls LearningCore.learn() to compare prediction against outcome
   *    and apply any weight adjustments.
   * 2. Calls MemoryCore.consolidate() on the resulting episode to detect
   *    patterns and generate insights.
   *
   * @param prediction - The prediction made before step execution.
   * @param outcome    - The measured outcome after step execution.
   * @returns The learning episode and any generated insights.
   */
  learn(
    prediction: Prediction,
    outcome: OutcomeSignal,
  ): { episode: LearningEpisode; insights: Insight[] } {
    const episode = this.learner.learn(prediction, outcome);
    const insights = this.memory.consolidate(episode);
    return { episode, insights };
  }

  /**
   * Process a conversational query through the reasoning engine.
   * Assembles a full awareness report and delegates to ReasoningCore.
   *
   * @param query          - Natural language question for SPARK.
   * @param conversationId - Optional ID to continue an existing conversation.
   * @returns Structured reasoning result with response, steps, and suggestions.
   */
  chat(query: string, conversationId?: string): ReasoningResult {
    const report = this.awareness.report();
    return this.reasoning.reason(query, conversationId, report);
  }
}
