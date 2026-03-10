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
 */

import type { SparkCategory } from '@ai-ops/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import { stores } from '../storage';
import { WeightManager } from '@ai-ops/spark-engine';
import { ALL_CATEGORIES } from '@ai-ops/spark-engine';

// ── Singletons ────────────────────────────────────────────────────────────────

const weightManager = new WeightManager(stores.spark);

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
];
