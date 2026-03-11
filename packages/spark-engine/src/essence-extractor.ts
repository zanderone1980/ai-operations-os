/**
 * EssenceExtractor — Algorithmic Compression Engine for Spiral Memory.
 *
 * Converts raw text into compressed Essence objects without any LLM calls.
 * Uses TF-IDF topic extraction, lexicon-based sentiment analysis,
 * pattern-based relationship extraction, and keyword-based decision detection.
 */

import type { SparkStore } from '@ai-operations/ops-storage';
import type { Essence, SentimentValence, EssenceRelationship, DecisionPoint, SparkCategory } from '@ai-operations/shared-types';
import {
  STOP_WORDS,
  POSITIVE_LEXICON,
  NEGATIVE_LEXICON,
  INTENSIFIERS,
  NEGATION_WORDS,
  MAX_TOPICS_PER_EXTRACTION,
  MIN_WORD_LENGTH,
  GIST_MAX_LENGTH,
} from './spiral-constants';

// ── Relationship patterns ──────────────────────────────────────

const RELATIONSHIP_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  { regex: /(\w+)\s+causes?\s+(\w+)/gi, type: 'causes' },
  { regex: /(\w+)\s+depends?\s+on\s+(\w+)/gi, type: 'depends-on' },
  { regex: /(\w+)\s+relates?\s+to\s+(\w+)/gi, type: 'related-to' },
  { regex: /(\w+)\s+leads?\s+to\s+(\w+)/gi, type: 'leads-to' },
  { regex: /(\w+)\s+triggers?\s+(\w+)/gi, type: 'triggers' },
  { regex: /(\w+)\s+affects?\s+(\w+)/gi, type: 'affects' },
  { regex: /(\w+)\s+improves?\s+(\w+)/gi, type: 'improves' },
  { regex: /(\w+)\s+reduces?\s+(\w+)/gi, type: 'reduces' },
];

// ── Decision keywords ──────────────────────────────────────────

const DECISION_KEYWORDS = [
  'decided', 'chose', 'choose', 'prefer', 'preferred', 'selected',
  'should', 'recommend', 'recommended', 'approved', 'denied',
  'opted', 'picked', 'adopted', 'committed',
];

// ── Category detection ─────────────────────────────────────────

const CATEGORY_MARKERS: Record<SparkCategory, string[]> = {
  communication: ['communication', 'email', 'reply', 'send', 'message', 'gmail', 'inbox'],
  publication: ['publication', 'post', 'tweet', 'publish', 'social', 'twitter'],
  destructive: ['destructive', 'delete', 'remove', 'destroy', 'archive'],
  scheduling: ['scheduling', 'calendar', 'event', 'meeting', 'schedule'],
  financial: ['financial', 'payment', 'money', 'charge', 'refund', 'shopify', 'order'],
  readonly: ['readonly', 'read', 'search', 'list', 'fetch', 'query'],
  general: [],
};

const CONNECTOR_MARKERS: Record<string, string[]> = {
  gmail: ['gmail', 'email', 'inbox', 'mail'],
  'x-twitter': ['twitter', 'tweet', 'social', 'post'],
  calendar: ['calendar', 'event', 'meeting', 'schedule'],
  shopify: ['shopify', 'store', 'order', 'product'],
  slack: ['slack', 'channel', 'workspace', 'dm', 'thread'],
  notion: ['notion', 'page', 'database', 'wiki', 'doc'],
};

// ── EssenceExtractor ───────────────────────────────────────────

export class EssenceExtractor {
  private readonly store: SparkStore;

  constructor(store: SparkStore) {
    this.store = store;
  }

  /**
   * Extract essence from raw text content.
   */
  extract(text: string, context?: {
    categories?: SparkCategory[];
    connectors?: string[];
  }): Essence {
    if (!text || text.trim().length === 0) {
      return {
        topics: [],
        sentiment: 'neutral',
        sentimentIntensity: 0,
        relationships: [],
        decisionPoints: [],
        importance: 0,
        categories: context?.categories || [],
        connectors: context?.connectors || [],
        gist: '',
      };
    }

    const topics = this.extractTopics(text);
    const { valence, intensity } = this.analyzeSentiment(text);
    const relationships = this.extractRelationships(text);
    const decisionPoints = this.extractDecisionPoints(text);
    const categories = context?.categories || this.detectCategories(text);
    const connectors = context?.connectors || this.detectConnectors(text);
    const gist = this.generateGist(text);

    const essence: Essence = {
      topics,
      sentiment: valence,
      sentimentIntensity: intensity,
      relationships,
      decisionPoints,
      importance: 0,
      categories,
      connectors,
      gist,
    };

    essence.importance = this.computeImportance(text, essence);

    return essence;
  }

