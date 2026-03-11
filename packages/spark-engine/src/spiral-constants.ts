/**
 * Spiral Memory Constants — Tuning parameters for the essence-based
 * spiral memory architecture.
 */

// ── Spiral Loop ──────────────────────────────────────────────────

/** How fast matching tokens get reinforced. */
export const REINFORCE_RATE = 0.15;

/** How fast contradicted tokens decay. */
export const DECAY_RATE = 0.1;

/** Passive decay per day for untouched tokens. */
export const PASSIVE_DECAY_PER_DAY = 0.02;

/** How fast edge weights grow on reinforcement. */
export const EDGE_REINFORCE_RATE = 0.1;

/** Exponential edge decay rate per day (edges lose relevance over time). */
export const EDGE_DECAY_RATE = 0.05;

/** Edge weight threshold below which edges are pruned during maintenance. */
export const EDGE_PRUNE_THRESHOLD = 0.05;

/** Exponential token decay rate per day (replaces linear PASSIVE_DECAY_PER_DAY). */
export const TOKEN_DECAY_RATE = 0.03;

/** Minimum topic similarity for auto-merge candidates (same-type tokens). */
export const AUTO_MERGE_SIMILARITY_THRESHOLD = 0.8;

/** Minimum topic similarity to trigger reinforcement. */
export const MIN_SIMILARITY_THRESHOLD = 0.2;

/** Maximum new edges created per spiral pass. */
export const MAX_CONNECTIONS_PER_PASS = 5;

// ── Memory Token Management ─────────────────────────────────────

/** Starting strength for new tokens. */
export const INITIAL_TOKEN_STRENGTH = 0.5;

/** Tokens below this strength get archived. */
export const ARCHIVE_STRENGTH_THRESHOLD = 0.05;

/** Raw tier: < 1 hour old. */
export const RAW_TIER_MS = 60 * 60 * 1000;

/** Recent tier: < 24 hours old. */
export const RECENT_TIER_MS = 24 * 60 * 60 * 1000;

/** Compressed tier: < 7 days old. */
export const COMPRESSED_TIER_MS = 7 * 24 * 60 * 60 * 1000;

// ── Context Reconstruction ──────────────────────────────────────

/** Maximum graph walk depth during context reconstruction. */
export const MAX_GRAPH_DEPTH = 5;

/** Initial (shallow) graph depth — expand if too few tokens found. */
export const INITIAL_GRAPH_DEPTH = 3;

/** Maximum tokens used for context reconstruction. */
export const MAX_CONTEXT_TOKENS = 15;

/** Tier weights for scoring during reconstruction. */
export const TIER_WEIGHTS: Record<string, number> = {
  raw: 1.0,
  recent: 0.8,
  compressed: 0.6,
  archival: 0.4,
};

// ── Essence Extraction ──────────────────────────────────────────

/** Maximum topics per extraction. */
export const MAX_TOPICS_PER_EXTRACTION = 10;

/** Minimum word length for topic extraction. */
export const MIN_WORD_LENGTH = 3;

/** Maximum gist length in characters. */
export const GIST_MAX_LENGTH = 120;

// ── Stop Words ──────────────────────────────────────────────────

export const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if',
  'while', 'about', 'against', 'it', 'its', 'this', 'that', 'these',
  'those', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she',
  'him', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
  'up', 'out', 'off', 'over', 'any', 'also', 'back', 'now', 'well',
  'much', 'even', 'new', 'one', 'two', 'first', 'last', 'long', 'great',
  'little', 'right', 'still', 'get', 'make', 'like', 'know', 'take',
  'come', 'go', 'see', 'think', 'look', 'want', 'give', 'use', 'find',
  'tell', 'ask', 'work', 'seem', 'feel', 'try', 'leave', 'call', 'need',
  'become', 'keep', 'let', 'begin', 'show', 'hear', 'play', 'run',
  'move', 'live', 'happen', 'say', 'said', 'i', 'am', 'im', 'ive',
  'dont', 'doesnt', 'didnt', 'wont', 'wouldnt', 'couldnt', 'shouldnt',
  'cant', 'isnt', 'arent', 'wasnt', 'werent', 'havent', 'hasnt', 'hadnt',
]);

// ── Sentiment Lexicons ──────────────────────────────────────────

export const POSITIVE_LEXICON: ReadonlySet<string> = new Set([
  'good', 'great', 'excellent', 'improved', 'success', 'successful',
  'approve', 'approved', 'trust', 'trusted', 'reliable', 'confident',
  'stable', 'accurate', 'correct', 'safe', 'secure', 'positive',
  'effective', 'efficient', 'optimal', 'progress', 'gained', 'growth',
  'strong', 'strengthen', 'converge', 'converging', 'convergence',
  'calibrated', 'consistent', 'resilient', 'robust', 'clear',
  'precise', 'well', 'better', 'best', 'increase', 'increased',
  'allow', 'allowed', 'complete', 'completed', 'resolved', 'fixed',
  'healthy', 'balanced', 'smooth', 'predictable', 'confirmed',
  'verified', 'valid', 'accepted', 'achieved', 'accomplished',
  'ready', 'solid', 'certain', 'sure', 'helpful', 'beneficial',
  'favorable', 'promising', 'improving', 'learning', 'adapted',
]);

export const NEGATIVE_LEXICON: ReadonlySet<string> = new Set([
  'bad', 'fail', 'failed', 'failure', 'error', 'errors', 'volatile',
  'deny', 'denied', 'risk', 'risky', 'dangerous', 'unstable',
  'reject', 'rejected', 'wrong', 'cautious', 'block', 'blocked',
  'oscillating', 'oscillation', 'anomaly', 'anomalous', 'mismatch',
  'degrading', 'degraded', 'decline', 'declined', 'decrease',
  'decreased', 'concern', 'concerning', 'warning', 'alert',
  'threat', 'vulnerable', 'uncertain', 'uncertainty', 'insufficient',
  'inadequate', 'problem', 'problematic', 'issue', 'critical',
  'severe', 'broken', 'crash', 'crashed', 'timeout', 'slow',
  'weak', 'weakened', 'inconsistent', 'inaccurate', 'unreliable',
  'negative', 'harmful', 'destructive', 'overridden', 'escalated',
  'suspicious', 'deviation', 'drift', 'drifting', 'lost',
]);

/** Words that intensify the next sentiment word. */
export const INTENSIFIERS: ReadonlyMap<string, number> = new Map([
  ['very', 1.5],
  ['extremely', 2.0],
  ['quite', 1.3],
  ['somewhat', 0.7],
  ['slightly', 0.5],
  ['really', 1.5],
  ['highly', 1.8],
  ['incredibly', 2.0],
  ['significantly', 1.6],
  ['particularly', 1.4],
  ['especially', 1.5],
]);

/** Words that negate the next sentiment word. */
export const NEGATION_WORDS: ReadonlySet<string> = new Set([
  'not', 'no', 'never', 'neither', 'nobody', 'nothing',
  'nowhere', 'nor', 'hardly', 'barely', 'scarcely',
]);
