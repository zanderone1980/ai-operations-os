/**
 * ReasoningCore — Conversational Reasoning Engine for SPARK.
 *
 * Transforms SPARK from a passive learning system into an active
 * reasoning agent. Processes natural language queries, assembles
 * cross-connector context, runs rule-based inference, and composes
 * template-based responses.
 *
 * Pipeline:
 *   1. Classify query intent (keyword heuristics)
 *   2. Assemble context (beliefs, insights, episodes, cross-connector data)
 *   3. Run matching reasoning rules against context
 *   4. Compose natural language response
 *   5. Generate follow-up suggestions
 *   6. Persist conversation turns
 *
 * All responses are template-generated — no LLM calls required.
 */

import { randomUUID } from 'node:crypto';
import type { SparkStore } from '@ai-operations/ops-storage';
import type {
  SparkQueryIntent,
  IntentClassification,
  ReasoningStep,
  ReasoningResult,
  ConversationTurn,
  Conversation,
  CrossConnectorContext,
  CrossConnectorPattern,
  AwarenessReport,
  Belief,
  Insight,
  LearningEpisode,
  SparkCategory,
  TrustLevel,
  ReconstructedContext,
} from '@ai-operations/shared-types';
import type { ContextReconstructor } from './context-reconstructor';
import type { FeedbackIntegrator } from './feedback-integrator';
import type { EmotionalStateEngine } from './emotional-state';
import type { SelfReflectionEngine } from './self-reflection';

// ── Internal Types ─────────────────────────────────────────────────

interface ReasoningRule {
  id: string;
  intents: SparkQueryIntent[];
  evaluate(context: InternalReasoningContext): ReasoningStep | null;
}

interface InternalReasoningContext {
  query: string;
  queryIntent: SparkQueryIntent;
  conversationHistory: ConversationTurn[];
  awarenessReport: AwarenessReport;
  recentInsights: Insight[];
  recentEpisodes: LearningEpisode[];
  crossConnector: CrossConnectorContext;
  reconstructedContext?: ReconstructedContext;
}

/** A segment of a compound query. */
export interface CompoundSegment {
  text: string;
  connective: 'and' | 'then' | 'also' | 'plus' | 'if-then' | 'root';
}

// ── Compound Query Detection ──────────────────────────────────────

const COMPOUND_PATTERNS: Array<{ regex: RegExp; connective: CompoundSegment['connective'] }> = [
  { regex: /\b(?:and\s+then|after\s+that|then\s+also)\b/i, connective: 'then' },
  { regex: /\bif\b(.+?)\bthen\b/i, connective: 'if-then' },
  { regex: /\b(?:,\s*and\s+also|,\s*also|also)\b/i, connective: 'also' },
  { regex: /\b(?:,\s*then|then)\b/i, connective: 'then' },
  { regex: /\b(?:,\s*plus|plus)\b/i, connective: 'plus' },
];

/**
 * Detect whether a query is compound (multi-part) and split into segments.
 * Simple queries return a single segment with connective 'root'.
 */
export function detectCompoundQuery(query: string): CompoundSegment[] {
  const trimmed = query.trim();
  if (!trimmed) return [{ text: trimmed, connective: 'root' }];

  // Try if-then first (special structure)
  const ifThenMatch = trimmed.match(/^(.+?)\bif\b\s+(.+?)\s*,?\s*\bthen\b\s+(.+)$/i);
  if (ifThenMatch) {
    const prefix = ifThenMatch[1].trim();
    const condition = ifThenMatch[2].trim();
    const consequence = ifThenMatch[3].trim();
    const segments: CompoundSegment[] = [];
    if (prefix.length > 0) {
      segments.push({ text: prefix, connective: 'root' });
    }
    segments.push({ text: condition, connective: 'root' });
    segments.push({ text: consequence, connective: 'if-then' });
    return segments;
  }

  // Standalone if-then at start of query
  const standaloneIfThen = trimmed.match(/^if\b\s+(.+?)\s*,?\s*\bthen\b\s+(.+)$/i);
  if (standaloneIfThen) {
    return [
      { text: standaloneIfThen[1].trim(), connective: 'root' },
      { text: standaloneIfThen[2].trim(), connective: 'if-then' },
    ];
  }

  // Try splitting on conjunctions (and then, then, also, plus)
  const splitPattern = /\b(?:and\s+then|after\s+that|then\s+also)\b|(?:,\s*(?:then|also|plus)\b)|(?:\bthen\b|\balso\b|\bplus\b)/i;
  const parts = trimmed.split(splitPattern).map(p => p.trim()).filter(p => p.length > 3);

  if (parts.length <= 1) {
    return [{ text: trimmed, connective: 'root' }];
  }

  // Build segments: first is root, rest get inferred connective
  return parts.map((text, i) => {
    if (i === 0) return { text, connective: 'root' as const };
    // Find which connective preceded this part
    const matchBefore = trimmed.slice(0, trimmed.indexOf(text)).match(
      /\b(and\s+then|after\s+that|then\s+also|then|also|plus)\b\s*$/i
    );
    let connective: CompoundSegment['connective'] = 'then';
    if (matchBefore) {
      const matched = matchBefore[1].toLowerCase();
      if (matched === 'also' || matched === 'then also') connective = 'also';
      else if (matched === 'plus') connective = 'plus';
      else connective = 'then';
    }
    return { text, connective };
  });
}

// ── Query Intent Keywords ──────────────────────────────────────────

