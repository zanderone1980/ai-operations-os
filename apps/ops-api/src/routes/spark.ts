/**
 * SPARK Routes — Adaptive learning feedback loop API.
 *
 * GET    /api/spark/weights          Current SPARK weights for all categories
 * GET    /api/spark/weights/history  Weight change timeline
 * GET    /api/spark/episodes         Learning episodes (paginated)
 * GET    /api/spark/predictions      Recent predictions
 * GET    /api/spark/stats            Aggregate stats per category
 * POST   /api/spark/snapshot         Create manual weight snapshot
 * POST   /api/spark/rollback         Restore a weight snapshot
 * GET    /api/spark/snapshots        List available snapshots
 * GET    /api/spark/awareness        Full awareness self-report
 * GET    /api/spark/beliefs          Current beliefs per category
 * GET    /api/spark/insights         Recent learning insights
 */

import type { SparkCategory } from '@ai-operations/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import { stores } from '../storage';
import { WeightManager, AwarenessCore, MemoryCore, SparkOrchestrator } from '@ai-operations/spark-engine';
import { validateBody, sparkChatSchema } from '../middleware/validate';
import { ALL_CATEGORIES } from '@ai-operations/spark-engine';

// ── Singletons ────────────────────────────────────────────────────────────────

const weightManager = new WeightManager(stores.spark);
const awarenessCore = new AwarenessCore(stores.spark);
const memoryCore = new MemoryCore(stores.spark);
const orchestrator = new SparkOrchestrator(stores.spark);

// ── Route handlers ───────────────────────────────────────────────────────────

/** Get all current SPARK weights */
async function getWeights(ctx: any): Promise<void> {
  const { res } = ctx;

  weightManager.initialize();
  const weights = weightManager.getAllWeights();

  sendJson(res, 200, {
    weights: weights.weights,
    total: Object.keys(weights.weights).length,
    version: weights.version,
  });
}

/** Get weight change history timeline */
async function getWeightHistory(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const limit = parseInt(query.limit || '50', 10);
  const category = query.category || undefined;

  const history = stores.spark.getHistory({ category, limit });

  sendJson(res, 200, {
    history,
    total: history.length,
  });
}

/** List learning episodes (paginated) */
async function listEpisodes(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const limit = parseInt(query.limit || '50', 10);
  const offset = parseInt(query.offset || '0', 10);
  const category = query.category || undefined;

  const episodes = stores.spark.listEpisodes({ category, limit, offset });
  const total = stores.spark.countEpisodes({ category });

  sendJson(res, 200, {
    episodes,
    total,
    limit,
    offset,
  });
}

/** List recent predictions */
async function listPredictions(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const limit = parseInt(query.limit || '50', 10);
  const runId = query.runId || undefined;
  const category = query.category || undefined;

  const predictions = stores.spark.listPredictions({ runId, category, limit });

  sendJson(res, 200, {
    predictions,
    total: predictions.length,
  });
}

/** Aggregate stats per category */
async function getStats(ctx: any): Promise<void> {
  const { res } = ctx;

  weightManager.initialize();
  const allWeights = weightManager.getAllWeights();
  const weightEntries = Object.values(allWeights.weights);

  const stats = weightEntries.map((w: any) => {
    const episodes = stores.spark.listEpisodes({ category: w.category });
    const episodeCount = stores.spark.countEpisodes({ category: w.category });

    // Calculate accuracy: episodes where adjustment was 'none' (prediction was correct)
    const correctPredictions = episodes.filter((ep) => ep.adjustmentDirection === 'none').length;
    const accuracy = episodeCount > 0
      ? Math.round((correctPredictions / episodeCount) * 1000) / 1000
      : 0;

    // Calculate drift: how far current weight has moved from base
    const drift = Math.round((w.currentWeight - w.baseWeight) * 10000) / 10000;

    return {
      category: w.category,
      currentWeight: w.currentWeight,
      baseWeight: w.baseWeight,
      drift,
      accuracy,
      episodeCount,
      lastAdjustedAt: w.lastAdjustedAt,
    };
  });

  sendJson(res, 200, {
    stats,
    categories: stats.length,
  });
}

/** Create a manual weight snapshot */
async function createSnapshot(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const reason = (body.reason as string) || 'Manual snapshot';

  const snapshotId = weightManager.createSnapshot(reason);

  sendJson(res, 201, {
    snapshotId,
    reason,
    createdAt: new Date().toISOString(),
  });
}

/** Restore weights from a snapshot */
async function rollbackSnapshot(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const snapshotId = body.snapshotId as string;
  if (!snapshotId) {
    sendError(res, 400, 'Missing required field: snapshotId');
    return;
  }

  try {
    weightManager.restoreSnapshot(snapshotId);
    const weights = weightManager.getAllWeights();

    sendJson(res, 200, {
      restored: true,
      snapshotId,
      weights,
    });
  } catch (err) {
    sendError(res, 404, err instanceof Error ? err.message : `Snapshot not found: ${snapshotId}`);
  }
}

/** List available snapshots */
async function listSnapshots(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const limit = parseInt(query.limit || '20', 10);
  const snapshots = stores.spark.listSnapshots(limit);

  sendJson(res, 200, {
    snapshots,
    total: snapshots.length,
  });
}

