import { resilientFetch, RateLimiter } from '../resilient-fetch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(headers),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// resilientFetch
// ---------------------------------------------------------------------------

describe('resilientFetch', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns on first successful response', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result.response.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns non-retryable error responses immediately', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));

    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result.response.status).toBe(404);
    expect(result.attempts).toBe(1);
  });

  it('retries on 500 and succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result.response.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('retries on 429 and respects Retry-After seconds header', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const start = Date.now();
    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result.response.ok).toBe(true);
    expect(result.attempts).toBe(2);
    // Should have waited at least ~1000ms for Retry-After: 1
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  });

  it('retries on 503 with exponential backoff', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result.response.ok).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('returns last response after exhausting retries', async () => {
    fetchSpy
      .mockResolvedValue(jsonResponse({}, 500));

    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 2,
      initialDelayMs: 10,
    });

    expect(result.response.status).toBe(500);
    expect(result.attempts).toBe(3); // initial + 2 retries
  });

  it('retries on network errors and eventually succeeds', async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result.response.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('throws after exhausting retries on network errors', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      resilientFetch('https://api.test.com/data', undefined, {
        maxRetries: 1,
        initialDelayMs: 10,
      }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('throws on timeout (AbortError) without retrying', async () => {
    fetchSpy.mockImplementation(
      () =>
        new Promise((_, reject) => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          setTimeout(() => reject(err), 5);
        }),
    );

    await expect(
      resilientFetch('https://api.test.com/data', undefined, {
        maxRetries: 3,
        initialDelayMs: 10,
        timeoutMs: 50,
      }),
    ).rejects.toThrow('timed out');
  });

  it('passes request init options through to fetch', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));

    await resilientFetch(
      'https://api.test.com/data',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'value' }),
      },
      { maxRetries: 0 },
    );

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"key":"value"}');
  });

  it('uses custom retryableStatuses', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, 418))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 3,
      initialDelayMs: 10,
      retryableStatuses: [418],
    });

    expect(result.response.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('reports totalDurationMs', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));

    const result = await resilientFetch('https://api.test.com/data', undefined, {
      maxRetries: 0,
    });

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.totalDurationMs).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  it('allows requests within the limit', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60000 });

    expect(limiter.canProceed()).toBe(true);
    limiter.record();
    expect(limiter.canProceed()).toBe(true);
    limiter.record();
    expect(limiter.canProceed()).toBe(true);
    limiter.record();
    expect(limiter.canProceed()).toBe(false);
  });

  it('reports remaining requests', () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });

    expect(limiter.remaining).toBe(5);
    limiter.record();
    expect(limiter.remaining).toBe(4);
    limiter.record();
    limiter.record();
    expect(limiter.remaining).toBe(2);
  });

  it('prunes expired timestamps', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 50 });

    limiter.record();
    limiter.record();
    expect(limiter.canProceed()).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    expect(limiter.canProceed()).toBe(true);
    expect(limiter.remaining).toBe(2);
  });

  it('returns retryAfterMs when limit is reached', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60000 });

    limiter.record();
    expect(limiter.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.retryAfterMs).toBeLessThanOrEqual(60000);
  });

  it('returns 0 retryAfterMs when under limit', () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

    expect(limiter.retryAfterMs).toBe(0);
  });

  it('reset clears all timestamps', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000 });

    limiter.record();
    limiter.record();
    expect(limiter.canProceed()).toBe(false);

    limiter.reset();
    expect(limiter.canProceed()).toBe(true);
    expect(limiter.remaining).toBe(2);
  });

  it('waitAndRecord waits when at limit', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });

    limiter.record();
    const start = Date.now();
    const waited = await limiter.waitAndRecord();

    expect(waited).toBeGreaterThan(0);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('waitAndRecord proceeds immediately when under limit', async () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

    const waited = await limiter.waitAndRecord();
    expect(waited).toBe(0);
    expect(limiter.remaining).toBe(9);
  });

  it('uses default options when none provided', () => {
    const limiter = new RateLimiter();
    expect(limiter.remaining).toBe(60);
  });
});
