/**
 * Tests for SPARK diagnose and compare intents.
 */
import { Database, SparkStore } from '@ai-operations/ops-storage';
import type { LearningEpisode } from '@ai-operations/shared-types';
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