  /**
   * Extract topics using TF-IDF scoring.
   */
  extractTopics(text: string): string[] {
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return [];

    const tfIdf = this.computeTfIdf(tokens);

    return Array.from(tfIdf.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOPICS_PER_EXTRACTION)
      .map(([term]) => term);
  }

  /**
   * Analyze sentiment using lexicon + negation + intensifiers.
   */
  analyzeSentiment(text: string): { valence: SentimentValence; intensity: number } {
    const tokens = text.toLowerCase().split(/\s+/);
    if (tokens.length === 0) return { valence: 'neutral', intensity: 0 };

    let positiveScore = 0;
    let negativeScore = 0;
    let sentimentWordCount = 0;
    let negated = false;
    let intensifier = 1.0;

    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i].replace(/[^a-z]/g, '');
      if (!word) continue;

      if (NEGATION_WORDS.has(word)) {
        negated = true;
        continue;
      }

      if (INTENSIFIERS.has(word)) {
        intensifier = INTENSIFIERS.get(word)!;
        continue;
      }

      const isPositive = POSITIVE_LEXICON.has(word);
      const isNegative = NEGATIVE_LEXICON.has(word);

      if (isPositive || isNegative) {
        sentimentWordCount++;
        const weight = intensifier;

        if (negated) {
          // Flip valence
          if (isPositive) negativeScore += weight;
          else positiveScore += weight;
        } else {
          if (isPositive) positiveScore += weight;
          else negativeScore += weight;
        }

        negated = false;
        intensifier = 1.0;
      } else {
        // Reset negation after non-sentiment word gap
        if (negated && i > 0) {
          const prevWord = tokens[i - 1]?.replace(/[^a-z]/g, '');
          if (!NEGATION_WORDS.has(prevWord || '')) {
            negated = false;
          }
        }
        intensifier = 1.0;
      }
    }

    if (sentimentWordCount === 0) return { valence: 'neutral', intensity: 0 };

    const total = positiveScore + negativeScore;
    const intensity = Math.min(1.0, sentimentWordCount / Math.max(tokens.length, 1) * 3);

    let valence: SentimentValence;
    if (positiveScore > 0 && negativeScore > 0) {
      const ratio = Math.max(positiveScore, negativeScore) / Math.min(positiveScore, negativeScore);
      if (ratio < 3) {
        valence = 'mixed';
      } else {
        valence = positiveScore > negativeScore ? 'positive' : 'negative';
      }
    } else if (positiveScore > 0) {
      valence = 'positive';
    } else {
      valence = 'negative';
    }

    return { valence, intensity };
  }

  /**
   * Extract relationships using pattern matching.
   */
  extractRelationships(text: string): EssenceRelationship[] {
    const relationships: EssenceRelationship[] = [];

    for (const { regex, type } of RELATIONSHIP_PATTERNS) {
      // Reset regex state
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const from = match[1].toLowerCase();
        const to = match[2].toLowerCase();
        if (!STOP_WORDS.has(from) && !STOP_WORDS.has(to) && from !== to) {
          relationships.push({ from, to, type, strength: 0.7 });
        }
      }
    }

    return relationships;
  }

  /**
   * Extract decision points using keyword detection.
   */
  extractDecisionPoints(text: string): DecisionPoint[] {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const decisions: DecisionPoint[] = [];

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase().trim();
      const hasDecision = DECISION_KEYWORDS.some(kw => lower.includes(kw));
      if (!hasDecision) continue;

      // Look for choice patterns
      let choice: string | null = null;
      const alternatives: string[] = [];

      const overMatch = lower.match(/(\w+)\s+over\s+(\w+)/);
      if (overMatch) {
        choice = overMatch[1];
        alternatives.push(overMatch[2]);
      }

      const insteadMatch = lower.match(/(\w+)\s+instead\s+of\s+(\w+)/);
      if (insteadMatch) {
        choice = insteadMatch[1];
        alternatives.push(insteadMatch[2]);
      }

      decisions.push({
        description: sentence.trim().slice(0, 200),
        choice,
        alternatives,
        confidence: 0.6,
      });
    }

    return decisions;
  }

  /**
   * Compute importance score.
   */
  computeImportance(text: string, essence: Partial<Essence>): number {
    const tokens = this.tokenize(text);
    const totalWords = text.split(/\s+/).filter(w => w.length > 0).length;

    // Topic density: ratio of meaningful words
    const topicDensity = totalWords > 0 ? Math.min(1.0, tokens.length / totalWords) : 0;

    // Sentiment intensity
    const sentimentIntensity = essence.sentimentIntensity ?? 0;

    // Decision points
    const decisionCount = essence.decisionPoints?.length ?? 0;
    const decisionScore = decisionCount / Math.max(decisionCount, 3);

    // Relationships
    const relCount = essence.relationships?.length ?? 0;
    const relationshipScore = relCount / Math.max(relCount, 5);

    // Category relevance: SENTINEL categories score higher
    const hasSentinel = (essence.categories || []).some(
      c => c === 'destructive' || c === 'financial'
    );
    const categoryRelevance = hasSentinel ? 1.0 : (essence.categories?.length ? 0.5 : 0.2);

    return Math.min(1.0,
      0.3 * topicDensity
      + 0.2 * sentimentIntensity
      + 0.2 * decisionScore
      + 0.15 * relationshipScore
      + 0.15 * categoryRelevance
    );
  }

  /**
   * Generate a gist (compressed one-line summary).
   */
  generateGist(text: string): string {
    if (text.length <= GIST_MAX_LENGTH) return text.trim();

    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length === 0) return text.slice(0, GIST_MAX_LENGTH).trim();

    // Score each sentence by sum of its word TF-IDF scores
    const allTokens = this.tokenize(text);
    const tfIdf = this.computeTfIdf(allTokens);

    let bestSentence = sentences[0];
    let bestScore = -1;

    for (const sentence of sentences) {
      const words = this.tokenize(sentence);
      const score = words.reduce((sum, w) => sum + (tfIdf.get(w) ?? 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence;
      }
    }

    const trimmed = bestSentence.trim();
    return trimmed.length <= GIST_MAX_LENGTH
      ? trimmed
      : trimmed.slice(0, GIST_MAX_LENGTH - 3) + '...';
  }

  // ── Internals ────────────────────────────────────────────────

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s,.;:!?()[\]{}"'`~@#$%^&*+=|\\/<>]+/)
      .map(w => this.stem(w))
      .filter(w => w.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(w));
  }

  private stem(word: string): string {
    // Basic suffix-stripping stemmer
    if (word.endsWith('tion') || word.endsWith('sion')) return word.slice(0, -3);
    if (word.endsWith('ment')) return word.slice(0, -4) || word;
    if (word.endsWith('ness')) return word.slice(0, -4) || word;
    if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
    if (word.endsWith('ied')) return word.slice(0, -3) + 'y';
    if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('er') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
    return word;
  }

  private computeTfIdf(tokens: string[]): Map<string, number> {
    // Term frequency
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // Real document frequency from topic index
    const totalDocs = Math.max(1, this.store.getTopicDocumentCount());
    const uniqueTerms = Array.from(tf.keys());
    const dfs = this.store.getDocumentFrequencies(uniqueTerms);

    const tfIdf = new Map<string, number>();
    for (const [term, count] of tf) {
      const termFreq = count / tokens.length;
      const df = dfs.get(term) ?? 0;
      // Real IDF: log(totalDocs / (1 + df))
      const idf = Math.log(totalDocs / (1 + df));
      tfIdf.set(term, termFreq * Math.max(idf, 0.1));
    }

    return tfIdf;
  }

  private detectCategories(text: string): SparkCategory[] {
    const lower = text.toLowerCase();
    const found: SparkCategory[] = [];
    for (const [cat, markers] of Object.entries(CATEGORY_MARKERS)) {
      if (markers.length > 0 && markers.some(m => lower.includes(m))) {
        found.push(cat as SparkCategory);
      }
    }
    return found;
  }

  private detectConnectors(text: string): string[] {
    const lower = text.toLowerCase();
    const found: string[] = [];
    for (const [conn, markers] of Object.entries(CONNECTOR_MARKERS)) {
      if (markers.some(m => lower.includes(m))) {
        found.push(conn);
      }
    }
    return found;
  }
}
