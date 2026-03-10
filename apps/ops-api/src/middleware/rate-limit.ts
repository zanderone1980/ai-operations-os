/**
 * Rate Limiting Middleware — In-memory sliding window rate limiter.
 *
 * Zero external dependencies. Tracks requests per key (default: IP)
 * using a sliding window algorithm with automatic cleanup.
 */

import type * as http from 'http';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Maximum requests per window per key (default: 100) */
  maxRequests?: number;
  /** Function to extract the rate-limit key from a request (default: IP address) */
  keyExtractor?: (req: http.IncomingMessage) => string;
}

interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

// ── Rate Limiter Factory ────────────────────────────────────────────────────

/**
 * Create a rate limiter middleware function.
 *
 * Returns a function that checks whether a request should be allowed
 * based on the sliding window rate limit. Also sets response headers.
 *
 * Usage:
 * ```ts
 * const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 100 });
 * // In request handler:
 * const result = limiter.check(req);
 * if (!result.allowed) { sendError(res, 429, 'Too many requests'); return; }
 * limiter.setHeaders(res, result);
 * ```
 */
export function createRateLimiter(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 100;
  const keyExtractor = options.keyExtractor ?? defaultKeyExtractor;

  const store = new Map<string, RateLimitEntry>();

  // Auto-cleanup of old entries every 5 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      // Remove timestamps outside the window
      entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
      // Remove the entry entirely if empty
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Allow the timer to not prevent process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  /**
   * Check whether a request is within the rate limit.
   */
  function check(req: http.IncomingMessage): RateLimitResult {
    const key = keyExtractor(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Remove timestamps outside the current window (sliding window)
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    // Calculate reset time: earliest timestamp in window + windowMs,
    // or now + windowMs if no previous requests
    const resetAt = entry.timestamps.length > 0
      ? entry.timestamps[0] + windowMs
      : now + windowMs;

    if (entry.timestamps.length >= maxRequests) {
      return {
        allowed: false,
        limit: maxRequests,
        remaining: 0,
        resetAt,
      };
    }

    // Record this request
    entry.timestamps.push(now);

    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests - entry.timestamps.length,
      resetAt,
    };
  }

  /**
   * Set standard rate-limit response headers.
   */
  function setHeaders(res: http.ServerResponse, result: RateLimitResult): void {
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
  }

  /**
   * Stop the cleanup interval (for testing or graceful shutdown).
   */
  function stop(): void {
    clearInterval(cleanupInterval);
  }

  /**
   * Clear all stored rate limit data (useful for testing).
   */
  function reset(): void {
    store.clear();
  }

  return { check, setHeaders, stop, reset };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Default key extractor: uses the client IP address.
 */
function defaultKeyExtractor(req: http.IncomingMessage): string {
  // Check common proxy headers first
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}