const QUERY_KEYWORDS: Array<{ intent: SparkQueryIntent; keywords: string[] }> = [
  { intent: 'status', keywords: ['how are you', 'status', 'how do you feel', 'state', 'overview', 'doing'] },
  { intent: 'explain', keywords: ['why', 'explain', 'reason', 'because', 'how come', 'what caused'] },
  { intent: 'predict', keywords: ['what would happen', 'predict', 'forecast', 'if i', 'would happen', 'what if'] },
  { intent: 'recommend', keywords: ['should', 'recommend', 'suggest', 'advice', 'best', 'do you think'] },
  { intent: 'cross-connector', keywords: ['across', 'between', 'connection', 'relate', 'together', 'connectors', 'agents'] },
  { intent: 'introspect', keywords: ['uncertain', 'confident', 'know', 'believe', 'trust', 'sure', 'doubt'] },
  { intent: 'history', keywords: ['learned', 'recent', 'changed', 'history', 'past', 'trend', 'progress'] },
  { intent: 'configure', keywords: ['cautious', 'strict', 'lenient', 'adjust', 'change weight', 'more careful', 'less strict'] },
  { intent: 'diagnose', keywords: ['diagnose', 'wrong', 'fail', 'error', 'problem', 'issue', 'broke', 'why did', 'trouble', 'broken'] },
  { intent: 'compare', keywords: ['compare', 'versus', 'vs', 'difference', 'better', 'worse', 'differ'] },
  { intent: 'reflect', keywords: ['reflect', 'blind spot', 'blind spots', 'self-assessment', 'self assessment', 'what don\'t you know', 'growth', 'metacognition'] },
];

// ── Category Detection ─────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<SparkCategory, string[]> = {
  communication: ['communication', 'email', 'reply', 'send', 'message', 'gmail'],
  publication: ['publication', 'post', 'tweet', 'publish', 'social', 'x', 'twitter'],
  destructive: ['destructive', 'delete', 'remove', 'destroy'],
  scheduling: ['scheduling', 'calendar', 'event', 'meeting', 'schedule'],
  financial: ['financial', 'payment', 'money', 'charge', 'refund', 'shopify', 'order'],
  readonly: ['readonly', 'read', 'search', 'list', 'get'],
  general: ['general'],
};

function detectCategories(query: string): SparkCategory[] {
  const lower = query.toLowerCase();
  const found: SparkCategory[] = [];
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some(kw => lower.includes(kw))) {
      found.push(cat as SparkCategory);
    }
  }
  return found;
}

function detectConnectors(query: string): string[] {
  const lower = query.toLowerCase();
  const connectors: string[] = [];
  if (lower.includes('gmail') || lower.includes('email')) connectors.push('gmail');
  if (lower.includes('twitter') || lower.includes('x ') || lower.includes('tweet')) connectors.push('x-twitter');
  if (lower.includes('calendar') || lower.includes('event') || lower.includes('meeting')) connectors.push('calendar');
  if (lower.includes('shopify') || lower.includes('order') || lower.includes('store')) connectors.push('shopify');
  if (lower.includes('slack') || lower.includes('channel') || lower.includes('workspace') || lower.includes('dm')) connectors.push('slack');
  if (lower.includes('notion') || lower.includes('page') || lower.includes('database') || lower.includes('wiki')) connectors.push('notion');
  return connectors;
}

// ── ReasoningCore ──────────────────────────────────────────────────

export class ReasoningCore {
  static readonly CONVERSATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  private readonly store: SparkStore;
  private readonly rules: ReasoningRule[];
  private reconstructor?: ContextReconstructor;
  private feedbackIntegrator?: FeedbackIntegrator;
  private emotionalState?: EmotionalStateEngine;
  private reflectionEngine?: SelfReflectionEngine;

  constructor(store: SparkStore) {
    this.store = store;
    this.rules = this.buildRules();
  }

  /**
   * Inject spiral memory engines for context reconstruction.
   * Called by SparkOrchestrator after construction.
   */
  setSpiralMemory(reconstructor: ContextReconstructor, feedbackIntegrator: FeedbackIntegrator): void {
    this.reconstructor = reconstructor;
    this.feedbackIntegrator = feedbackIntegrator;
  }

  /**
   * Inject emotional state engine for affect-aware responses.
   * Called by SparkOrchestrator after construction.
   */
  setEmotionalState(engine: EmotionalStateEngine): void {
    this.emotionalState = engine;
  }

  /**
   * Inject self-reflection engine for metacognitive responses.
   * Called by SparkOrchestrator after construction.
   */
  setReflection(engine: SelfReflectionEngine): void {
    this.reflectionEngine = engine;
  }

