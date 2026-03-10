/**
 * Rate Limiting Middleware — Unit Tests
 */

import type * as http from 'http';
import { createRateLimiter } from '../middleware/rate-limit';
import type { RateLimitOptions } from '../middleware/rate-limit';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockReq(ip: string = '127.0.0.1'): http.IncomingMessage {
  return {
    headers: {},
    socket: { remoteAddress: ip },
  } as any;
}

function mockReqWithForwarded(ip: string): http.IncomingMessage {
  return {
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: '10.0.0.1' },
  } as any;
}

function mockRes(): http.ServerResponse & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res: any = {
    _headers: headers,
    setHeader(name: string, value: string) { headers[name] = value; },
  };
  return res;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createRateLimiter', () => {
  let limiter: ReturnType<typeof createRateLimiter>;

  afterEach(() => {
    if (limiter) limiter.stop();
  });

  test('allows requests under the limit', () => {
    limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const req = mockReq();

    for (let i = 0; i < 5; i++) {
      const result = limiter.check(req);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  test('blocks requests over the limit with 429 semantics', () => {
    limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
    const req = mockReq();

    // Use up all 3 requests
    limiter.check(req);
    limiter.check(req);
    limiter.check(req);

    // 4th request should be blocked
    const result = limiter.check(req);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(3);
  });

  test('resets after window expires', async () => {
    limiter = createRateLimiter({ windowMs: 100, maxRequests: 2 });
    const req = mockReq();

    // Use up all requests
    limiter.check(req);
    limiter.check(req);

    // Should be blocked
    const blocked = limiter.check(req);
    expect(blocked.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be allowed again
    const afterReset = limiter.check(req);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(1);
  });

  test('different keys are tracked separately', () => {
    limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req1 = mockReq('192.168.1.1');
    const req2 = mockReq('192.168.1.2');

    // Use up all requests for IP 1
    limiter.check(req1);
    limiter.check(req1);
    const blocked = limiter.check(req1);
    expect(blocked.allowed).toBe(false);

    // IP 2 should still be allowed
    const result = limiter.check(req2);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  test('headers are present in response', () => {
    limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
    const req = mockReq();
    const res = mockRes();

    const result = limiter.check(req);
    limiter.setHeaders(res, result);

    expect(res._headers['X-RateLimit-Limit']).toBe('10');
    expect(res._headers['X-RateLimit-Remaining']).toBe('9');
    expect(res._headers['X-RateLimit-Reset']).toBeDefined();
    // Reset should be a Unix timestamp in seconds
    const resetTs = parseInt(res._headers['X-RateLimit-Reset'], 10);
    expect(resetTs).toBeGreaterThan(0);
  });

  test('headers show 0 remaining when blocked', () => {
    limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const req = mockReq();
    const res = mockRes();

    // Use up the single allowed request
    limiter.check(req);

    // Next request should be blocked
    const result = limiter.check(req);
    limiter.setHeaders(res, result);

    expect(result.allowed).toBe(false);
    expect(res._headers['X-RateLimit-Limit']).toBe('1');
    expect(res._headers['X-RateLimit-Remaining']).toBe('0');
  });

  test('uses x-forwarded-for header when present', () => {
    limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req = mockReqWithForwarded('203.0.113.50');

    limiter.check(req);
    limiter.check(req);
    const blocked = limiter.check(req);
    expect(blocked.allowed).toBe(false);

    // A request from a different forwarded IP should still be allowed
    const req2 = mockReqWithForwarded('203.0.113.51');
    const result = limiter.check(req2);
    expect(result.allowed).toBe(true);
  });

  test('custom keyExtractor is used', () => {
    const options: RateLimitOptions = {
      windowMs: 60_000,
      maxRequests: 2,
      keyExtractor: (req: http.IncomingMessage) => {
        const auth = req.headers.authorization;
        return typeof auth === 'string' ? auth : 'anonymous';
      },
    };
    limiter = createRateLimiter(options);

    const req1 = { headers: { authorization: 'Bearer token-a' }, socket: {} } as any;
    const req2 = { headers: { authorization: 'Bearer token-b' }, socket: {} } as any;

    // Exhaust token-a
    limiter.check(req1);
    limiter.check(req1);
    const blocked = limiter.check(req1);
    expect(blocked.allowed).toBe(false);

    // token-b should still be allowed
    const result = limiter.check(req2);
    expect(result.allowed).toBe(true);
  });

  test('reset() clears all stored data', () => {
    limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req = mockReq();

    limiter.check(req);
    limiter.check(req);
    const blocked = limiter.check(req);
    expect(blocked.allowed).toBe(false);

    // Reset clears everything
    limiter.reset();

    const result = limiter.check(req);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  test('default options allow 100 requests', () => {
    limiter = createRateLimiter();
    const req = mockReq();

    const result = limiter.check(req);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(99);
  });

  test('limit field always reflects configured maxRequests', () => {
    limiter = createRateLimiter({ maxRequests: 50 });
    const req = mockReq();

    const r1 = limiter.check(req);
    expect(r1.limit).toBe(50);

    // Even after multiple checks, limit stays the same
    for (let i = 0; i < 49; i++) {
      limiter.check(req);
    }

    const blocked = limiter.check(req);
    expect(blocked.limit).toBe(50);
    expect(blocked.allowed).toBe(false);
  });

  test('resetAt is a future timestamp', () => {
    limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
    const req = mockReq();
    const now = Date.now();

    const result = limiter.check(req);
    expect(result.resetAt).toBeGreaterThan(now);
    expect(result.resetAt).toBeLessThanOrEqual(now + 60_000 + 100); // small buffer
  });
});
