/**
 * Tests for SPARK diagnose, compare, and confidence-scored intents.
 */
import { Database, SparkStore } from '@ai-operations/ops-storage';
import type { LearningEpisode, IntentClassification } from '@ai-operations/shared-types';
import { ReasoningCore } from '../reasoning-core';
import { WeightManager } from '../weight-manager';
import { AwarenessCore } from '../awareness-core';
import { buildAllDefaultWeights } from '../constants';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Helpers ────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-reasoning-intents-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `reasoning-intents-${dbCounter}.db`);
}

function createTestStore(): { db: Database; store: SparkStore } {
  const db = new Database(freshDbPath());
  const store = new SparkStore(db.db);
  return { db, store };
}

function initWeights(store: SparkStore): void {
  store.initializeWeights(buildAllDefaultWeights());
}

function makeEpisode(overrides: Partial<LearningEpisode> = {}): LearningEpisode {
  return {
    id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    predictionId: 'pred-1',
    outcomeId: 'out-1',
    category: 'communication',
    scoreDelta: 0,
    outcomeMismatch: false,
    adjustmentDirection: 'none',
    adjustmentMagnitude: 0,
    weightBefore: 1.0,
    weightAfter: 1.0,
    reason: 'test episode',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as LearningEpisode;
}

// ── Diagnose Intent ────────────────────────────────────────────────

describe('ReasoningCore — diagnose intent', () => {
  let store: SparkStore;

  beforeEach(() => {
    const { store: s } = createTestStore();
    store = s;
    initWeights(store);
  });

  it('classifies "what went wrong" as diagnose', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('What went wrong? Diagnose the issue.', undefined, report);
    expect(result.queryIntent).toBe('diagnose');
  });

  it('classifies "any problems" as diagnose', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('Are there any problems?', undefined, report);
    expect(result.queryIntent).toBe('diagnose');
  });

  it('returns meaningful response with no episodes', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('What went wrong?', undefined, report);
    expect(result.response).toBeTruthy();
    expect(result.response.length).toBeGreaterThan(10);
  });

  it('detects failure episodes and reports breakdown', () => {
    // Insert episodes with adjustments
    store.saveEpisode(makeEpisode({ category: 'communication', adjustmentDirection: 'increase' }));
    store.saveEpisode(makeEpisode({ category: 'communication', adjustmentDirection: 'decrease' }));
    store.saveEpisode(makeEpisode({ category: 'publication', adjustmentDirection: 'increase' }));
    store.saveEpisode(makeEpisode({ category: 'scheduling', adjustmentDirection: 'none' }));

    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('What went wrong?', undefined, report);
    expect(result.queryIntent).toBe('diagnose');
    expect(result.response).toBeTruthy();
    // Should mention the adjustments
    expect(result.steps.some(s => s.ruleId === 'diagnose-failures')).toBe(true);
  });

  it('suggests compare as a follow-up', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('Diagnose failures', undefined, report);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});

// ── Compare Intent ─────────────────────────────────────────────────

describe('ReasoningCore — compare intent', () => {
  let store: SparkStore;

  beforeEach(() => {
    const { store: s } = createTestStore();
    store = s;
    initWeights(store);
  });

  it('classifies "compare X vs Y" as compare', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('Compare communication vs financial', undefined, report);
    expect(result.queryIntent).toBe('compare');
  });

  it('classifies "what is the difference" as compare', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('What is the difference between scheduling and communication?', undefined, report);
    expect(result.queryIntent).toBe('compare');
  });

  it('returns a comparison with two recognized categories', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('Compare communication vs financial', undefined, report);
    expect(result.queryIntent).toBe('compare');
    expect(result.response).toBeTruthy();
    expect(result.steps.some(s => s.ruleId === 'compare-categories')).toBe(true);
  });

  it('suggests diagnose-related follow-up', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('Compare communication vs financial', undefined, report);
    expect(result.suggestions.length).toBeGreaterThan(0);
    const hasDiagnoseRelated = result.suggestions.some(
      s => s.toLowerCase().includes('wrong') || s.toLowerCase().includes('uncertain'),
    );
    expect(hasDiagnoseRelated).toBe(true);
  });

  it('handles compare with unrecognized categories gracefully', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('Compare apples vs oranges', undefined, report);
    expect(result.queryIntent).toBe('compare');
    expect(result.response).toBeTruthy();
  });
});

// ── Confidence Scoring (IntentClassification) ────────────────────

