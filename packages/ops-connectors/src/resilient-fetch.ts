/**
 * Resilient Fetch — Retry + rate-limit-aware HTTP client for connectors.
 *
 * Wraps native fetch() with:
 * - Automatic retries with exponential backoff
 * - Rate limit detection (429) with Retry-After header support
 * - Configurable max retries and initial delay
 * - Request timeout support
 * - Jitter to prevent thundering herd
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResilientFetchOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum backoff delay in ms (default: 30000) */
  maxDelayMs?: number;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** HTTP status codes that trigger a retry (default: [429, 500, 502, 503, 504]) */
  retryableStatuses?: number[];
}

export interface FetchAttemptResult {
  response: Response;
  attempts: number;
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<ResilientFetchOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  timeoutMs: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Add jitter (0-25% of delay) to prevent thundering herd.
 */
function addJitter(delayMs: number): number {
  return delayMs + Math.random() * delayMs * 0.25;
}

/**
 * Parse Retry-After header value.
 * Supports both seconds (integer) and HTTP-date formats.
 * Returns delay in milliseconds, or null if not parseable.
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;

  // Try as integer (seconds)
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try as HTTP-date
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

/**
 * Fetch with automatic retries, exponential backoff, and rate limit awareness.
 *
 * @example
 * ```ts
 * const { response, attempts } = await resilientFetch(
 *   'https://api.example.com/data',
 *   { method: 'GET', headers: { Authorization: 'Bearer token' } },
 *   { maxRetries: 3, timeoutMs: 10000 },
 * );
 * ```
 */
export async function resilientFetch(
  url: string,
  init?: RequestInit,
  options?: ResilientFetchOptions,
): Promise<FetchAttemptResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      // Add timeout via AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Success — return immediately
      if (response.ok || !opts.retryableStatuses.includes(response.status)) {
        return {
          response,
          attempts: attempt + 1,
          totalDurationMs: Date.now() - startTime,
        };
      }

      // Retryable status — calculate delay
      if (attempt < opts.maxRetries) {
        let delayMs: number;

        if (response.status === 429) {
          // Rate limited — respect Retry-After header
          const retryAfter = parseRetryAfter(
            response.headers.get('Retry-After'),
          );
          delayMs = retryAfter ?? opts.initialDelayMs * Math.pow(2, attempt);
        } else {
          // Server error — exponential backoff
          delayMs = opts.initialDelayMs * Math.pow(2, attempt);
        }

        delayMs = Math.min(addJitter(delayMs), opts.maxDelayMs);
        await sleep(delayMs);
      } else {
        // Final attempt failed with retryable status — return the response anyway
        return {
          response,
          attempts: attempt + 1,
          totalDurationMs: Date.now() - startTime,
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Abort errors (timeout) are not retryable
      if (lastError.name === 'AbortError') {
        throw new Error(`Request timed out after ${opts.timeoutMs}ms: ${url}`);
      }

      // Network errors are retryable
      if (attempt < opts.maxRetries) {
        const delayMs = Math.min(
          addJitter(opts.initialDelayMs * Math.pow(2, attempt)),
          opts.maxDelayMs,
        );
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted
  throw lastError ?? new Error(`All ${opts.maxRetries + 1} attempts failed: ${url}`);
}

// ---------------------------------------------------------------------------
// Per-connector rate limiter (token bucket)
// ---------------------------------------------------------------------------

export interface RateLimiterOptions {
  /** Maximum requests per window (default: 60) */
  maxRequests?: number;
  /** Window duration in ms (default: 60000 = 1 minute) */
  windowMs?: number;
}

/**
 * Simple sliding-window rate limiter.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60000 });
 * if (limiter.canProceed()) {
 *   limiter.record();
 *   await fetch(...);
 * }
 * ```
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(options?: RateLimiterOptions) {
    this.maxRequests = options?.maxRequests ?? 60;
    this.windowMs = options?.windowMs ?? 60000;
  }

  /** Remove expired timestamps from the window. */
  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  /** Check if a request can proceed without exceeding the rate limit. */
  canProceed(): boolean {
    this.prune();
    return this.timestamps.length < this.maxRequests;
  }

  /** Record a request timestamp. */
  record(): void {
    this.timestamps.push(Date.now());
  }

  /** Get remaining requests in the current window. */
  get remaining(): number {
    this.prune();
    return Math.max(0, this.maxRequests - this.timestamps.length);
  }

  /** Get milliseconds until the next request slot opens. */
  get retryAfterMs(): number {
    this.prune();
    if (this.timestamps.length < this.maxRequests) return 0;
    return this.timestamps[0] + this.windowMs - Date.now();
  }

  /**
   * Wait until a request slot is available, then record and proceed.
   * Returns the wait time in ms (0 if immediate).
   */
  async waitAndRecord(): Promise<number> {
    const waitMs = this.retryAfterMs;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    this.record();
    return waitMs;
  }

  /** Reset the limiter. */
  reset(): void {
    this.timestamps = [];
  }
}
