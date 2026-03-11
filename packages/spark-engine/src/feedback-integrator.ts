/**
 * FeedbackIntegrator — Bridges Existing SPARK Loops to Spiral Memory.
 *
 * Connects the spiral memory system to existing SPARK feedback loops.
 * When learning episodes confirm/deny patterns, when beliefs update,
 * and when insights are generated, the feedback integrator creates
 * memory tokens and runs spiral passes.
 */

import type { SparkStore } from '@ai-operations/ops-storage';
import type {
  LearningEpisode,
  Insight,
  Belief,
  ConversationTurn,
} from '@ai-operations/shared-types';
import { MemoryTokenManager } from './memory-token-manager';
import { SpiralLoop } from './spiral-loop';
import type { SpiralPassResult } from './spiral-loop';
import type { EmotionalStateEngine } from './emotional-state';

export class FeedbackIntegrator {
  private readonly store: SparkStore;
  private readonly tokenManager: MemoryTokenManager;
  private readonly spiralLoop: SpiralLoop;
  private emotionalState: EmotionalStateEngine | null;

  constructor(store: SparkStore, tokenManager: MemoryTokenManager, spiralLoop: SpiralLoop, emotionalState?: EmotionalStateEngine) {
    this.store = store;
    this.tokenManager = tokenManager;
    this.spiralLoop = spiralLoop;
    this.emotionalState = emotionalState ?? null;
  }

  /** Set or update the emotional state engine reference. */
  setEmotionalState(engine: EmotionalStateEngine): void {
    this.emotionalState = engine;
  }

  /**
   * Called when a learning episode is created.
   * Creates a memory token for the episode and runs a spiral pass.
   */
  onEpisode(episode: LearningEpisode): SpiralPassResult {
    const token = this.tokenManager.createFromEpisode(episode);
    return this.spiralLoop.spiralPass(token);
  }

  /**
   * Called when an insight is generated.
   * Creates a high-level memory token and runs a spiral pass.
   */
  onInsight(insight: Insight): SpiralPassResult {
    const token = this.tokenManager.createFromInsight(insight);
    return this.spiralLoop.spiralPass(token);
  }

  /**
   * Called when a belief is updated.
   * Creates or updates a memory token for the belief and runs a spiral pass.
   */
  onBeliefUpdate(belief: Belief): SpiralPassResult {
    const token = this.tokenManager.createFromBelief(belief);
    return this.spiralLoop.spiralPass(token);
  }

  /**
   * Called when a conversation turn is saved.
   * Creates a memory token for the turn and runs a spiral pass.
   */
  onConversationTurn(turn: ConversationTurn): SpiralPassResult {
    const token = this.tokenManager.createFromTurn(turn);

    // Update emotional state from the token's essence
    if (this.emotionalState) {
      this.emotionalState.updateFromEssence(token.essence, token.id);
    }

    return this.spiralLoop.spiralPass(token);
  }
}
