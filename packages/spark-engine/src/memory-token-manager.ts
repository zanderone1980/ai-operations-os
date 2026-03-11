/**
 * MemoryTokenManager — Token Lifecycle Management for Spiral Memory.
 *
 * Creates memory tokens from conversation turns, learning episodes,
 * insights, and beliefs. Manages tiering, archival, merging, and
 * topic index maintenance.
 */

import { randomUUID } from 'node:crypto';
import type { SparkStore } from '@ai-operations/ops-storage';
import type {
  MemoryToken,
  MemoryTokenType,
  CompressionTier,
  ConversationTurn,
  LearningEpisode,
  Insight,
  Belief,
  Essence,
} from '@ai-operations/shared-types';
import { EssenceExtractor } from './essence-extractor';
import {
  INITIAL_TOKEN_STRENGTH,
  ARCHIVE_STRENGTH_THRESHOLD,
  AUTO_MERGE_SIMILARITY_THRESHOLD,
  RAW_TIER_MS,
  RECENT_TIER_MS,
  COMPRESSED_TIER_MS,
} from './spiral-constants';

export class MemoryTokenManager {
  private readonly store: SparkStore;
  private readonly extractor: EssenceExtractor;

  constructor(store: SparkStore, extractor: EssenceExtractor) {
    this.store = store;
    this.extractor = extractor;
  }

  /**
   * Create a memory token from a conversation turn.
   */
  createFromTurn(turn: ConversationTurn): MemoryToken {
    const essence = this.extractor.extract(turn.content);
    const now = new Date().toISOString();
    const token: MemoryToken = {
      id: randomUUID(),
      type: 'conversation',
      tier: 'raw',
      essence,
      strength: INITIAL_TOKEN_STRENGTH,
      spiralCount: 0,
      sourceId: turn.id,
      mergedFrom: [],
      createdAt: now,
      lastSpiralAt: now,
      archivedAt: null,
    };

    this.store.saveMemoryToken(token);
    this.updateTopicIndex(token);
    return token;
  }

  /**
   * Create a memory token from a learning episode.
   */
  createFromEpisode(episode: LearningEpisode): MemoryToken {
    const text = `${episode.category} ${episode.adjustmentDirection} by ${episode.adjustmentMagnitude.toFixed(4)}. ${episode.reason}`;
    const essence = this.extractor.extract(text, {
      categories: [episode.category],
    });
    const now = new Date().toISOString();
    const token: MemoryToken = {
      id: randomUUID(),
      type: 'episode',
      tier: 'raw',
      essence,
      strength: INITIAL_TOKEN_STRENGTH + (episode.outcomeMismatch ? 0.1 : 0),
      spiralCount: 0,
      sourceId: episode.id,
      mergedFrom: [],
      createdAt: now,
      lastSpiralAt: now,
      archivedAt: null,
    };

    this.store.saveMemoryToken(token);
    this.updateTopicIndex(token);
    return token;
  }

  /**
   * Create a memory token from a SPARK insight.
   */
  createFromInsight(insight: Insight): MemoryToken {
    const text = `${insight.pattern} pattern in ${insight.category}: ${insight.summary}`;
    const essence = this.extractor.extract(text, {
      categories: [insight.category],
    });
    // Insights start with higher strength based on impact
    const strength = INITIAL_TOKEN_STRENGTH + (insight.impact * 0.3);
    const now = new Date().toISOString();
    const token: MemoryToken = {
      id: randomUUID(),
      type: 'insight',
      tier: 'raw',
      essence,
      strength: Math.min(1.0, strength),
      spiralCount: 0,
      sourceId: insight.id,
      mergedFrom: [],
      createdAt: now,
      lastSpiralAt: now,
      archivedAt: null,
    };

    this.store.saveMemoryToken(token);
    this.updateTopicIndex(token);
    return token;
  }

  /**
   * Create or update a memory token from a belief update.
   */
  createFromBelief(belief: Belief): MemoryToken {
    const text = `${belief.category} trust level: ${belief.trustLevel}. ${belief.narrative}`;
    const essence = this.extractor.extract(text, {
      categories: [belief.category],
    });
    const now = new Date().toISOString();

    // Check for existing belief token for this category
    const existing = this.store.listMemoryTokens({
      type: 'belief',
      excludeArchived: true,
      limit: 100,
    }).find(t => t.essence.categories.includes(belief.category));

    if (existing) {
      // Update existing token's essence and refresh
      const updated: MemoryToken = {
        ...existing,
        essence,
        lastSpiralAt: now,
      };
      // Archive old and create new (simpler than update)
      this.store.archiveMemoryToken(existing.id, now);
      this.store.deleteTopicIndex(existing.id);
    }

    const token: MemoryToken = {
      id: randomUUID(),
      type: 'belief',
      tier: 'raw',
      essence,
      strength: 0.6 + (belief.stability * 0.2),
      spiralCount: existing ? existing.spiralCount : 0,
      sourceId: belief.category,
      mergedFrom: existing ? [existing.id] : [],
      createdAt: now,
      lastSpiralAt: now,
      archivedAt: null,
    };

    this.store.saveMemoryToken(token);
    this.updateTopicIndex(token);
    return token;
  }

