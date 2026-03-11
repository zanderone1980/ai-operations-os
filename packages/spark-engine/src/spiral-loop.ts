/**
 * SpiralLoop — Spiral Refinement Engine for SPARK Memory.
 *
 * The core spiral mechanism. On each new memory token:
 * - Find related tokens via topic similarity
 * - Reinforce matching tokens (strength grows)
 * - Weaken contradicted tokens (strength decays)
 * - Discover new edges between related tokens
 * - Apply passive decay over time
 */

import { randomUUID } from 'node:crypto';
import type { SparkStore } from '@ai-operations/ops-storage';
import type { MemoryToken, MemoryEdge, Essence } from '@ai-operations/shared-types';
import { EssenceExtractor } from './essence-extractor';
import { MemoryTokenManager } from './memory-token-manager';
import {
  REINFORCE_RATE,
  DECAY_RATE,
  PASSIVE_DECAY_PER_DAY,
  TOKEN_DECAY_RATE,
  EDGE_REINFORCE_RATE,
  EDGE_DECAY_RATE,
  EDGE_PRUNE_THRESHOLD,
  MIN_SIMILARITY_THRESHOLD,
  MAX_CONNECTIONS_PER_PASS,
  ARCHIVE_STRENGTH_THRESHOLD,
} from './spiral-constants';

export interface SpiralPassResult {
  tokensReinforced: number;
  tokensWeakened: number;
  edgesCreated: number;
  edgesReinforced: number;
}

export interface SpiralMaintenanceResult {
  tokensDecayed: number;
  tokensArchived: number;
  tiersUpdated: number;
  edgesDecayed: number;
  edgesPruned: number;
  tokensMerged: number;
}

export class SpiralLoop {
  private readonly store: SparkStore;
  private readonly tokenManager: MemoryTokenManager;
  private readonly extractor: EssenceExtractor;

  constructor(store: SparkStore, tokenManager: MemoryTokenManager, extractor: EssenceExtractor) {
    this.store = store;
    this.tokenManager = tokenManager;
    this.extractor = extractor;
  }

  /**
   * Run a spiral pass triggered by a new memory token.
   * Finds related tokens, reinforces/weakens them, creates edges.
   */
  spiralPass(newToken: MemoryToken): SpiralPassResult {
    const result: SpiralPassResult = {
      tokensReinforced: 0,
      tokensWeakened: 0,
      edgesCreated: 0,
      edgesReinforced: 0,
    };

    // Find related tokens by topic overlap
    const relatedTokens = this.findRelatedTokens(newToken, 20);
    if (relatedTokens.length === 0) return result;

    const now = new Date().toISOString();
    let edgesCreatedThisPass = 0;

    for (const related of relatedTokens) {
      if (related.id === newToken.id) continue;

      const similarity = this.computeTopicSimilarity(newToken.essence, related.essence);
      if (similarity < MIN_SIMILARITY_THRESHOLD) continue;

      const contradiction = this.detectContradiction(newToken.essence, related.essence);

      if (contradiction > 0.5) {
        // Weaken contradicted token
        this.weakenToken(related, contradiction, now);
        result.tokensWeakened++;
      } else {
        // Reinforce matching token
        this.reinforceToken(related, similarity, now);
        result.tokensReinforced++;
      }

      // Edge management
      const existingEdges = this.store.getEdgesBetween(newToken.id, related.id);
      if (existingEdges.length > 0) {
        // Reinforce existing edge
        const edge = existingEdges[0];
        const newWeight = Math.min(1.0, edge.weight + EDGE_REINFORCE_RATE * (1 - edge.weight));
        this.store.reinforceEdge(edge.id, newWeight, edge.reinforceCount + 1, now);
        result.edgesReinforced++;
      } else if (edgesCreatedThisPass < MAX_CONNECTIONS_PER_PASS && similarity >= MIN_SIMILARITY_THRESHOLD) {
        // Create new edge
        const edge: MemoryEdge = {
          id: randomUUID(),
          fromTokenId: newToken.id,
          toTokenId: related.id,
          type: this.inferEdgeType(newToken, related),
          weight: similarity,
          reinforceCount: 1,
          createdAt: now,
          lastReinforcedAt: now,
        };
        this.store.saveMemoryEdge(edge);
        result.edgesCreated++;
        edgesCreatedThisPass++;
      }
    }

    return result;
  }