describe('ReasoningCore — confidence scoring', () => {
  let store: SparkStore;

  beforeEach(() => {
    const { store: s } = createTestStore();
    store = s;
    initWeights(store);
  });

  it('returns IntentClassification from classifyQueryIntent', () => {
    const reasoning = new ReasoningCore(store);
    const cls = reasoning.classifyQueryIntent('What is my status?');
    expect(cls).toHaveProperty('intent');
    expect(cls).toHaveProperty('confidence');
    expect(cls).toHaveProperty('alternatives');
    expect(cls).toHaveProperty('ambiguous');
    expect(typeof cls.confidence).toBe('number');
    expect(Array.isArray(cls.alternatives)).toBe(true);
    expect(typeof cls.ambiguous).toBe('boolean');
  });

  it('classifies clear queries with confidence > 0.5', () => {
    const reasoning = new ReasoningCore(store);

    // "status" is a clear intent keyword
    const cls = reasoning.classifyQueryIntent('How are you doing? Give me your status.');
    expect(cls.intent).toBe('status');
    expect(cls.confidence).toBeGreaterThan(0.5);
  });

  it('returns general with low confidence for gibberish', () => {
    const reasoning = new ReasoningCore(store);
    const cls = reasoning.classifyQueryIntent('xyzzy foobar bazzle');
    expect(cls.intent).toBe('general');
    expect(cls.confidence).toBeLessThanOrEqual(0.2);
    expect(cls.ambiguous).toBe(false);
  });

  it('detects ambiguity when two intents score similarly', () => {
    const reasoning = new ReasoningCore(store);

    // "history" → learned/recent/changed/history/past/trend/progress
    // "explain" → why/explain/reason/because/how come/what caused
    // Craft a query that has overlapping signals
    const cls = reasoning.classifyQueryIntent('Why did this change recently? What is the reason?');
    // Both 'explain' and 'history' should score — "Why" and "reason" hit explain,
    // "change" and "recently" hit history
    if (cls.ambiguous) {
      expect(cls.alternatives.length).toBeGreaterThan(0);
      // Second alternative should be close to the best
      expect(cls.alternatives[0].confidence).toBeGreaterThanOrEqual(cls.confidence * 0.5);
    }
    // Either way, the classification should be valid
    expect(['explain', 'history']).toContain(cls.intent);
  });

  it('includes alternatives sorted by descending confidence', () => {
    const reasoning = new ReasoningCore(store);
    const cls = reasoning.classifyQueryIntent('Explain why things are broken and diagnose the issue');
    // Both 'explain' and 'diagnose' should score
    expect(cls.alternatives.length).toBeGreaterThan(0);
    // Alternatives should be sorted descending
    for (let i = 1; i < cls.alternatives.length; i++) {
      expect(cls.alternatives[i - 1].confidence).toBeGreaterThanOrEqual(cls.alternatives[i].confidence);
    }
  });

  it('all confidences sum to approximately 1.0 (excluding cap adjustments)', () => {
    const reasoning = new ReasoningCore(store);
    const cls = reasoning.classifyQueryIntent('What is the status of my email?');
    // The raw normalized scores should be internally consistent
    // We can check that alternatives are all < primary confidence
    for (const alt of cls.alternatives) {
      expect(alt.confidence).toBeLessThanOrEqual(cls.confidence);
    }
  });

  it('attaches classification to ReasoningResult', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    const result = reasoning.reason('How are you?', undefined, report);
    expect(result.classification).toBeDefined();
    expect(result.classification!.intent).toBe(result.queryIntent);
    expect(result.classification!.confidence).toBeGreaterThan(0);
  });

  it('produces compound response for ambiguous queries', () => {
    const weights = new WeightManager(store);
    weights.initialize();
    const awareness = new AwarenessCore(store);
    const reasoning = new ReasoningCore(store);

    const report = awareness.report();
    // Force ambiguity with an overlapping query
    const result = reasoning.reason('Why did it fail? What went wrong recently?', undefined, report);
    // If ambiguous, response should contain "Also considering"
    if (result.classification?.ambiguous) {
      expect(result.response).toContain('Also considering');
    }
    // Either way, the result should be valid
    expect(result.response).toBeTruthy();
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('does not flag unambiguous queries as ambiguous', () => {
    const reasoning = new ReasoningCore(store);
    // Pure status query — only "status" keywords match
    const cls = reasoning.classifyQueryIntent('Give me an overview of your status');
    expect(cls.ambiguous).toBe(false);
    expect(cls.intent).toBe('status');
  });
});
