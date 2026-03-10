/**
 * ContextReconstructor — Graph-walk Context Reconstruction for SPARK.
 *
 * Replaces raw turn loading in ReasoningCore. Instead of loading the
 * last N conversation turns verbatim, reconstructs relevant context
 * by following essence threads through the memory token graph.
 */

import type { SparkStore } from '@ai-operations/ops-storage';
import type {
  MemoryToken,
  Essence,
  ReconstructedContext,
  SentimentValence,
  DecisionPoint,
  SparkCategory,
  CompressionTier,
} from '@ai-operations/shared-types';
import { EssenceExtractor } from './essence-extractor';
import {
  MAX_GRAPH_DEPTH,
  MAX_CONTEXT_TOKENS,
  TIER_WEIGHTS,
} from './spiral-constants';

export class ContextReconstructor {
  private readonly store: SparkStore;
  private readonly extractor: EssenceExtractor;

  constructor(store: SparkStore, extractor: EssenceExtractor) {
    this.store = store;
    this.extractor = extractor;
  }

  /**
   * Reconstruct context relevant to a query.
   * This replaces raw turn loading for enriched context.
   */
  reconstruct(query: string, options?: {
    maxTokens?: number;
    maxDepth?: number;
    categories?: SparkCategory[];
  }): ReconstructedContext {
    const maxTokens = options?.maxTokens ?? MAX_CONTEXT_TOKENS;
    const maxDepth = options?.maxDepth ?? MAX_GRAPH_DEPTH;

    // Extract essence from the query
    const queryEssence = this.extractor.extract(query, {
      categories: options?.categories,
    });

    if (queryEssence.topics.length === 0) {
      return this.emptyContext();
    }

    // Find seed tokens via topic index
    const seedTokens = this.store.findTokensByTopics(queryEssence.topics, maxTokens);
    if (seedTokens.length === 0) {
      return this.emptyContext();
    }

    // Walk the graph from seed tokens (BFS)
    const seedIds = seedTokens.map(t => t.id);
    const reached = this.walkGraph(seedIds, maxDepth);

    // Score all reached tokens
    const scored: Array<{ token: MemoryToken; score: number; depth: number }> = [];
    for (const [_id, { token, depth }] of reached) {
      const score = this.scoreToken(token, queryEssence, depth);
      scored.push({ token, score, depth });
    }

    // Take top N by score
    scored.sort((a, b) => b.score - a.score);
    const topTokens = scored.slice(0, maxTokens);

    if (topTokens.length === 0) {
      return this.emptyContext();
    }

    // Sort chronologically for narrative
    topTokens.sort((a, b) => a.token.createdAt.localeCompare(b.token.createdAt));

    // Build narrative from gists
    const narrative = this.buildNarrative(topTokens.map(t => t.token));

    // Collect edge IDs used in graph walk
    const tokenIds = topTokens.map(t => t.token.id);
    const edgeIds: string[] = [];
    for (const id of tokenIds) {
      const edges = this.store.getEdgesForToken(id);
      for (const edge of edges) {
        if (tokenIds.includes(edge.fromTokenId) && tokenIds.includes(edge.toTokenId)) {
          edgeIds.push(edge.id);
        }
      }
    }

    // Aggregate decisions
    const relevantDecisions: DecisionPoint[] = topTokens
      .flatMap(t => t.token.essence.decisionPoints);

    // Overall sentiment (weighted average)
    const overallSentiment = this.computeOverallSentiment(topTokens.map(t => t.token));

    // Confidence based on token count and strength
    const avgStrength = topTokens.reduce((s, t) => s + t.token.strength, 0) / topTokens.length;
    const confidence = Math.min(1.0, avgStrength * (topTokens.length / maxTokens));

    return {
      narrative,
      tokenIds,
      edgeIds: [...new Set(edgeIds)],
      relevantTopics: queryEssence.topics,
      overallSentiment,
      relevantDecisions,
      confidence,
    };
  }

  /**
   * Build a narrative text from a set of memory tokens.
   */
  buildNarrative(tokens: MemoryToken[]): string {
    if (tokens.length === 0) return '';

    return tokens
      .map(t => t.essence.gist)
      .filter(g => g && g.length > 0)
      .join('. ')
      .replace(/\.\./g, '.') + '.';
  }

  // ── Private ────────────────────────────────────────────────────

  private walkGraph(
    seedTokenIds: string[],
    maxDepth: number,
  ): Map<string, { token: MemoryToken; depth: number }> {
    const visited = new Map<string, { token: MemoryToken; depth: number }>();
    const queue: Array<{ id: string; depth: number }> = [];

    // Initialize with seed tokens
    for (const id of seedTokenIds) {
      const token = this.store.getMemoryToken(id);
      if (token && !token.archivedAt) {
        visited.set(id, { token, depth: 0 });
        queue.push({ id, depth: 0 });
      }
    }

    // BFS walk
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const edges = this.store.getEdgesForToken(id);
      for (const edge of edges) {
        const neighborId = edge.fromTokenId === id ? edge.toTokenId : edge.fromTokenId;
        if (visited.has(neighborId)) continue;

        const neighbor = this.store.getMemoryToken(neighborId);
        if (!neighbor || neighbor.archivedAt) continue;

        visited.set(neighborId, { token: neighbor, depth: depth + 1 });
        queue.push({ id: neighborId, depth: depth + 1 });
      }
    }

    return visited;
  }

  private scoreToken(token: MemoryToken, queryEssence: Essence, depth: number): number {
    // Topic similarity
    const topicSimilarity = this.computeTopicSimilarity(queryEssence, token.essence);

    // Tier weight
    const tierWeight = TIER_WEIGHTS[token.tier] ?? 0.5;

    // Depth penalty (deeper = less relevant)
    const depthPenalty = 1.0 / (1 + depth * 0.3);

    return topicSimilarity * token.strength * tierWeight * depthPenalty;
  }

  private computeTopicSimilarity(a: Essence, b: Essence): number {
    if (a.topics.length === 0 || b.topics.length === 0) return 0;

    const setA = new Set(a.topics);
    const setB = new Set(b.topics);
    let intersection = 0;
    for (const topic of setA) {
      if (setB.has(topic)) intersection++;
    }
    if (intersection === 0) return 0;

    const union = new Set([...setA, ...setB]).size;
    return intersection / union;
  }

  private computeOverallSentiment(tokens: MemoryToken[]): SentimentValence {
    let positive = 0;
    let negative = 0;
    let neutral = 0;

    for (const token of tokens) {
      if (token.essence.sentiment === 'positive') positive++;
      else if (token.essence.sentiment === 'negative') negative++;
      else neutral++;
    }

    if (positive > negative && positive > neutral) return 'positive';
    if (negative > positive && negative > neutral) return 'negative';
    if (positive > 0 && negative > 0) return 'mixed';
    return 'neutral';
  }

  private emptyContext(): ReconstructedContext {
    return {
      narrative: '',
      tokenIds: [],
      edgeIds: [],
      relevantTopics: [],
      overallSentiment: 'neutral',
      relevantDecisions: [],
      confidence: 0,
    };
  }
}