// ── Awareness ───────────────────────────────────────────────────────────────

/** Get full awareness self-report */
async function getAwareness(ctx: any): Promise<void> {
  const { res } = ctx;

  weightManager.initialize();
  const report = awarenessCore.report();
  const emotionalState = orchestrator.emotionalState.getState();

  sendJson(res, 200, {
    ...report,
    emotionalState,
  });
}

/** Get current emotional state */
async function getEmotionalState(ctx: any): Promise<void> {
  const { res } = ctx;
  const state = orchestrator.emotionalState.getState();
  const summary = orchestrator.emotionalState.getSummary();
  sendJson(res, 200, { ...state, summary });
}

/** Get current beliefs per category */
async function getBeliefs(ctx: any): Promise<void> {
  const { res, query } = ctx;

  weightManager.initialize();
  const category = query.category || undefined;

  if (category) {
    const belief = awarenessCore.assess(category as SparkCategory);
    sendJson(res, 200, { beliefs: { [category]: belief } });
  } else {
    const beliefs = awarenessCore.assessAll();
    sendJson(res, 200, { beliefs });
  }
}

/** Get recent insights with optional filters */
async function getInsights(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const limit = parseInt(query.limit || '50', 10);
  const category = query.category || undefined;
  const pattern = query.pattern || undefined;
  const minImpact = query.minImpact ? parseFloat(query.minImpact) : undefined;

  const insights = stores.spark.listInsights({ category, pattern, limit, minImpact });

  sendJson(res, 200, {
    insights,
    total: insights.length,
  });
}

// ── Chat & Reasoning ────────────────────────────────────────────────────────

/**
 * POST /api/spark/chat — Conversational interface to SPARK.
 * Body: { message: string, conversationId?: string }
 */
async function chat(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const validation = validateBody(sparkChatSchema)(body);
  if (!validation.ok) {
    sendError(res, 400, validation.error);
    return;
  }

  const message = body.message as string;

  const conversationId = (body.conversationId as string) || undefined;

  weightManager.initialize();
  const result = orchestrator.chat(message, conversationId);

  sendJson(res, 200, {
    response: result.response,
    reasoning: result.steps,
    conversationId: (result as any).conversationId,
    suggestions: result.suggestions,
    queryIntent: result.queryIntent,
    createdAt: result.createdAt,
  });
}

/** GET /api/spark/conversations — List recent conversations. */
async function listConversations(ctx: any): Promise<void> {
  const { res, query } = ctx;
  const limit = parseInt(query.limit || '20', 10);
  const conversations = stores.spark.listRecentConversations(limit);
  sendJson(res, 200, { conversations, total: conversations.length });
}

/** GET /api/spark/conversations/:id — Get conversation history. */
async function getConversation(ctx: any): Promise<void> {
  const { res, params, query } = ctx;
  const conversationId = params.id;
  const limit = parseInt(query.limit || '50', 10);

  const conversation = stores.spark.getConversation(conversationId);
  if (!conversation) {
    sendError(res, 404, `Conversation not found: ${conversationId}`);
    return;
  }

  const turns = stores.spark.listTurns(conversationId, limit);
  sendJson(res, 200, { conversation, turns });
}

/** GET /api/spark/context — Cross-connector reasoning context. */
async function getCrossConnectorContext(ctx: any): Promise<void> {
  const { res } = ctx;
  weightManager.initialize();
  const report = awarenessCore.report();
  const context = orchestrator.reasoning.assembleCrossConnectorContext(report);
  sendJson(res, 200, context);
}

// ── Spiral Memory Routes ────────────────────────────────────────────────────

/** GET /api/spark/memory/tokens — List memory tokens. */
async function getMemoryTokens(ctx: any): Promise<void> {
  const { res, query } = ctx;
  const tokens = stores.spark.listMemoryTokens({
    type: query.type || undefined,
    tier: query.tier || undefined,
    minStrength: query.minStrength ? Number(query.minStrength) : undefined,
    excludeArchived: query.includeArchived !== 'true',
    limit: query.limit ? Number(query.limit) : 50,
  });
  sendJson(res, 200, { tokens, count: tokens.length });
}

/** GET /api/spark/memory/tokens/:id — Get a single token. */
async function getMemoryToken(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const token = stores.spark.getMemoryToken(params.id);
  if (!token) {
    sendError(res, 404, `Memory token not found: ${params.id}`);
    return;
  }
  sendJson(res, 200, token);
}

/** GET /api/spark/memory/edges — List memory edges. */
async function getMemoryEdges(ctx: any): Promise<void> {
  const { res, query } = ctx;
  const edges = stores.spark.listMemoryEdges({
    minWeight: query.minWeight ? Number(query.minWeight) : undefined,
    type: query.type || undefined,
    limit: query.limit ? Number(query.limit) : 50,
  });
  sendJson(res, 200, { edges, count: edges.length });
}

