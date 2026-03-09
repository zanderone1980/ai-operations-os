/**
 * IntentClassifier — Keyword-based heuristic intent classification.
 *
 * Scans input text for known keywords and maps them to a TaskIntent.
 * This is the fast, deterministic first pass. An LLM-based classifier
 * can be layered on top for ambiguous cases.
 */

import type { TaskIntent } from '@ai-ops/shared-types';

/**
 * A mapping from intent to the keywords that signal it.
 */
interface IntentKeywords {
  intent: TaskIntent;
  keywords: string[];
}

/** Default keyword table, ordered by priority (first match wins). */
const KEYWORD_TABLE: readonly IntentKeywords[] = [
  {
    intent: 'escalate',
    keywords: ['urgent', 'escalate', 'help', 'emergency', 'manager'],
  },
  {
    intent: 'reply',
    keywords: ['reply', 'respond', 'answer', 'get back to'],
  },
  {
    intent: 'schedule',
    keywords: ['schedule', 'meeting', 'calendar', 'book', 'appointment'],
  },
  {
    intent: 'post',
    keywords: ['post', 'publish', 'tweet', 'share', 'announce'],
  },
  {
    intent: 'fulfill',
    keywords: ['ship', 'fulfill', 'order', 'process', 'deliver'],
  },
  {
    intent: 'refund',
    keywords: ['refund', 'return', 'chargeback', 'reimburse', 'credit back'],
  },
  {
    intent: 'ignore',
    keywords: ['spam', 'unsubscribe', 'junk', 'promotional'],
  },
] as const;

/**
 * Result of an intent classification, including confidence metadata.
 */
export interface ClassificationResult {
  /** The classified intent. */
  intent: TaskIntent;

  /** Confidence level: 'high' if multiple keywords matched, 'low' for single. */
  confidence: 'high' | 'low' | 'none';

  /** The keywords that matched (empty for 'unknown'). */
  matchedKeywords: string[];
}

/**
 * IntentClassifier uses keyword heuristics to classify free-text into a TaskIntent.
 *
 * @example
 * ```ts
 * const classifier = new IntentClassifier();
 * const result = classifier.classify('Please reply to John');
 * // => { intent: 'reply', confidence: 'low', matchedKeywords: ['reply'] }
 * ```
 */
export class IntentClassifier {
  private readonly keywordTable: readonly IntentKeywords[];

  /**
   * Create a new IntentClassifier.
   *
   * @param customKeywords - Optional override for the keyword table.
   *                         Defaults to the built-in table.
   */
  constructor(customKeywords?: IntentKeywords[]) {
    this.keywordTable = customKeywords ?? KEYWORD_TABLE;
  }

  /**
   * Classify free-text into a TaskIntent using keyword matching.
   *
   * The text is normalized to lowercase and scanned for each keyword set
   * in priority order. The first intent with at least one match wins.
   * If no keywords match, returns 'unknown'.
   *
   * @param text - The input text to classify.
   * @returns The classified TaskIntent.
   */
  classify(text: string): TaskIntent {
    const result = this.classifyDetailed(text);
    return result.intent;
  }

  /**
   * Classify free-text with full metadata about the match.
   *
   * @param text - The input text to classify.
   * @returns A ClassificationResult with intent, confidence, and matched keywords.
   */
  classifyDetailed(text: string): ClassificationResult {
    const normalized = text.toLowerCase();

    for (const entry of this.keywordTable) {
      const matched = entry.keywords.filter((kw) =>
        normalized.includes(kw),
      );

      if (matched.length > 0) {
        return {
          intent: entry.intent,
          confidence: matched.length >= 2 ? 'high' : 'low',
          matchedKeywords: matched,
        };
      }
    }

    return {
      intent: 'unknown',
      confidence: 'none',
      matchedKeywords: [],
    };
  }
}