  /**
   * Run a background maintenance spiral.
   * Applies exponential token decay, exponential edge decay + pruning,
   * auto-merge of similar same-type tokens, tier updates, and archival.
   */
  maintenancePass(): SpiralMaintenanceResult {
    const result: SpiralMaintenanceResult = {
      tokensDecayed: 0,
      tokensArchived: 0,
      tiersUpdated: 0,
      edgesDecayed: 0,
      edgesPruned: 0,
      tokensMerged: 0,
    };

    const now = new Date();
    const nowIso = now.toISOString();
    const activeTokens = this.store.listMemoryTokens({ excludeArchived: true, limit: 1000 });

    // ── Token decay (exponential) ──
    for (const token of activeTokens) {
      const daysSinceSpiral = (now.getTime() - new Date(token.lastSpiralAt).getTime()) / (24 * 60 * 60 * 1000);

      if (daysSinceSpiral > 0.01) { // More than ~15 minutes
        // Exponential decay: strength *= exp(-TOKEN_DECAY_RATE * days)
        const decayFactor = Math.exp(-TOKEN_DECAY_RATE * daysSinceSpiral);
        const newStrength = Math.max(0, token.strength * decayFactor);

        if (newStrength < ARCHIVE_STRENGTH_THRESHOLD) {
          this.store.archiveMemoryToken(token.id, nowIso);
          result.tokensArchived++;
        } else {
          this.store.updateMemoryTokenStrength(token.id, newStrength, token.spiralCount, nowIso);
          result.tokensDecayed++;
        }
      }
    }

    // ── Edge decay (exponential) + pruning ──
    const allEdges = this.store.listMemoryEdges({ limit: 5000 });
    for (const edge of allEdges) {
      const daysSinceReinforced = (now.getTime() - new Date(edge.lastReinforcedAt).getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceReinforced > 0.01) {
        const decayedWeight = edge.weight * Math.exp(-EDGE_DECAY_RATE * daysSinceReinforced);
        if (decayedWeight < EDGE_PRUNE_THRESHOLD) {
          this.store.deleteMemoryEdge(edge.id);
          result.edgesPruned++;
        } else {
          this.store.reinforceEdge(edge.id, decayedWeight, edge.reinforceCount, edge.lastReinforcedAt);
          result.edgesDecayed++;
        }
      }
    }

    // ── Auto-merge similar same-type tokens ──
    result.tokensMerged = this.tokenManager.autoMerge(this);

    // ── Update tiers ──
    result.tiersUpdated = this.tokenManager.updateTiers();

    return result;
  }

  /**
   * Compute weighted cosine similarity between two essence topic vectors.
   * Topics are weighted by TF-IDF scores from the topic index, so rare
   * shared terms score higher than common ones ("the" matching "the"
   * counts less than "email" matching "email").
   */
  computeTopicSimilarity(a: Essence, b: Essence): number {
    if (a.topics.length === 0 || b.topics.length === 0) return 0;

    // Gather all unique topics and their TF-IDF weights
    const allTopics = [...new Set([...a.topics, ...b.topics])];
    const totalDocs = Math.max(1, this.store.getTopicDocumentCount());
    const dfs = this.store.getDocumentFrequencies(allTopics);

    // Build weighted vectors
    const weightsA = new Map<string, number>();
    const weightsB = new Map<string, number>();

    for (const topic of a.topics) {
      const df = dfs.get(topic) ?? 0;
      const idf = Math.log(totalDocs / (1 + df));
      weightsA.set(topic, Math.max(idf, 0.1));
    }
    for (const topic of b.topics) {
      const df = dfs.get(topic) ?? 0;
      const idf = Math.log(totalDocs / (1 + df));
      weightsB.set(topic, Math.max(idf, 0.1));
    }

    // Cosine similarity: Σ(w_a · w_b) / (||w_a|| · ||w_b||)
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const topic of allTopics) {
      const wa = weightsA.get(topic) ?? 0;
      const wb = weightsB.get(topic) ?? 0;
      dotProduct += wa * wb;
      normA += wa * wa;
      normB += wb * wb;
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ── Private ────────────────────────────────────────────────────

  private findRelatedTokens(token: MemoryToken, limit: number): MemoryToken[] {
    if (token.essence.topics.length === 0) return [];
    return this.store.findTokensByTopics(token.essence.topics, limit);
  }

  private detectContradiction(a: Essence, b: Essence): number {
    // Sentiment opposition with topic overlap indicates contradiction
    const topicOverlap = this.computeTopicSimilarity(a, b);
    if (topicOverlap < MIN_SIMILARITY_THRESHOLD) return 0;

    const sentimentA = a.sentiment === 'positive' ? 1 : a.sentiment === 'negative' ? -1 : 0;
    const sentimentB = b.sentiment === 'positive' ? 1 : b.sentiment === 'negative' ? -1 : 0;

    // Strong contradiction: same topics, opposite sentiment
    if (sentimentA !== 0 && sentimentB !== 0 && sentimentA !== sentimentB) {
      return topicOverlap * 0.8;
    }

    return 0;
  }

  private reinforceToken(token: MemoryToken, matchScore: number, now: string): void {
    // strength += REINFORCE_RATE * (1 - strength) * matchScore
    const boost = REINFORCE_RATE * (1 - token.strength) * matchScore;
    const newStrength = Math.min(1.0, token.strength + boost);
    this.store.updateMemoryTokenStrength(token.id, newStrength, token.spiralCount + 1, now);
  }

  private weakenToken(token: MemoryToken, contradictionScore: number, now: string): void {
    // strength *= (1 - DECAY_RATE * contradictionScore)
    const newStrength = Math.max(0, token.strength * (1 - DECAY_RATE * contradictionScore));
    this.store.updateMemoryTokenStrength(token.id, newStrength, token.spiralCount + 1, now);
  }

  private inferEdgeType(a: MemoryToken, b: MemoryToken): string {
    // Infer edge type from token types
    if (a.type === b.type) return 'same-type';
    if (a.type === 'episode' && b.type === 'insight') return 'episode-to-insight';
    if (a.type === 'conversation' && b.type === 'episode') return 'conversation-to-episode';
    if (a.type === 'belief' && b.type === 'episode') return 'belief-to-episode';
    return 'related';
  }
}
