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
} from '@ai-operations/shared-types';
import type { SparkStore } from '@ai-operations/ops-storage';
import { Predictor } from './predictor';
import { OutcomeTracker } from './outcome-tracker';
import { LearningCore } from './learning-core';
import { WeightManager } from './weight-manager';
import { MemoryCore } from './memory-core';
import { AwarenessCore } from './awareness-core';
import { ReasoningCore } from './reasoning-core';
import { EssenceExtractor } from './essence-extractor';
import { MemoryTokenManager } from './memory-token-manager';
import { SpiralLoop } from './spiral-loop';
import { ContextReconstructor } from './context-reconstructor';
import { FeedbackIntegrator } from './feedback-integrator';
import { EmotionalStateEngine } from './emotional-state';
import { SelfReflectionEngine } from './self-reflection';

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

  /** Essence extraction engine (algorithmic compression). */
  public readonly essenceExtractor: EssenceExtractor;

  /** Memory token lifecycle manager. */
  public readonly tokenManager: MemoryTokenManager;

  /** Spiral refinement loop. */
  public readonly spiral: SpiralLoop;

  /** Context reconstruction engine. */
  public readonly reconstructor: ContextReconstructor;

  /** Feedback integration engine. */
  public readonly feedbackIntegrator: FeedbackIntegrator;

  /** Emotional state engine — SPARK's affective baseline. */
  public readonly emotionalState: EmotionalStateEngine;

  /** Self-reflection engine — metacognitive blind-spot & growth assessment. */
  public readonly reflection: SelfReflectionEngine;

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

    // Emotional State engine
    this.emotionalState = new EmotionalStateEngine(store);

    // Spiral Memory engines
    this.essenceExtractor = new EssenceExtractor(store);
    this.tokenManager = new MemoryTokenManager(store, this.essenceExtractor);
    this.spiral = new SpiralLoop(store, this.tokenManager, this.essenceExtractor, this.emotionalState);
    this.reconstructor = new ContextReconstructor(store, this.essenceExtractor);
    this.feedbackIntegrator = new FeedbackIntegrator(store, this.tokenManager, this.spiral, this.emotionalState);

    // Self-Reflection engine
    this.reflection = new SelfReflectionEngine(store);
    this.reflection.setEngines({
      tokenManager: this.tokenManager,
      spiral: this.spiral,
      emotionalState: this.emotionalState,
    });

    // Wire spiral memory into reasoning core
    this.reasoning.setSpiralMemory(this.reconstructor, this.feedbackIntegrator);
    this.reasoning.setEmotionalState(this.emotionalState);
    this.reasoning.setReflection(this.reflection);
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

    // Feed into Spiral Memory
    this.feedbackIntegrator.onEpisode(episode);
    for (const insight of insights) {
      this.feedbackIntegrator.onInsight(insight);
    }

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
