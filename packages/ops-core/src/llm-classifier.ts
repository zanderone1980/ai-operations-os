/**
 * LLMIntentClassifier — LLM-backed intent classification with heuristic fallback.
 *
 * Uses a configured LLM provider (Anthropic, OpenAI, or Ollama) to classify
 * ambiguous text into a TaskIntent. Falls back to the keyword-based
 * IntentClassifier when:
 *   - No LLM provider is configured
 *   - The heuristic already returns high confidence
 *   - The LLM call fails for any reason
 *
 * Provider configuration via environment variables:
 *   OPS_LLM_PROVIDER    — 'anthropic' | 'openai' | 'ollama'
 *   ANTHROPIC_API_KEY    — Required when provider is 'anthropic'
 *   OPENAI_API_KEY       — Required when provider is 'openai'
 *   OLLAMA_URL           — Base URL for Ollama (default: http://localhost:11434)
 */

import type { TaskIntent } from '@ai-operations/shared-types';
import { IntentClassifier } from './intent';
import type { ClassificationResult } from './intent';

// ── Types ────────────────────────────────────────────────────────────────────

type LLMProvider = 'anthropic' | 'openai' | 'ollama';

/** Extended classification result that includes method metadata. */
export interface LLMClassificationResult extends ClassificationResult {
  /** Which classification method produced the result. */
  method: 'heuristic' | 'llm';

  /** The LLM provider used, if method is 'llm'. */
  provider?: LLMProvider;

  /** The model used, if method is 'llm'. */
  model?: string;
}

// ── Valid intents ────────────────────────────────────────────────────────────

const VALID_INTENTS: readonly TaskIntent[] = [
  'reply',
  'schedule',
  'post',
  'fulfill',
  'refund',
  'escalate',
  'ignore',
  'unknown',
] as const;

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an intent classifier for an AI operations system.

Given a text description of a task or incoming event, classify it into exactly one of these intents:

- reply     — The task requires replying or responding to an email, message, or inquiry.
- schedule  — The task involves scheduling, meetings, calendar events, or appointments.
- post      — The task involves posting, publishing, or sharing content on social media.
- fulfill   — The task involves fulfilling, shipping, or processing an order.
- refund    — The task involves refunding, returning, or reimbursing a payment.
- escalate  — The task is urgent, requires help, or needs to be escalated to a manager.
- ignore    — The task is spam, junk, or promotional and should be ignored.
- unknown   — The task does not clearly fit any of the above categories.

