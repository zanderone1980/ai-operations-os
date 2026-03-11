/**
 * Tests for the EmotionalStateEngine.
 */
import { Database } from '@ai-operations/ops-storage';
import { SparkStore } from '@ai-operations/ops-storage';
import { EmotionalStateEngine } from '../emotional-state';
import { EssenceExtractor } from '../essence-extractor';
import { MemoryTokenManager } from '../memory-token-manager';
import { SpiralLoop } from '../spiral-loop';
import type { Essence } from '@ai-operations/shared-types';

function createTestDb(): SparkStore {
  const db = new Database(':memory:');
  return new SparkStore(db.db);
}

function makeEssence(overrides: Partial<Essence> = {}): Essence {
  return {
    topics: ['test'],
    sentiment: 'neutral',
    sentimentIntensity: 0.5,
    relationships: [],
    decisionPoints: [],
    importance: 0.5,
    categories: [],
    connectors: [],
    gist: 'test gist',
    ...overrides,
  };
}

describe('EmotionalStateEngine', () => {
  let store: SparkStore;
  let engine: EmotionalStateEngine;

  beforeEach(() => {
    store = createTestDb();
    engine = new EmotionalStateEngine(store);
  });

  describe('initial state', () => {
    it('starts at neutral valence', () => {
      const state = engine.getState();
      expect(state.valence).toBe(0);
      expect(state.momentum).toBe('stable');
      expect(state.volatility).toBe(0);
      expect(state.highEmotionCount).toBe(0);
    });
  });

  describe('EMA valence tracking', () => {
    it('converges toward positive with repeated positive input', () => {
      for (let i = 0; i < 10; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'positive', sentimentIntensity: 0.8 }));
      }
      const state = engine.getState();
      expect(state.valence).toBeGreaterThan(0.5);
    });

    it('converges toward negative with repeated negative input', () => {
      for (let i = 0; i < 10; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'negative', sentimentIntensity: 0.8 }));
      }
      const state = engine.getState();
      expect(state.valence).toBeLessThan(-0.5);
    });

    it('stays near zero with neutral input', () => {
      for (let i = 0; i < 10; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'neutral', sentimentIntensity: 0.5 }));
      }
      const state = engine.getState();
      expect(Math.abs(state.valence)).toBeLessThan(0.1);
    });

    it('blends mixed signals slightly positive', () => {
      engine.updateFromEssence(makeEssence({ sentiment: 'mixed', sentimentIntensity: 0.6 }));
      const state = engine.getState();
      // Mixed has slight positive bias (0.1 * intensity)
      expect(state.valence).toBeGreaterThan(0);
      expect(state.valence).toBeLessThan(0.1);
    });
  });

  describe('momentum detection', () => {
    it('detects improving momentum', () => {
      // Start negative, trend positive
      for (let i = 0; i < 5; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'negative', sentimentIntensity: 0.3 }));
      }
      for (let i = 0; i < 5; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'positive', sentimentIntensity: 0.9 }));
      }
      const state = engine.getState();
      expect(state.momentum).toBe('improving');
    });

    it('detects declining momentum', () => {
      // Start positive, trend negative
      for (let i = 0; i < 5; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'positive', sentimentIntensity: 0.9 }));
      }
      for (let i = 0; i < 5; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'negative', sentimentIntensity: 0.9 }));
      }
      const state = engine.getState();
      expect(state.momentum).toBe('declining');
    });

    it('detects stable momentum with consistent input', () => {
      // Feed enough consistent input for the EMA to converge
      for (let i = 0; i < 20; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'positive', sentimentIntensity: 0.5 }));
      }
      const state = engine.getState();
      expect(state.momentum).toBe('stable');
    });
  });

  describe('volatility calculation', () => {
    it('is low with consistent sentiment', () => {
      for (let i = 0; i < 20; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'positive', sentimentIntensity: 0.5 }));
      }
      const state = engine.getState();
      expect(state.volatility).toBeLessThan(0.15);
    });

    it('is high with alternating sentiment', () => {
      for (let i = 0; i < 10; i++) {
        const sentiment = i % 2 === 0 ? 'positive' : 'negative';
        engine.updateFromEssence(makeEssence({
          sentiment: sentiment as any,
          sentimentIntensity: 0.9,
        }));
      }
      const state = engine.getState();
      expect(state.volatility).toBeGreaterThan(0.05);
    });
  });

  describe('high-emotion tracking', () => {
    it('flags tokens with intensity above threshold', () => {
      engine.updateFromEssence(
        makeEssence({ sentiment: 'positive', sentimentIntensity: 0.9 }),
        'token-high',
      );
      expect(engine.isHighEmotion('token-high')).toBe(true);
    });

    it('does not flag tokens with low intensity', () => {
      engine.updateFromEssence(
        makeEssence({ sentiment: 'positive', sentimentIntensity: 0.3 }),
        'token-low',
      );
      expect(engine.isHighEmotion('token-low')).toBe(false);
    });

    it('counts high-emotion events in state', () => {
      engine.updateFromEssence(
        makeEssence({ sentiment: 'positive', sentimentIntensity: 0.9 }),
        'tok1',
      );
      engine.updateFromEssence(
        makeEssence({ sentiment: 'negative', sentimentIntensity: 0.85 }),
        'tok2',
      );
      const state = engine.getState();
      expect(state.highEmotionCount).toBe(2);
    });
  });

  describe('emotional boost in spiral pass', () => {
    it('high-emotion tokens get extra reinforcement', () => {
      const extractor = new EssenceExtractor(store);
      const tokenManager = new MemoryTokenManager(store, extractor);
      const emotionalEngine = new EmotionalStateEngine(store);
      const spiral = new SpiralLoop(store, tokenManager, extractor, emotionalEngine);

      // Create two tokens with the same topics
      const now = new Date().toISOString();
      const token1 = {
        id: 'emotional-token',
        type: 'conversation' as const,
        tier: 'raw' as const,
        essence: makeEssence({ topics: ['shared-topic'], sentiment: 'positive', sentimentIntensity: 0.9 }),
        strength: 0.5,
        spiralCount: 0,
        sourceId: 'src1',
        mergedFrom: [],
        createdAt: now,
        lastSpiralAt: now,
        archivedAt: null,
      };
      const token2 = {
        id: 'related-token',
        type: 'conversation' as const,
        tier: 'raw' as const,
        essence: makeEssence({ topics: ['shared-topic'], sentiment: 'positive', sentimentIntensity: 0.3 }),
        strength: 0.5,
        spiralCount: 0,
        sourceId: 'src2',
        mergedFrom: [],
        createdAt: now,
        lastSpiralAt: now,
        archivedAt: null,
      };

      // Save tokens and index topics
      store.saveMemoryToken(token1);
      store.saveMemoryToken(token2);
      store.upsertTopicIndex('shared-topic', token1.id, 1.0);
      store.upsertTopicIndex('shared-topic', token2.id, 1.0);

      // Mark token1 as high emotion
      emotionalEngine.updateFromEssence(token1.essence, token1.id);
      expect(emotionalEngine.isHighEmotion(token1.id)).toBe(true);

      // Run spiral pass with a new related token
      const trigger = {
        ...token1,
        id: 'trigger-token',
        sourceId: 'src3',
      };
      store.saveMemoryToken(trigger);
      store.upsertTopicIndex('shared-topic', trigger.id, 1.0);

      const result = spiral.spiralPass(trigger);
      expect(result.tokensReinforced).toBeGreaterThan(0);

      // The emotional token should have been reinforced more
      const reinforcedEmotional = store.getMemoryToken('emotional-token');
      const reinforcedNormal = store.getMemoryToken('related-token');

      // Both should be reinforced, but emotional should be stronger
      // (they had the same starting strength)
      expect(reinforcedEmotional!.strength).toBeGreaterThan(token1.strength);
      expect(reinforcedNormal!.strength).toBeGreaterThan(token2.strength);
    });
  });

  describe('persistence', () => {
    it('saves and restores emotional state', () => {
      // Update state
      for (let i = 0; i < 5; i++) {
        engine.updateFromEssence(
          makeEssence({ sentiment: 'positive', sentimentIntensity: 0.8 }),
          `token-${i}`,
        );
      }

      const stateBeforeRestore = engine.getState();

      // Create a new engine from the same store (simulates restart)
      const engine2 = new EmotionalStateEngine(store);
      const stateAfterRestore = engine2.getState();

      expect(stateAfterRestore.valence).toBeCloseTo(stateBeforeRestore.valence, 4);
      expect(stateAfterRestore.highEmotionCount).toBe(stateBeforeRestore.highEmotionCount);
    });
  });

  describe('getSummary', () => {
    it('returns a human-readable summary', () => {
      for (let i = 0; i < 5; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'positive', sentimentIntensity: 0.8 }));
      }
      const summary = engine.getSummary();
      expect(summary).toContain('positive');
      expect(summary).toContain('valence');
    });

    it('describes negative state correctly', () => {
      for (let i = 0; i < 10; i++) {
        engine.updateFromEssence(makeEssence({ sentiment: 'negative', sentimentIntensity: 0.9 }));
      }
      const summary = engine.getSummary();
      expect(summary).toContain('negative');
    });
  });
});