  /**
   * Merge multiple tokens into a composite token.
   */
  merge(tokenIds: string[]): MemoryToken | null {
    const tokens = tokenIds
      .map(id => this.store.getMemoryToken(id))
      .filter((t): t is MemoryToken => t != null);

    if (tokens.length < 2) return null;

    // Combine topics (deduplicated)
    const allTopics = [...new Set(tokens.flatMap(t => t.essence.topics))];
    const allCategories = [...new Set(tokens.flatMap(t => t.essence.categories))];
    const allConnectors = [...new Set(tokens.flatMap(t => t.essence.connectors))];
    const allRelationships = tokens.flatMap(t => t.essence.relationships);
    const allDecisions = tokens.flatMap(t => t.essence.decisionPoints);

    // Average sentiment
    let sentimentSum = 0;
    for (const t of tokens) {
      if (t.essence.sentiment === 'positive') sentimentSum += 1;
      else if (t.essence.sentiment === 'negative') sentimentSum -= 1;
    }
    const avgSentiment = sentimentSum / tokens.length;

    // Combine gists
    const gist = tokens.map(t => t.essence.gist).filter(g => g).join('. ').slice(0, 120);

    const compositeEssence: Essence = {
      topics: allTopics.slice(0, 10),
      sentiment: avgSentiment > 0.3 ? 'positive' : avgSentiment < -0.3 ? 'negative' : 'mixed',
      sentimentIntensity: tokens.reduce((s, t) => s + t.essence.sentimentIntensity, 0) / tokens.length,
      relationships: allRelationships,
      decisionPoints: allDecisions,
      importance: Math.max(...tokens.map(t => t.essence.importance)),
      categories: allCategories as any,
      connectors: allConnectors,
      gist,
    };

    const now = new Date().toISOString();
    const composite: MemoryToken = {
      id: randomUUID(),
      type: 'composite',
      tier: 'compressed',
      essence: compositeEssence,
      strength: Math.max(...tokens.map(t => t.strength)),
      spiralCount: Math.max(...tokens.map(t => t.spiralCount)),
      sourceId: tokenIds[0],
      mergedFrom: tokenIds,
      createdAt: now,
      lastSpiralAt: now,
      archivedAt: null,
    };

    // Archive merged tokens
    for (const token of tokens) {
      this.store.archiveMemoryToken(token.id, now);
    }

    this.store.saveMemoryToken(composite);
    this.updateTopicIndex(composite);
    return composite;
  }

  /**
   * Auto-merge same-type tokens with >80% topic similarity.
   * Uses the SpiralLoop's computeTopicSimilarity for consistency.
   * Returns the number of tokens merged.
   */
  autoMerge(spiralLoop: { computeTopicSimilarity(a: Essence, b: Essence): number }): number {
    const activeTokens = this.store.listMemoryTokens({ excludeArchived: true, limit: 500 });
    if (activeTokens.length < 2) return 0;

    // Group tokens by type
    const byType = new Map<string, MemoryToken[]>();
    for (const token of activeTokens) {
      const group = byType.get(token.type) || [];
      group.push(token);
      byType.set(token.type, group);
    }

    let mergedCount = 0;
    const alreadyMerged = new Set<string>();

    for (const [_type, tokens] of byType) {
      if (tokens.length < 2) continue;

      for (let i = 0; i < tokens.length; i++) {
        if (alreadyMerged.has(tokens[i].id)) continue;

        for (let j = i + 1; j < tokens.length; j++) {
          if (alreadyMerged.has(tokens[j].id)) continue;

          const similarity = spiralLoop.computeTopicSimilarity(
            tokens[i].essence,
            tokens[j].essence,
          );

          if (similarity >= AUTO_MERGE_SIMILARITY_THRESHOLD) {
            const merged = this.merge([tokens[i].id, tokens[j].id]);
            if (merged) {
              alreadyMerged.add(tokens[i].id);
              alreadyMerged.add(tokens[j].id);
              mergedCount++;
              break; // Move to next i — this token is now merged
            }
          }
        }
      }
    }

    return mergedCount;
  }

  /**
   * Update compression tiers based on age.
   */
  updateTiers(): number {
    const now = Date.now();
    const activeTokens = this.store.listMemoryTokens({ excludeArchived: true, limit: 1000 });
    let updated = 0;

    for (const token of activeTokens) {
      const age = now - new Date(token.createdAt).getTime();
      let newTier: CompressionTier;

      if (age < RAW_TIER_MS) newTier = 'raw';
      else if (age < RECENT_TIER_MS) newTier = 'recent';
      else if (age < COMPRESSED_TIER_MS) newTier = 'compressed';
      else newTier = 'archival';

      if (newTier !== token.tier) {
        this.store.updateMemoryTokenTier(token.id, newTier);
        updated++;
      }
    }

    return updated;
  }

  /**
   * Archive tokens below strength threshold.
   */
  archiveWeak(): number {
    const now = new Date().toISOString();
    const weakTokens = this.store.listMemoryTokens({
      excludeArchived: true,
      limit: 1000,
    }).filter(t => t.strength < ARCHIVE_STRENGTH_THRESHOLD);

    for (const token of weakTokens) {
      this.store.archiveMemoryToken(token.id, now);
    }

    return weakTokens.length;
  }

  /**
   * Build/update the topic index for a token.
   */
  private updateTopicIndex(token: MemoryToken): void {
    // Clear existing entries for this token
    this.store.deleteTopicIndex(token.id);

    // Add entries for each topic
    for (const topic of token.essence.topics) {
      // Use a simple score based on topic position (earlier = more important)
      const idx = token.essence.topics.indexOf(topic);
      const score = 1.0 - (idx / Math.max(token.essence.topics.length, 1)) * 0.5;
      this.store.upsertTopicIndex(topic, token.id, score);
    }
  }
}