Respond with ONLY the intent name — a single word, no punctuation, no explanation.`;

// ── LLMIntentClassifier ──────────────────────────────────────────────────────

/**
 * LLMIntentClassifier combines keyword heuristics with LLM-based classification.
 *
 * Classification strategy:
 * 1. Run the heuristic classifier first.
 * 2. If the heuristic returns 'high' confidence, return immediately (no LLM call).
 * 3. If confidence is 'low' or 'none', call the configured LLM for a better result.
 * 4. If no LLM is configured or the LLM call fails, return the heuristic result.
 *
 * @example
 * ```ts
 * const classifier = new LLMIntentClassifier();
 * const intent = await classifier.classify('Can you reply to John about the meeting?');
 * // => 'reply'
 * ```
 */
export class LLMIntentClassifier {
  private readonly heuristic: IntentClassifier;
  private readonly provider: LLMProvider | null;
  private readonly apiKey: string | null;
  private readonly ollamaUrl: string;

  constructor(heuristic?: IntentClassifier) {
    this.heuristic = heuristic ?? new IntentClassifier();

    const rawProvider = process.env.OPS_LLM_PROVIDER?.toLowerCase();

    if (rawProvider === 'anthropic' || rawProvider === 'openai' || rawProvider === 'ollama') {
      this.provider = rawProvider;
    } else {
      this.provider = null;
    }

    // Resolve the API key for the selected provider
    switch (this.provider) {
      case 'anthropic':
        this.apiKey = process.env.ANTHROPIC_API_KEY ?? null;
        break;
      case 'openai':
        this.apiKey = process.env.OPENAI_API_KEY ?? null;
        break;
      default:
        this.apiKey = null;
    }

    this.ollamaUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Classify free-text into a TaskIntent.
   *
   * Returns a Promise because the LLM path is async. When the heuristic
   * is confident or no LLM is configured, resolves immediately.
   */
  async classify(text: string): Promise<TaskIntent> {
    const result = await this.classifyDetailed(text);
    return result.intent;
  }

  /**
   * Classify free-text with full metadata including which method was used,
   * the provider, and the model.
   */
  async classifyDetailed(text: string): Promise<LLMClassificationResult> {
    // Step 1: Run heuristic first
    const heuristicResult = this.heuristic.classifyDetailed(text);

    // Step 2: If high confidence, return the heuristic result — no LLM needed
    if (heuristicResult.confidence === 'high') {
      return {
        ...heuristicResult,
        method: 'heuristic',
      };
    }

    // Step 3: If no LLM provider is configured, fall back to heuristic
    if (!this.isLLMConfigured()) {
      return {
        ...heuristicResult,
        method: 'heuristic',
      };
    }

    // Step 4: Call the LLM
    try {
      const llmResult = await this.callLLM(text);
      return llmResult;
    } catch {
      // LLM failed — fall back to heuristic
      return {
        ...heuristicResult,
        method: 'heuristic',
      };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Check whether an LLM provider is properly configured. */
  private isLLMConfigured(): boolean {
    if (!this.provider) return false;
    if (this.provider === 'ollama') return true; // Ollama doesn't need an API key
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /** Dispatch to the correct provider. */
  private async callLLM(text: string): Promise<LLMClassificationResult> {
    switch (this.provider) {
      case 'anthropic':
        return this.callAnthropic(text);
      case 'openai':
        return this.callOpenAI(text);
      case 'ollama':
        return this.callOllama(text);
      default:
        throw new Error('No LLM provider configured');
    }
  }

  // ── Anthropic ────────────────────────────────────────────────────────────

  private async callAnthropic(text: string): Promise<LLMClassificationResult> {
    const model = 'claude-haiku-4-5-20251001';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Classify this text:\n\n${text}` },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const rawIntent = data.content?.[0]?.text?.trim().toLowerCase() ?? '';
    const intent = this.parseIntent(rawIntent);

    return {
      intent,
      confidence: intent === 'unknown' ? 'low' : 'high',
      matchedKeywords: [],
      method: 'llm',
      provider: 'anthropic',
      model,
    };
  }

  // ── OpenAI ───────────────────────────────────────────────────────────────

  private async callOpenAI(text: string): Promise<LLMClassificationResult> {
    const model = 'gpt-4o-mini';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey!}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Classify this text:\n\n${text}` },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const rawIntent = data.choices?.[0]?.message?.content?.trim().toLowerCase() ?? '';
    const intent = this.parseIntent(rawIntent);

    return {
      intent,
      confidence: intent === 'unknown' ? 'low' : 'high',
      matchedKeywords: [],
      method: 'llm',
      provider: 'openai',
      model,
    };
  }

  // ── Ollama ───────────────────────────────────────────────────────────────

  private async callOllama(text: string): Promise<LLMClassificationResult> {
    const model = 'llama3';

    const response = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Classify this text:\n\n${text}` },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      message: { content: string };
    };

    const rawIntent = data.message?.content?.trim().toLowerCase() ?? '';
    const intent = this.parseIntent(rawIntent);

    return {
      intent,
      confidence: intent === 'unknown' ? 'low' : 'high',
      matchedKeywords: [],
      method: 'llm',
      provider: 'ollama',
      model,
    };
  }

  // ── Intent parsing ───────────────────────────────────────────────────────

  /**
   * Parse a raw LLM response string into a valid TaskIntent.
   * Handles extra whitespace, punctuation, or surrounding text.
   */
  private parseIntent(raw: string): TaskIntent {
    const cleaned = raw.replace(/[^a-z]/g, '');

    for (const intent of VALID_INTENTS) {
      if (cleaned === intent) {
        return intent;
      }
    }

    // If the cleaned string contains a valid intent, extract it
    for (const intent of VALID_INTENTS) {
      if (cleaned.includes(intent)) {
        return intent;
      }
    }

    return 'unknown';
  }
}