/** GET /api/spark/memory/graph — Full token graph for visualization. */
async function getMemoryGraph(ctx: any): Promise<void> {
  const { res } = ctx;
  const tokens = stores.spark.listMemoryTokens({ excludeArchived: true, limit: 200 });
  const edges = stores.spark.listMemoryEdges({ limit: 500 });
  sendJson(res, 200, {
    tokens: tokens.map(t => ({
      id: t.id,
      type: t.type,
      tier: t.tier,
      strength: t.strength,
      spiralCount: t.spiralCount,
      gist: t.essence.gist,
      topics: t.essence.topics,
      sentiment: t.essence.sentiment,
      createdAt: t.createdAt,
    })),
    edges: edges.map(e => ({
      id: e.id,
      from: e.fromTokenId,
      to: e.toTokenId,
      type: e.type,
      weight: e.weight,
    })),
    tokenCount: tokens.length,
    edgeCount: edges.length,
  });
}

/** GET /api/spark/memory/stats — Spiral memory statistics. */
async function getMemoryStats(ctx: any): Promise<void> {
  const { res } = ctx;
  const totalTokens = stores.spark.countMemoryTokens();
  const activeTokens = stores.spark.countMemoryTokens({ excludeArchived: true });
  const edges = stores.spark.listMemoryEdges({ limit: 1000 });
  const topicDocs = stores.spark.getTopicDocumentCount();

  sendJson(res, 200, {
    totalTokens,
    activeTokens,
    archivedTokens: totalTokens - activeTokens,
    totalEdges: edges.length,
    topicDocumentCount: topicDocs,
  });
}

/** POST /api/spark/memory/reconstruct — Debug context reconstruction. */
async function reconstructMemory(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const query = body?.query;
  if (!query || typeof query !== 'string') {
    sendError(res, 400, 'Missing "query" string in request body');
    return;
  }

  const result = orchestrator.reconstructor.reconstruct(query);
  sendJson(res, 200, result);
}

/** POST /api/spark/memory/maintenance — Trigger maintenance spiral pass. */
async function maintenancePass(ctx: any): Promise<void> {
  const { res } = ctx;
  const result = orchestrator.spiral.maintenancePass();

  // Tick reflection engine's maintenance counter and auto-reflect if due
  orchestrator.reflection.tickMaintenance();
  let reflectionTriggered = false;
  if (orchestrator.reflection.shouldAutoReflect()) {
    orchestrator.reflection.reflect();
    reflectionTriggered = true;
  }

  sendJson(res, 200, { ...result, reflectionTriggered });
}

// ── Reflection Routes ────────────────────────────────────────────────────────

/** POST /api/spark/reflect — Trigger manual self-reflection. */
async function triggerReflection(ctx: any): Promise<void> {
  const { res } = ctx;
  const result = orchestrator.reflection.reflect();
  sendJson(res, 200, result);
}

/** GET /api/spark/reflections — List past reflections. */
async function listReflections(ctx: any): Promise<void> {
  const { res, query } = ctx;
  const limit = parseInt(query.limit || '20', 10);
  const reflections = stores.spark.listReflections(limit);
  sendJson(res, 200, { reflections, total: reflections.length });
}

// ── Export routes ────────────────────────────────────────────────────────────

export { weightManager };

export const sparkRoutes: Route[] = [
  pathToRoute('GET', '/api/spark/weights', getWeights),
  pathToRoute('GET', '/api/spark/weights/history', getWeightHistory),
  pathToRoute('GET', '/api/spark/episodes', listEpisodes),
  pathToRoute('GET', '/api/spark/predictions', listPredictions),
  pathToRoute('GET', '/api/spark/stats', getStats),
  pathToRoute('POST', '/api/spark/snapshot', createSnapshot),
  pathToRoute('POST', '/api/spark/rollback', rollbackSnapshot),
  pathToRoute('GET', '/api/spark/snapshots', listSnapshots),
  pathToRoute('GET', '/api/spark/awareness', getAwareness),
  pathToRoute('GET', '/api/spark/emotional-state', getEmotionalState),
  pathToRoute('GET', '/api/spark/beliefs', getBeliefs),
  pathToRoute('GET', '/api/spark/insights', getInsights),
  pathToRoute('POST', '/api/spark/chat', chat),
  pathToRoute('GET', '/api/spark/conversations', listConversations),
  pathToRoute('GET', '/api/spark/conversations/:id', getConversation),
  pathToRoute('GET', '/api/spark/context', getCrossConnectorContext),
  // Spiral Memory
  pathToRoute('GET', '/api/spark/memory/tokens', getMemoryTokens),
  pathToRoute('GET', '/api/spark/memory/tokens/:id', getMemoryToken),
  pathToRoute('GET', '/api/spark/memory/edges', getMemoryEdges),
  pathToRoute('GET', '/api/spark/memory/graph', getMemoryGraph),
  pathToRoute('GET', '/api/spark/memory/stats', getMemoryStats),
  pathToRoute('POST', '/api/spark/memory/reconstruct', reconstructMemory),
  pathToRoute('POST', '/api/spark/memory/maintenance', maintenancePass),
  // Reflection
  pathToRoute('POST', '/api/spark/reflect', triggerReflection),
  pathToRoute('GET', '/api/spark/reflections', listReflections),
];
