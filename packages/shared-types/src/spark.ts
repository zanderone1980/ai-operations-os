/**
 * SPARK Types — Self-Perpetuating Adaptive Reasoning Kernel.
 *
 * Data structures for the predict → act → measure → learn feedback loop.
 */

// ── Categories ──────────────────────────────────────────────────

/** CORD tool category that SPARK tracks weights for. */
export type SparkCategory =
  | 'communication'
  | 'publication'
  | 'destructive'
  | 'scheduling'
  | 'financial'
  | 'readonly'
  | 'general';

/** Predicted outcome category for a step. */
export type PredictedOutcome = 'success' | 'partial' | 'failure' | 'escalation';

/** Actual outcome category after step execution. */
export type ActualOutcome = 'success' | 'partial' | 'failure' | 'escalation' | 'blocked';

// ── Prediction ──────────────────────────────────────────────────

/** A prediction made before step execution. */
export interface Prediction {
  /** Unique prediction identifier (UUID v4). */
  id: string;
  /** The step this prediction is for. */
  stepId: string;
  /** The workflow run containing the step. */
  runId: string;
  /** Connector name. */
  connector: string;
  /** Operation name. */
  operation: string;
  /** CORD tool category. */
  category: SparkCategory;
  /** Predicted CORD risk score (0-99). */
  predictedScore: number;
  /** Predicted outcome category. */
  predictedOutcome: PredictedOutcome;
  /** Confidence in this prediction (0.0-1.0). */
  confidence: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Outcome Signal ──────────────────────────────────────────────

/** Measured outcome after step execution. */
export interface OutcomeSignal {
  /** Unique outcome identifier (UUID v4). */
  id: string;
  /** The step this outcome is for. */
  stepId: string;
  /** The workflow run containing the step. */
  runId: string;
  /** What actually happened. */
  actualOutcome: ActualOutcome;
  /** The CORD score that was actually assigned. */
  actualCordScore: number;
  /** The CORD decision that was actually made. */
  actualCordDecision: string;
  /** Individual signal components. */
  signals: {
    /** Did the step complete without error? */
    succeeded: boolean;
    /** Was the step escalated to human approval? */
    escalated: boolean;
    /** Was approval granted (if escalated)? */
    approvalGranted?: boolean;
    /** Step duration in milliseconds. */
    durationMs?: number;
    /** Was there an error? */
    hasError: boolean;
    /** Error message if any. */
    errorMessage?: string;
  };
  /** ISO 8601 measurement timestamp. */
  measuredAt: string;
}

// ── Learning Episode ────────────────────────────────────────────

/** A single learning step comparing prediction against reality. */
export interface LearningEpisode {
  /** Unique episode identifier (UUID v4). */
  id: string;
  /** Link to the prediction. */
  predictionId: string;
  /** Link to the outcome. */
  outcomeId: string;
  /** CORD tool category affected. */
  category: SparkCategory;
  /** Score delta: predicted score - actual score. */
  scoreDelta: number;
  /** Did prediction match reality? */
  outcomeMismatch: boolean;
  /** Direction of weight adjustment. */
  adjustmentDirection: 'increase' | 'decrease' | 'none';
  /** Magnitude of weight adjustment applied. */
  adjustmentMagnitude: number;
  /** Weight value before adjustment. */
  weightBefore: number;
  /** Weight value after adjustment. */
  weightAfter: number;
  /** Human-readable reason for the adjustment. */
  reason: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Weights ─────────────────────────────────────────────────────

/** A single category's learned weight entry. */
export interface SparkWeightEntry {
  /** The CORD tool category. */
  category: SparkCategory;
  /** Current learned weight multiplier (default 1.0). */
  currentWeight: number;
  /** The base weight this category started at (immutable). */
  baseWeight: number;
  /** Lower bound — SENTINEL floor. */
  lowerBound: number;
  /** Upper bound — SENTINEL ceiling. */
  upperBound: number;
  /** Number of learning episodes that have influenced this weight. */
  episodeCount: number;
  /** ISO 8601 timestamp of last adjustment. */
  lastAdjustedAt: string;
}

/** Full weight state across all categories. */
export interface SparkWeights {
  /** Map from category to weight entry. */
  weights: Record<SparkCategory, SparkWeightEntry>;
  /** Schema version. */
  version: string;
  /** ISO 8601 timestamp of last persistence. */
  updatedAt: string;
}

// ── Weight History ──────────────────────────────────────────────

/** Historical record of a weight change. */
export interface WeightHistoryEntry {
  /** Unique entry identifier (UUID v4). */
  id: string;
  /** Which category was adjusted. */
  category: SparkCategory;
  /** Weight before the change. */
  previousWeight: number;
  /** Weight after the change. */
  newWeight: number;
  /** The learning episode that caused this change. */
  episodeId: string;
  /** Snapshot ID for rollback capability. */
  snapshotId: string;
  /** Human-readable reason. */
  reason: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── SENTINEL ────────────────────────────────────────────────────

/**
 * Categories protected by SENTINEL constitutional rules.
 * Their lower bounds can NEVER go below base weight (1.0).
 * The system can only become MORE cautious about these, never less.
 */
export const SENTINEL_CATEGORIES: readonly SparkCategory[] = [
  'destructive',
  'financial',
] as const;

// ── Memory Consolidation ────────────────────────────────────────

/** Pattern type detected by the Memory Consolidation Engine. */
export type InsightPattern =
  | 'streak'
  | 'oscillation'
  | 'convergence'
  | 'anomaly'
  | 'milestone';

/** A compressed insight generated from analyzing episode patterns. */
export interface Insight {
  /** Unique insight identifier (UUID v4). */
  id: string;
  /** The category this insight relates to. */
  category: SparkCategory;
  /** The type of pattern detected. */
  pattern: InsightPattern;
  /** Human-readable summary of the detected pattern. */
  summary: string;
  /** Evidence supporting this insight. */
  evidence: {
    /** Episode IDs that contributed to this insight. */
    episodeIds: string[];
    /** Time window over which the pattern was observed. */
    window: { from: string; to: string };
  };
  /** Significance score (0.0-1.0). Higher = more noteworthy. */
  impact: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Self-Knowledge ──────────────────────────────────────────────

/** Trust classification for a category based on learning history. */
export type TrustLevel = 'reliable' | 'building' | 'volatile' | 'insufficient';

/** Direction of recent weight trend for a category. */
export type TrendDirection = 'improving' | 'stable' | 'degrading' | 'oscillating';

/** A structured belief about a single category's learning state. */
export interface Belief {
  /** The category this belief describes. */
  category: SparkCategory;
  /** Overall trust classification. */
  trustLevel: TrustLevel;
  /** Stability index (0.0-1.0). Higher = more stable weight history. */
  stability: number;
  /** Calibration score (0.0-1.0). How well confidence matches actual accuracy. */
  calibration: number;
  /** Natural language narrative describing what the system believes. */
  narrative: string;
  /** Structured evidence supporting this belief. */
  evidence: {
    /** Total episodes for this category. */
    episodeCount: number;
    /** Proportion of correct predictions (0.0-1.0). */
    accuracy: number;
    /** Direction of recent weight changes. */
    recentTrend: TrendDirection;
    /** Current streak direction, if any. */
    streakDirection: 'up' | 'down' | 'none';
    /** Length of current streak (0 if none). */
    streakLength: number;
  };
  /** ISO 8601 timestamp of last belief update. */
  updatedAt: string;
}

/** Full self-assessment report generated by the Awareness Engine. */
export interface AwarenessReport {
  /** Beliefs about each category. */
  beliefs: Record<SparkCategory, Belief>;
  /** High-level system state summary. */
  systemState: {
    /** Weighted average confidence across categories. */
    overallConfidence: number;
    /** Total learning episodes across all categories. */
    totalEpisodes: number;
    /** Categories currently in active learning (building trust). */
    categoriesLearning: SparkCategory[];
    /** Categories with stable, reliable weights. */
    categoriesStable: SparkCategory[];
    /** Categories showing volatile/oscillating behavior. */
    categoriesVolatile: SparkCategory[];
  };
  /** Recent high-impact insights from memory consolidation. */
  insights: Insight[];
  /** Alert conditions requiring attention. */
  alerts: {
    /** Categories with oscillating weight adjustments. */
    oscillating: SparkCategory[];
    /** Categories with low prediction confidence. */
    lowConfidence: SparkCategory[];
    /** Categories whose weights are near upper/lower bounds. */
    nearingBounds: SparkCategory[];
    /** SENTINEL categories that are currently active/elevated. */
    sentinelActive: SparkCategory[];
  };
  /** Report metadata. */
  meta: {
    /** Monotonically increasing report version. */
    reportVersion: number;
    /** ISO 8601 timestamp of report generation. */
    generatedAt: string;
    /** Episode time window covered by this report. */
    episodeWindow: { from: string; to: string };
  };
}

// ── Reasoning ──────────────────────────────────────────────────

/** The intent type for conversational queries to SPARK. */
export type SparkQueryIntent =
  | 'status'
  | 'explain'
  | 'predict'
  | 'recommend'
  | 'cross-connector'
  | 'introspect'
  | 'history'
  | 'configure'
  | 'diagnose'
  | 'compare'
  | 'reflect'
  | 'general';

/** Confidence-scored intent classification result. */
export interface IntentClassification {
  /** The best-matching intent. */
  intent: SparkQueryIntent;
  /** Confidence in the primary intent (0.0–1.0). */
  confidence: number;
  /** Other plausible intents, sorted by descending confidence. */
  alternatives: Array<{ intent: SparkQueryIntent; confidence: number }>;
  /** True if the second-best intent is within 80% of the best score. */
  ambiguous: boolean;
}

/** A single reasoning step SPARK took to arrive at a response. */
export interface ReasoningStep {
  /** Which rule or heuristic produced this step. */
  ruleId: string;
  /** Human-readable description of the reasoning. */
  description: string;
  /** Evidence that triggered this reasoning step. */
  evidence: {
    categories?: SparkCategory[];
    connectors?: string[];
    episodeIds?: string[];
    insightIds?: string[];
    beliefs?: Partial<Record<SparkCategory, TrustLevel>>;
    /** Additional evidence fields for specific rules (diagnose breakdown, compare comparison, etc.) */
    [key: string]: unknown;
  };
  /** Confidence in this reasoning step (0.0-1.0). */
  confidence: number;
}

/** The full result of a reasoning operation. */
export interface ReasoningResult {
  /** Unique identifier for this reasoning result. */
  id: string;
  /** The query intent that was classified. */
  queryIntent: SparkQueryIntent;
  /** Intent classification with confidence scoring. */
  classification?: IntentClassification;
  /** Ordered list of reasoning steps. */
  steps: ReasoningStep[];
  /** The composed natural language response. */
  response: string;
  /** Suggested follow-up questions. */
  suggestions: string[];
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** A conversation turn (user message + SPARK response). */
export interface ConversationTurn {
  /** Unique turn identifier. */
  id: string;
  /** The conversation this turn belongs to. */
  conversationId: string;
  /** 'user' or 'spark'. */
  role: 'user' | 'spark';
  /** The message content. */
  content: string;
  /** The reasoning result (only for spark turns). */
  reasoningResult?: ReasoningResult;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** A conversation session. */
export interface Conversation {
  /** Unique conversation identifier. */
  id: string;
  /** ISO 8601 timestamp of creation. */
  createdAt: string;
  /** ISO 8601 timestamp of last activity. */
  lastActivityAt: string;
  /** Number of turns in this conversation. */
  turnCount: number;
}

/** The cross-connector activity context assembled for reasoning. */
export interface CrossConnectorContext {
  /** Recent activity per connector. */
  connectorActivity: Record<string, {
    recentOperations: string[];
    recentOutcomes: ActualOutcome[];
    episodeCount: number;
    lastActivityAt: string | null;
  }>;
  /** Active cross-connector patterns detected. */
  patterns: CrossConnectorPattern[];
  /** Current system-wide state from AwarenessReport. */
  systemState: AwarenessReport['systemState'];
}

/** A detected cross-connector pattern. */
export interface CrossConnectorPattern {
  /** Pattern type identifier. */
  type: 'email-to-calendar' | 'social-to-store' | 'email-to-social' | 'store-to-email' | 'slack-to-email' | 'notion-to-calendar' | 'slack-to-notion' | 'general';
  /** Human-readable description. */
  description: string;
  /** Connectors involved. */
  connectors: string[];
  /** Confidence score (0.0-1.0). */
  confidence: number;
}

// ── Emotional State ────────────────────────────────────────────

/** Emotional momentum direction. */
export type EmotionalMomentum = 'improving' | 'declining' | 'stable';

/** Current emotional state snapshot — the system's affective baseline. */
export interface EmotionalState {
  /** Running valence average (-1.0 to 1.0). Negative = negative affect, positive = positive affect. */
  valence: number;
  /** Direction of emotional trend. */
  momentum: EmotionalMomentum;
  /** Variance in recent sentiment (0.0 to 1.0). High = emotionally turbulent. */
  volatility: number;
  /** Count of high-emotion events tracked in the current window. */
  highEmotionCount: number;
  /** ISO 8601 timestamp of last emotional state update. */
  lastUpdatedAt: string;
}

// ── Self-Reflection ────────────────────────────────────────────

/** A blind spot detected during self-reflection. */
export interface BlindSpot {
  /** The category with insufficient coverage. */
  category: SparkCategory;
  /** Number of learning episodes in this category. */
  episodeCount: number;
  /** Current confidence level. */
  confidence: number;
  /** Human-readable description of the blind spot. */
  narrative: string;
}

/** Growth direction assessment. */
export type GrowthDirection = 'growing' | 'stagnating' | 'regressing';

/** Growth assessment comparing current vs. previous reflection. */
export interface GrowthAssessment {
  /** Overall growth direction. */
  direction: GrowthDirection;
  /** Categories that improved since last reflection. */
  categoriesImproved: SparkCategory[];
  /** Categories that declined since last reflection. */
  categoriesDeclined: SparkCategory[];
  /** Net improvement score (-1.0 to 1.0). */
  overallDelta: number;
  /** Human-readable growth narrative. */
  narrative: string;
}

/** Result of a self-reflection cycle. */
export interface ReflectionResult {
  /** Unique reflection identifier (UUID v4). */
  id: string;
  /** Detected blind spots (categories with low coverage). */
  blindSpots: BlindSpot[];
  /** Growth assessment vs. last reflection. */
  growth: GrowthAssessment;
  /** Emotional context summary at time of reflection. */
  emotionalSummary: string;
  /** Generated internal narrative about the learning process. */
  internalNarrative: string;
  /** ID of the memory token created for this reflection (if any). */
  tokenId: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

// ── Spiral Memory ──────────────────────────────────────────────

/** Sentiment valence for an essence extraction. */
export type SentimentValence = 'positive' | 'negative' | 'neutral' | 'mixed';

/** The type of a memory token. */
export type MemoryTokenType =
  | 'conversation'
  | 'episode'
  | 'insight'
  | 'belief'
  | 'cross-connector'
  | 'composite'
  | 'reflection';

/** Compression tier — controls detail level based on age. */
export type CompressionTier = 'raw' | 'recent' | 'compressed' | 'archival';

/** A decision point captured from an interaction. */
export interface DecisionPoint {
  description: string;
  choice: string | null;
  alternatives: string[];
  confidence: number;
}

/** An extracted relationship between two concepts. */
export interface EssenceRelationship {
  from: string;
  to: string;
  type: string;
  strength: number;
}

/** The extracted essence from a piece of content. */
export interface Essence {
  topics: string[];
  sentiment: SentimentValence;
  sentimentIntensity: number;
  relationships: EssenceRelationship[];
  decisionPoints: DecisionPoint[];
  importance: number;
  categories: SparkCategory[];
  connectors: string[];
  gist: string;
}

/** A memory token — the atomic unit of spiral memory. */
export interface MemoryToken {
  id: string;
  type: MemoryTokenType;
  tier: CompressionTier;
  essence: Essence;
  strength: number;
  spiralCount: number;
  sourceId: string;
  mergedFrom: string[];
  createdAt: string;
  lastSpiralAt: string;
  archivedAt: string | null;
}

/** An edge connecting two memory tokens in the graph. */
export interface MemoryEdge {
  id: string;
  fromTokenId: string;
  toTokenId: string;
  type: string;
  weight: number;
  reinforceCount: number;
  createdAt: string;
  lastReinforcedAt: string;
}

/** Reconstructed context produced by the Spiral Memory. */
export interface ReconstructedContext {
  narrative: string;
  tokenIds: string[];
  edgeIds: string[];
  relevantTopics: string[];
  overallSentiment: SentimentValence;
  relevantDecisions: DecisionPoint[];
  confidence: number;
}