  /**
   * Process a conversational query and produce a reasoned response.
   */
  reason(
    query: string,
    conversationId?: string,
    awarenessReport?: AwarenessReport,
  ): ReasoningResult {
    const classification = this.classifyQueryIntent(query);
    const queryIntent = classification.intent;

    // Load or create conversation
    const now = new Date().toISOString();
    let convId = conversationId;
    let conversationHistory: ConversationTurn[] = [];

    if (convId) {
      const existing = this.store.getConversation(convId);
      if (existing) {
        conversationHistory = this.store.listTurns(convId, 20);
        this.store.updateConversationActivity(convId, now, existing.turnCount + 2);
      } else {
        convId = undefined; // Invalid ID, create new
      }
    }

    if (!convId) {
      convId = randomUUID();
      this.store.saveConversation({
        id: convId,
        createdAt: now,
        lastActivityAt: now,
        turnCount: 2,
      });
    }

    // Save user turn
    const userTurn: ConversationTurn = {
      id: randomUUID(),
      conversationId: convId,
      role: 'user',
      content: query,
      createdAt: now,
    };
    this.store.saveTurn(userTurn);

    // Feed into spiral memory
    if (this.feedbackIntegrator) {
      this.feedbackIntegrator.onConversationTurn(userTurn);
    }

    // ── Compound query handling ──
    const segments = detectCompoundQuery(query);
    const isCompound = segments.length > 1;

    // Assemble context from the full query
    const context = this.assembleContext(query, queryIntent, conversationHistory, awarenessReport);

    let response: string;
    let steps: ReasoningStep[];
    let suggestions: string[];

    if (isCompound) {
      // Process each segment independently, accumulate results
      const sectionResponses: string[] = [];
      const allSteps: ReasoningStep[] = [];
      const allSuggestions: string[] = [];

      for (const segment of segments) {
        const segCls = this.classifyQueryIntent(segment.text);
        const segIntent = segCls.intent;

        // Assemble context for the sub-query (reuses shared data)
        const segContext: InternalReasoningContext = {
          ...context,
          query: segment.text,
          queryIntent: segIntent,
        };

        // Run matching rules for this segment's intent
        const segSteps: ReasoningStep[] = [];
        for (const rule of this.rules) {
          if (rule.intents.includes(segIntent) || rule.intents.includes('general')) {
            const step = rule.evaluate(segContext);
            if (step) segSteps.push(step);
          }
        }

        allSteps.push(...segSteps);

        const segResponse = this.composeResponse(segIntent, segSteps, segContext);

        // For if-then segments, prefix with conditional framing
        if (segment.connective === 'if-then') {
          sectionResponses.push(`[Conditional] ${segResponse}`);
        } else if (segment.connective !== 'root') {
          sectionResponses.push(`[${segment.connective}] ${segResponse}`);
        } else {
          sectionResponses.push(segResponse);
        }

        allSuggestions.push(...this.generateSuggestions(segIntent, segSteps, segContext));
      }

      response = sectionResponses.join('\n\n');
      steps = allSteps;
      // Deduplicate suggestions
      suggestions = [...new Set(allSuggestions)].slice(0, 3);
    } else {
      // Single-intent query (original path)
      steps = [];
      const intentsToCover = new Set<SparkQueryIntent>([queryIntent]);
      if (classification.ambiguous && classification.alternatives.length > 0) {
        intentsToCover.add(classification.alternatives[0].intent);
      }

      for (const rule of this.rules) {
        const matchesPrimary = rule.intents.includes(queryIntent) || rule.intents.includes('general');
        const matchesAlternative = classification.ambiguous
          && classification.alternatives.length > 0
          && rule.intents.includes(classification.alternatives[0].intent);
        if (matchesPrimary || matchesAlternative) {
          const step = rule.evaluate(context);
          if (step) steps.push(step);
        }
      }

      // Compose response — prepend disambiguation for ambiguous intents
      response = this.composeResponse(queryIntent, steps, context);
      if (classification.ambiguous && classification.alternatives.length > 0) {
        const altIntent = classification.alternatives[0].intent;
        const altResponse = this.composeResponse(altIntent, steps, context);
        if (altResponse !== response && altResponse.length > 20) {
          response = `[Primary interpretation: ${queryIntent}] ${response}\n\n[Also considering: ${altIntent}] ${altResponse}`;
        }
      }

      suggestions = this.generateSuggestions(queryIntent, steps, context);
    }

    const result: ReasoningResult = {
      id: randomUUID(),
      queryIntent,
      classification,
      steps,
      response,
      suggestions,
      createdAt: now,
    };

    // Save SPARK turn
    const sparkTurn: ConversationTurn = {
      id: randomUUID(),
      conversationId: convId,
      role: 'spark',
      content: response,
      reasoningResult: result,
      createdAt: now,
    };
    this.store.saveTurn(sparkTurn);

    // Feed SPARK response into spiral memory
    if (this.feedbackIntegrator) {
      this.feedbackIntegrator.onConversationTurn(sparkTurn);
    }

    // Attach conversationId to result for the API response
    (result as any).conversationId = convId;

    return result;
  }

  /**
   * Classify query intent using keyword heuristics with confidence scoring.
   *
   * Returns an IntentClassification with:
   * - Normalized confidence (0–1) for the primary intent
   * - Ranked alternatives with their own confidence scores
   * - Ambiguity flag when second-best is within 80% of the top score
   */
  classifyQueryIntent(query: string): IntentClassification {
    const lower = query.toLowerCase();

    // Score every intent
    const scores: Array<{ intent: SparkQueryIntent; rawScore: number }> = [];
    for (const { intent, keywords } of QUERY_KEYWORDS) {
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score += kw.length;
      }
      scores.push({ intent, rawScore: score });
    }

    // Sort descending by raw score
    scores.sort((a, b) => b.rawScore - a.rawScore);

    const totalScore = scores.reduce((sum, s) => sum + s.rawScore, 0);

    // If nothing matched, return 'general' with low confidence
    if (totalScore === 0) {
      return {
        intent: 'general',
        confidence: 0.1,
        alternatives: [],
        ambiguous: false,
      };
    }

    // Normalize scores to 0–1 confidence values
    const normalized = scores
      .filter(s => s.rawScore > 0)
      .map(s => ({
        intent: s.intent,
        confidence: parseFloat((s.rawScore / totalScore).toFixed(4)),
      }));

    const best = normalized[0];

    // Determine ambiguity: second-best is within 80% of best score
    const ambiguous = normalized.length >= 2
      && normalized[1].confidence >= best.confidence * 0.8;

    // Cap confidence: even a perfect single-intent match shouldn't be 1.0
    // Scale by how dominant the top score is relative to total
    const cappedConfidence = parseFloat(
      Math.min(0.95, best.confidence + 0.1).toFixed(4),
    );

    return {
      intent: best.intent,
      confidence: cappedConfidence,
      alternatives: normalized.slice(1),
      ambiguous,
    };
  }

  /**
   * Assemble cross-connector context from recent activity.
   */
  assembleCrossConnectorContext(awarenessReport?: AwarenessReport): CrossConnectorContext {
    const recentPredictions = this.store.listPredictions({ limit: 50 });

    // Group by connector
    const connectorActivity: CrossConnectorContext['connectorActivity'] = {};
    for (const pred of recentPredictions) {
      if (!connectorActivity[pred.connector]) {
        connectorActivity[pred.connector] = {
          recentOperations: [],
          recentOutcomes: [],
          episodeCount: 0,
          lastActivityAt: null,
        };
      }
      const entry = connectorActivity[pred.connector];
      entry.recentOperations.push(pred.operation);
      if (!entry.lastActivityAt || pred.createdAt > entry.lastActivityAt) {
        entry.lastActivityAt = pred.createdAt;
      }
    }

    // Count episodes per connector
    const recentEpisodes = this.store.listEpisodes({ limit: 100 });
    for (const ep of recentEpisodes) {
      // Episodes don't have connector directly, but we can trace via predictions
      // For now, use category as a proxy
      for (const [conn, activity] of Object.entries(connectorActivity)) {
        activity.episodeCount = recentEpisodes.filter(e => {
          const pred = recentPredictions.find(p => p.stepId === e.predictionId || p.id === e.predictionId);
          return pred?.connector === conn;
        }).length;
      }
    }

    // Detect cross-connector patterns
    const patterns = this.detectCrossConnectorPatterns(connectorActivity);

    const systemState = awarenessReport?.systemState || {
      overallConfidence: 0,
      totalEpisodes: 0,
      categoriesLearning: [],
      categoriesStable: [],
      categoriesVolatile: [],
    };

    return { connectorActivity, patterns, systemState };
  }

  // ── Private ──────────────────────────────────────────────────────

  private assembleContext(
    query: string,
    queryIntent: SparkQueryIntent,
    conversationHistory: ConversationTurn[],
    awarenessReport?: AwarenessReport,
  ): InternalReasoningContext {
    const recentInsights = this.store.listInsights({ limit: 10 });
    const recentEpisodes = this.store.listEpisodes({ limit: 20 });
    const crossConnector = this.assembleCrossConnectorContext(awarenessReport);

    // Build a minimal awareness report if none provided
    const report: AwarenessReport = awarenessReport || {
      beliefs: {} as any,
      systemState: crossConnector.systemState,
      insights: recentInsights,
      alerts: { oscillating: [], lowConfidence: [], nearingBounds: [], sentinelActive: [] },
      meta: { reportVersion: 1, generatedAt: new Date().toISOString(), episodeWindow: { from: '', to: '' } },
    };

    // Reconstruct context from spiral memory if available
    let reconstructedContext: ReconstructedContext | undefined;
    if (this.reconstructor) {
      reconstructedContext = this.reconstructor.reconstruct(query, {
        categories: detectCategories(query) as SparkCategory[],
      });
    }

    return {
      query,
      queryIntent,
      conversationHistory,
      awarenessReport: report,
      recentInsights,
      recentEpisodes,
      crossConnector,
      reconstructedContext,
    };
  }

  private detectCrossConnectorPatterns(
    activity: CrossConnectorContext['connectorActivity'],
  ): CrossConnectorPattern[] {
    const patterns: CrossConnectorPattern[] = [];
    const connectors = Object.keys(activity);

    // Email-to-Calendar: gmail and calendar both active
    if (connectors.includes('gmail') && connectors.includes('calendar')) {
      patterns.push({
        type: 'email-to-calendar',
        description: 'Both email and calendar are active — emails may contain scheduling requests that could be auto-processed.',
        connectors: ['gmail', 'calendar'],
        confidence: 0.7,
      });
    }

    // Social-to-Store: x-twitter and shopify both active
    if (connectors.includes('x-twitter') && connectors.includes('shopify')) {
      patterns.push({
        type: 'social-to-store',
        description: 'Social media and store are both active — social mentions could be tracked alongside order activity.',
        connectors: ['x-twitter', 'shopify'],
        confidence: 0.5,
      });
    }

    // Email-to-Social: gmail and x-twitter both active
    if (connectors.includes('gmail') && connectors.includes('x-twitter')) {
      patterns.push({
        type: 'email-to-social',
        description: 'Email and social media are both active — notifications from one may relate to actions on the other.',
        connectors: ['gmail', 'x-twitter'],
        confidence: 0.6,
      });
    }

    // Slack-to-Email: unified communication routing
    if (connectors.includes('slack') && connectors.includes('gmail')) {
      patterns.push({
        type: 'slack-to-email',
        description: 'Slack and email are both active — messages from one channel could be routed or summarized to the other for unified communication.',
        connectors: ['slack', 'gmail'],
        confidence: 0.65,
      });
    }

    // Notion-to-Calendar: deadline sync
    if (connectors.includes('notion') && connectors.includes('calendar')) {
      patterns.push({
        type: 'notion-to-calendar',
        description: 'Notion and calendar are both active — deadlines and milestones in Notion pages could be synced to calendar events automatically.',
        connectors: ['notion', 'calendar'],
        confidence: 0.6,
      });
    }

    // Slack-to-Notion: knowledge capture
    if (connectors.includes('slack') && connectors.includes('notion')) {
      patterns.push({
        type: 'slack-to-notion',
        description: 'Slack and Notion are both active — important discussions and decisions from Slack channels could be captured as Notion knowledge base entries.',
        connectors: ['slack', 'notion'],
        confidence: 0.55,
      });
    }

    // General multi-connector
    if (connectors.length >= 3) {
      patterns.push({
        type: 'general',
        description: `${connectors.length} connectors are actively being used. Cross-connector workflows could automate handoffs between them.`,
        connectors,
        confidence: 0.4,
      });
    }

    return patterns;
  }

  private composeResponse(
    intent: SparkQueryIntent,
    steps: ReasoningStep[],
    context: InternalReasoningContext,
  ): string {
    const report = context.awarenessReport;
    const state = report.systemState;
    const beliefs = report.beliefs || {};

    switch (intent) {
      case 'status': {
        const activeCats = state.categoriesLearning.length + state.categoriesStable.length;
        const connectorCount = Object.keys(context.crossConnector.connectorActivity).length;
        let msg = `I've processed ${state.totalEpisodes} learning episodes across ${connectorCount} connector${connectorCount !== 1 ? 's' : ''}. `;
        msg += `Overall confidence: ${(state.overallConfidence * 100).toFixed(0)}%. `;
        if (state.categoriesStable.length > 0) {
          msg += `${state.categoriesStable.join(', ')} ${state.categoriesStable.length === 1 ? 'is' : 'are'} reliably calibrated. `;
        }
        if (state.categoriesLearning.length > 0) {
          msg += `Still building trust in: ${state.categoriesLearning.join(', ')}. `;
        }
        if (state.categoriesVolatile.length > 0) {
          msg += `Volatile categories needing attention: ${state.categoriesVolatile.join(', ')}. `;
        }
        const alertCount = report.alerts.oscillating.length + report.alerts.lowConfidence.length;
        if (alertCount > 0) {
          msg += `I have ${alertCount} alert${alertCount !== 1 ? 's' : ''} to flag. `;
        }
        // Emotional state context
        if (this.emotionalState) {
          msg += this.emotionalState.getSummary();
        }
        return msg.trim();
      }

      case 'explain': {
        const cats = detectCategories(context.query);
        if (cats.length === 0) {
          return 'Which category would you like me to explain? I track: communication, publication, scheduling, financial, destructive, readonly, and general.';
        }
        const parts: string[] = [];
        for (const cat of cats) {
          const belief = beliefs[cat];
          if (belief) {
            parts.push(belief.narrative);
          } else {
            const weight = this.store.getWeight(cat);
            if (weight) {
              const drift = ((weight.currentWeight - weight.baseWeight) / weight.baseWeight * 100).toFixed(1);
              parts.push(`${cat} has a weight of ${weight.currentWeight.toFixed(4)} (${Number(drift) > 0 ? '+' : ''}${drift}% from base) after ${weight.episodeCount} episodes.`);
            } else {
              parts.push(`${cat} has no data yet.`);
            }
          }
        }
        return parts.join(' ');
      }

      case 'predict': {
        const connectors = detectConnectors(context.query);
        const cats = detectCategories(context.query);
        const targetCat = cats.length > 0 ? cats[0] : 'general';
        const weight = this.store.getWeight(targetCat);
        const belief = beliefs[targetCat];
        const multiplier = weight?.currentWeight ?? 1.0;
        let msg = `For a ${targetCat} operation, I'd predict a risk score adjustment of ${(multiplier * 100).toFixed(0)}% of CORD's base score. `;
        if (belief) {
          msg += `My trust level for ${targetCat} is "${belief.trustLevel}" with ${belief.evidence.episodeCount} episodes. `;
          msg += `Trend: ${belief.evidence.recentTrend}. `;
        }
        if (multiplier < 1.0) {
          msg += `I've learned to be less cautious here — CORD has been over-flagging.`;
        } else if (multiplier > 1.0) {
          msg += `I've learned to be more cautious here — CORD has been too permissive.`;
        } else {
          msg += `I'm still at baseline — not enough data to adjust yet.`;
        }
        return msg;
      }

      case 'recommend': {
        const cats = detectCategories(context.query);
        const recommendations: string[] = [];
        for (const cat of (cats.length > 0 ? cats : state.categoriesLearning)) {
          const belief = beliefs[cat];
          if (belief?.trustLevel === 'reliable') {
            recommendations.push(`${cat} is reliably calibrated — safe to increase autonomy.`);
          } else if (belief?.trustLevel === 'building') {
            recommendations.push(`${cat} is still building trust — keep current approval levels.`);
          } else if (belief?.trustLevel === 'volatile') {
            recommendations.push(`${cat} is volatile — I'd recommend more oversight until it stabilizes.`);
          }
        }
        if (recommendations.length === 0) {
          return 'I need more episodes before I can make confident recommendations. Keep processing operations and I\'ll have suggestions soon.';
        }
        return recommendations.join(' ');
      }

      case 'cross-connector': {
        const patterns = context.crossConnector.patterns;
        const activeConnectors = Object.keys(context.crossConnector.connectorActivity);
        if (activeConnectors.length === 0) {
          return 'No connectors have been active yet. Process some emails, tweets, or calendar events and I\'ll start seeing patterns.';
        }
        let msg = `I see activity across ${activeConnectors.join(', ')}. `;
        if (patterns.length > 0) {
          msg += patterns.map(p => p.description).join(' ');
        } else {
          msg += 'No cross-connector patterns detected yet — I need more data across multiple connectors to find connections.';
        }
        return msg;
      }

      case 'introspect': {
        const uncertain: string[] = [];
        const confident: string[] = [];
        for (const [cat, belief] of Object.entries(beliefs)) {
          if (belief.trustLevel === 'insufficient' || belief.trustLevel === 'volatile') {
            uncertain.push(`${cat} (${belief.trustLevel})`);
          } else if (belief.trustLevel === 'reliable') {
            confident.push(cat);
          }
        }
        let msg = '';
        if (uncertain.length > 0) {
          msg += `I'm uncertain about: ${uncertain.join(', ')}. `;
        }
        if (confident.length > 0) {
          msg += `I'm confident about: ${confident.join(', ')}. `;
        }
        if (uncertain.length === 0 && confident.length === 0) {
          msg = 'I\'m still gathering data across all categories. No strong beliefs formed yet.';
        }
        const volatileAlerts = report.alerts.oscillating;
        if (volatileAlerts.length > 0) {
          msg += `Warning: ${volatileAlerts.join(', ')} ${volatileAlerts.length === 1 ? 'is' : 'are'} showing oscillating behavior. `;
        }
        // Emotional state context
        if (this.emotionalState) {
          msg += this.emotionalState.getSummary();
        }
        return msg.trim();
      }

      case 'history': {
        const episodes = context.recentEpisodes;
        const insights = context.recentInsights;
        if (episodes.length === 0) {
          return 'No learning history yet. Process some operations through the pipeline and I\'ll start tracking.';
        }
        const cats = new Set(episodes.map(e => e.category));
        const directions = episodes.filter(e => e.adjustmentDirection !== 'none');
        const decreases = directions.filter(e => e.adjustmentDirection === 'decrease').length;
        const increases = directions.filter(e => e.adjustmentDirection === 'increase').length;
        let msg = `In my recent ${episodes.length} episodes across ${cats.size} categories: `;
        if (decreases > 0) msg += `${decreases} made me less cautious. `;
        if (increases > 0) msg += `${increases} made me more cautious. `;
        if (insights.length > 0) {
          const latest = insights[0];
          msg += `Latest insight: "${latest.summary}" `;
        }
        return msg.trim();
      }

      case 'configure': {
        return 'I adjust my own weights based on outcomes — that\'s my core learning loop. You can influence me by approving or denying operations. If you consistently approve a category, I\'ll become less cautious. If you deny, I\'ll become more cautious. You can also manually adjust weights via POST /api/spark/rollback.';
      }

      case 'diagnose': {
        const failureStep = steps.find(s => s.ruleId === 'diagnose-failures');
        if (failureStep) {
          const breakdown = failureStep.evidence?.breakdown as Record<string, number> | undefined;
          if (breakdown && Object.keys(breakdown).length > 0) {
            const parts = Object.entries(breakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, count]) => `${cat} (${count})`);
            return `I've identified ${failureStep.evidence?.failureCount ?? 0} prediction adjustments. Breakdown by category: ${parts.join(', ')}. ${failureStep.description}`;
          }
          return failureStep.description;
        }
        return state.totalEpisodes === 0
          ? 'No learning episodes yet — nothing to diagnose. Start processing events and I\'ll track accuracy.'
          : 'All predictions have been accurate so far — no issues to diagnose.';
      }

      case 'compare': {
        const compareStep = steps.find(s => s.ruleId === 'compare-categories');
        if (compareStep && compareStep.evidence?.comparison) {
          const comp = compareStep.evidence.comparison as Record<string, Record<string, unknown>>;
          const cats = Object.keys(comp);
          if (cats.length >= 2) {
            const lines = cats.map(cat => {
              const c = comp[cat];
              return `${cat}: weight=${c.weight}, trust=${c.trust}, episodes=${c.episodes}, trend=${c.trend}`;
            });
            const epiA = Number(comp[cats[0]].episodes || 0);
            const epiB = Number(comp[cats[1]].episodes || 0);
            const moreConfident = epiA > epiB ? cats[0] : epiB > epiA ? cats[1] : 'neither';
            return `Comparing ${cats[0]} vs ${cats[1]}:\n${lines.join('\n')}\nI'm more confident about: ${moreConfident} (based on episode count).`;
          }
        }
        return 'I need at least two categories to compare. Try: "Compare communication vs financial"';
      }

      case 'reflect': {
        if (!this.reflectionEngine) {
          return 'Self-reflection engine is not available.';
        }
        const reflection = this.reflectionEngine.reflect();
        let msg = reflection.internalNarrative;
        if (reflection.blindSpots.length > 0) {
          msg += `\n\nBlind spots (${reflection.blindSpots.length}): `;
          msg += reflection.blindSpots.map(bs =>
            `${bs.category} — ${bs.narrative}`
          ).join('; ');
        }
        msg += `\n\nGrowth: ${reflection.growth.direction}. ${reflection.growth.narrative}`;
        return msg;
      }

      default: {
        const totalEp = state.totalEpisodes;
        if (totalEp === 0) {
          return 'I\'m SPARK — your self-learning operations kernel. I don\'t have any data yet. Start processing emails, tweets, or calendar events and I\'ll begin learning from the outcomes.';
        }
        return `I'm SPARK with ${totalEp} episodes of experience. Ask me about my status, what I've learned, what I'm uncertain about, or what connections I see across your connectors.`;
      }
    }
  }

  private generateSuggestions(
    intent: SparkQueryIntent,
    _steps: ReasoningStep[],
    context: InternalReasoningContext,
  ): string[] {
    const suggestions: string[] = [];
    const state = context.awarenessReport.systemState;

    switch (intent) {
      case 'status':
        suggestions.push('What have you learned recently?');
        if (state.categoriesLearning.length > 0) {
          suggestions.push(`Tell me about ${state.categoriesLearning[0]}`);
        }
        suggestions.push('What are you uncertain about?');
        break;

      case 'explain':
        suggestions.push('What connections do you see across connectors?');
        suggestions.push('What would you recommend?');
        break;

      case 'predict':
        suggestions.push('What have you learned about this category?');
        suggestions.push('How confident are you?');
        break;

      case 'recommend':
        suggestions.push('Why do you recommend that?');
        suggestions.push('What\'s your current status?');
        break;

      case 'cross-connector':
        suggestions.push('How are you doing overall?');
        suggestions.push('What have you learned recently?');
        break;

      case 'introspect':
        suggestions.push('What have you learned recently?');
        suggestions.push('What would you recommend?');
        break;

      case 'history':
        suggestions.push('What are you uncertain about?');
        suggestions.push('What connections do you see?');
        break;

      case 'diagnose':
        suggestions.push('Compare communication vs financial');
        suggestions.push('What have you learned recently?');
        suggestions.push('How are you doing overall?');
        break;

      case 'compare':
        suggestions.push('What went wrong recently?');
        suggestions.push('What are you uncertain about?');
        suggestions.push('How are you doing overall?');
        break;

      case 'reflect':
        suggestions.push('How are you doing?');
        suggestions.push('What are you uncertain about?');
        suggestions.push('What have you learned recently?');
        break;

      default:
        suggestions.push('How are you doing?');
        suggestions.push('What have you learned?');
        suggestions.push('What connections do you see across connectors?');
        break;
    }

    return suggestions.slice(0, 3);
  }

  private buildRules(): ReasoningRule[] {
    return [
      // ── StatusSummaryRule ─────────────────────────────────────
      {
        id: 'status-summary',
        intents: ['status'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const state = ctx.awarenessReport.systemState;
          const allBeliefs: Partial<Record<SparkCategory, TrustLevel>> = {};
          for (const [cat, belief] of Object.entries(ctx.awarenessReport.beliefs || {})) {
            allBeliefs[cat as SparkCategory] = belief.trustLevel;
          }
          return {
            ruleId: 'status-summary',
            description: `System has ${state.totalEpisodes} episodes. Confidence: ${(state.overallConfidence * 100).toFixed(0)}%.`,
            evidence: {
              categories: [...state.categoriesLearning, ...state.categoriesStable],
              beliefs: allBeliefs,
            },
            confidence: Math.min(0.9, state.totalEpisodes / 50),
          };
        },
      },

      // ── CategoryExplainRule ──────────────────────────────────
      {
        id: 'category-explain',
        intents: ['explain'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const cats = detectCategories(ctx.query);
          if (cats.length === 0) return null;
          const cat = cats[0];
          const belief = ctx.awarenessReport.beliefs?.[cat];
          if (!belief) return null;
          return {
            ruleId: 'category-explain',
            description: `${cat}: trust=${belief.trustLevel}, trend=${belief.evidence.recentTrend}, episodes=${belief.evidence.episodeCount}`,
            evidence: {
              categories: [cat],
              beliefs: { [cat]: belief.trustLevel },
            },
            confidence: belief.calibration,
          };
        },
      },

      // ── PredictionRule ───────────────────────────────────────
      {
        id: 'prediction',
        intents: ['predict'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const cats = detectCategories(ctx.query);
          const cat = cats.length > 0 ? cats[0] : 'general' as SparkCategory;
          const weight = this.store.getWeight(cat);
          return {
            ruleId: 'prediction',
            description: `${cat} weight multiplier: ${weight?.currentWeight?.toFixed(4) ?? '1.0000'}`,
            evidence: { categories: [cat] },
            confidence: weight ? Math.min(0.9, weight.episodeCount / 20) : 0.1,
          };
        },
      },

      // ── RecommendationRule ───────────────────────────────────
      {
        id: 'recommendation',
        intents: ['recommend'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const reliable = ctx.awarenessReport.systemState.categoriesStable;
          const volatile = ctx.awarenessReport.systemState.categoriesVolatile;
          if (reliable.length === 0 && volatile.length === 0) return null;
          return {
            ruleId: 'recommendation',
            description: `Reliable: [${reliable.join(', ')}]. Volatile: [${volatile.join(', ')}].`,
            evidence: { categories: [...reliable, ...volatile] },
            confidence: 0.7,
          };
        },
      },

      // ── CrossConnectorPatternRule ────────────────────────────
      {
        id: 'cross-connector-pattern',
        intents: ['cross-connector'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const patterns = ctx.crossConnector.patterns;
          if (patterns.length === 0) return null;
          const connectors = [...new Set(patterns.flatMap(p => p.connectors))];
          return {
            ruleId: 'cross-connector-pattern',
            description: `${patterns.length} cross-connector pattern(s) detected across ${connectors.join(', ')}.`,
            evidence: { connectors },
            confidence: Math.max(...patterns.map(p => p.confidence)),
          };
        },
      },

      // ── IntrospectionRule ────────────────────────────────────
      {
        id: 'introspection',
        intents: ['introspect'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const beliefs = ctx.awarenessReport.beliefs || {};
          const uncertain = Object.entries(beliefs)
            .filter(([, b]) => b.trustLevel === 'insufficient' || b.trustLevel === 'volatile')
            .map(([cat]) => cat as SparkCategory);
          if (uncertain.length === 0) return null;
          const beliefMap: Partial<Record<SparkCategory, TrustLevel>> = {};
          uncertain.forEach(c => { beliefMap[c] = beliefs[c].trustLevel; });
          return {
            ruleId: 'introspection',
            description: `${uncertain.length} categories with low confidence: ${uncertain.join(', ')}`,
            evidence: { categories: uncertain, beliefs: beliefMap },
            confidence: 0.8,
          };
        },
      },

      // ── HistoryNarrativeRule ─────────────────────────────────
      {
        id: 'history-narrative',
        intents: ['history'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          if (ctx.recentEpisodes.length === 0) return null;
          const episodeIds = ctx.recentEpisodes.slice(0, 5).map(e => e.id);
          const cats = [...new Set(ctx.recentEpisodes.map(e => e.category))];
          return {
            ruleId: 'history-narrative',
            description: `${ctx.recentEpisodes.length} recent episodes across ${cats.join(', ')}.`,
            evidence: { episodeIds, categories: cats },
            confidence: 0.7,
          };
        },
      },

      // ── ConfigurationAdviceRule ──────────────────────────────
      {
        id: 'configuration-advice',
        intents: ['configure'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const cats = detectCategories(ctx.query);
          if (cats.length === 0) return null;
          const cat = cats[0];
          const weight = this.store.getWeight(cat);
          return {
            ruleId: 'configuration-advice',
            description: `${cat} current weight: ${weight?.currentWeight?.toFixed(4) ?? '1.0000'}. Bounds: [${weight?.lowerBound?.toFixed(2) ?? '0.70'}, ${weight?.upperBound?.toFixed(2) ?? '1.30'}]`,
            evidence: { categories: [cat] },
            confidence: 0.6,
          };
        },
      },

      // ── DiagnoseFailuresRule ───────────────────────────────
      {
        id: 'diagnose-failures',
        intents: ['diagnose'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const episodes = ctx.recentEpisodes;
          const failures = episodes.filter(e =>
            e.adjustmentDirection === 'increase' || e.adjustmentDirection === 'decrease',
          );
          if (failures.length === 0) {
            return {
              ruleId: 'diagnose-failures',
              description: 'No adjustment episodes found — all predictions have been accurate.',
              evidence: { totalEpisodes: episodes.length },
              confidence: 0.8,
            };
          }
          const failureCats = [...new Set(failures.map(e => e.category))];
          const catCounts: Record<string, number> = {};
          for (const f of failures) {
            catCounts[f.category] = (catCounts[f.category] || 0) + 1;
          }
          const worstCat = Object.entries(catCounts).sort(([, a], [, b]) => b - a)[0];
          return {
            ruleId: 'diagnose-failures',
            description: `${failures.length} adjustment episodes across [${failureCats.join(', ')}]. Most affected: ${worstCat[0]} (${worstCat[1]} adjustments).`,
            evidence: {
              categories: failureCats,
              failureCount: failures.length,
              breakdown: catCounts,
            },
            confidence: 0.85,
          };
        },
      },

      // ── CompareCategoriesRule ──────────────────────────────
      {
        id: 'compare-categories',
        intents: ['compare'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const cats = detectCategories(ctx.query);
          if (cats.length < 2) {
            // Try to pick the two most active categories
            const beliefs = ctx.awarenessReport.beliefs || {};
            const sorted = Object.entries(beliefs)
              .sort(([, a], [, b]) => b.evidence.episodeCount - a.evidence.episodeCount);
            if (sorted.length >= 2) {
              cats.length = 0;
              cats.push(sorted[0][0] as SparkCategory, sorted[1][0] as SparkCategory);
            } else {
              return null;
            }
          }
          const [catA, catB] = cats;
          const beliefA = ctx.awarenessReport.beliefs?.[catA];
          const beliefB = ctx.awarenessReport.beliefs?.[catB];
          const weightA = this.store.getWeight(catA);
          const weightB = this.store.getWeight(catB);
          return {
            ruleId: 'compare-categories',
            description: `Comparing ${catA} vs ${catB}.`,
            evidence: {
              categories: [catA, catB],
              comparison: {
                [catA]: {
                  weight: weightA?.currentWeight?.toFixed(4) ?? '1.0000',
                  trust: beliefA?.trustLevel ?? 'unknown',
                  episodes: beliefA?.evidence.episodeCount ?? 0,
                  trend: beliefA?.evidence.recentTrend ?? 'none',
                },
                [catB]: {
                  weight: weightB?.currentWeight?.toFixed(4) ?? '1.0000',
                  trust: beliefB?.trustLevel ?? 'unknown',
                  episodes: beliefB?.evidence.episodeCount ?? 0,
                  trend: beliefB?.evidence.recentTrend ?? 'none',
                },
              },
            },
            confidence: 0.8,
          };
        },
      },

      // ── ReflectionRule ──────────────────────────────────────
      {
        id: 'self-reflection',
        intents: ['reflect'] as SparkQueryIntent[],
        evaluate: (_ctx): ReasoningStep | null => {
          if (!this.reflectionEngine) return null;
          const latest = this.store.getLatestReflection();
          return {
            ruleId: 'self-reflection',
            description: latest
              ? `Last reflection: ${latest.createdAt}. Blind spots: ${latest.blindSpots.length}, Growth: ${latest.growth.direction}.`
              : 'No previous reflections — this will be the first self-assessment.',
            evidence: latest
              ? {
                  blindSpotCount: latest.blindSpots.length,
                  direction: latest.growth.direction,
                }
              : {},
            confidence: 0.9,
          };
        },
      },

      // ── AlertEscalationRule (fires on any intent) ───────────
      {
        id: 'alert-escalation',
        intents: ['status', 'explain', 'predict', 'recommend', 'cross-connector', 'introspect', 'history', 'configure', 'diagnose', 'compare', 'reflect', 'general'] as SparkQueryIntent[],
        evaluate: (ctx): ReasoningStep | null => {
          const alerts = ctx.awarenessReport.alerts;
          const hasAlerts = alerts.oscillating.length > 0
            || alerts.lowConfidence.length > 0
            || alerts.sentinelActive.length > 0;
          if (!hasAlerts) return null;
          const allAlertCats = [
            ...alerts.oscillating,
            ...alerts.lowConfidence,
            ...alerts.sentinelActive,
          ];
          return {
            ruleId: 'alert-escalation',
            description: `Active alerts: oscillating=[${alerts.oscillating.join(',')}], lowConfidence=[${alerts.lowConfidence.join(',')}], sentinel=[${alerts.sentinelActive.join(',')}]`,
            evidence: { categories: allAlertCats },
            confidence: 0.9,
          };
        },
      },
    ];
  }
}
