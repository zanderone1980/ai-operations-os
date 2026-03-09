import { XTwitterConnector } from '../x-twitter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnector(bearerToken = 'test-bearer', userId = 'user123') {
  return new XTwitterConnector({
    credentials: { bearerToken, userId },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('XTwitterConnector', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Constructor ───────────────────────────────────────────────────────

  it('should default name to "x-twitter"', () => {
    const c = new XTwitterConnector();
    expect(c.name).toBe('x-twitter');
  });

  it('should accept custom name', () => {
    const c = new XTwitterConnector({ name: 'twitter-alt' });
    expect(c.name).toBe('twitter-alt');
  });

  it('should be disabled without bearerToken', () => {
    const c = new XTwitterConnector();
    expect(c.isEnabled()).toBe(false);
  });

  it('should be enabled with bearerToken', () => {
    const c = makeConnector();
    expect(c.isEnabled()).toBe(true);
  });

  it('should list correct supported operations', () => {
    const c = makeConnector();
    expect(c.supportedOperations).toEqual([
      'post', 'reply', 'like', 'repost', 'dm_send', 'dm_read', 'timeline',
    ]);
  });

  // ── execute without token ─────────────────────────────────────────────

  it('should return error without bearer token', async () => {
    const c = new XTwitterConnector();
    const result = await c.execute('post', { text: 'hi' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No X/Twitter bearer token');
  });

  it('should return error for unsupported operation', async () => {
    const c = makeConnector();
    const result = await c.execute('bookmark', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported operation');
  });

  // ── post ──────────────────────────────────────────────────────────────

  it('should post a tweet', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ data: { id: 'tw1', text: 'Hello world' } }),
    );

    const c = makeConnector();
    const result = await c.execute('post', { text: 'Hello world' });

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('tw1');
    expect(result.data?.text).toBe('Hello world');

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/tweets');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).text).toBe('Hello world');
  });

  it('should require text for post', async () => {
    const c = makeConnector();
    const result = await c.execute('post', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('text is required');
  });

  // ── reply ─────────────────────────────────────────────────────────────

  it('should reply to a tweet with reply context', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ data: { id: 'tw-reply', text: 'Nice!' } }),
    );

    const c = makeConnector();
    const result = await c.execute('reply', { text: 'Nice!', tweetId: 'tw-original' });

    expect(result.success).toBe(true);
    expect(result.data?.inReplyToTweetId).toBe('tw-original');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.reply.in_reply_to_tweet_id).toBe('tw-original');
  });

  it('should require both text and tweetId for reply', async () => {
    const c = makeConnector();
    const r1 = await c.execute('reply', { text: 'hi' });
    expect(r1.success).toBe(false);
    const r2 = await c.execute('reply', { tweetId: 'tw1' });
    expect(r2.success).toBe(false);
  });

  // ── like ──────────────────────────────────────────────────────────────

  it('should like a tweet using configured userId', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: { liked: true } }));

    const c = makeConnector();
    const result = await c.execute('like', { tweetId: 'tw-like' });

    expect(result.success).toBe(true);
    expect(result.data?.liked).toBe(true);
    expect(result.data?.tweetId).toBe('tw-like');

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/users/user123/likes');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).tweet_id).toBe('tw-like');
  });

  it('should accept userId override for like', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: { liked: true } }));

    const c = makeConnector();
    await c.execute('like', { tweetId: 'tw1', userId: 'other-user' });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/users/other-user/likes');
  });

  it('should require tweetId for like', async () => {
    const c = makeConnector();
    const result = await c.execute('like', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('tweetId is required');
  });

  it('should require userId for like when not in credentials', async () => {
    const c = new XTwitterConnector({ credentials: { bearerToken: 'tok' } });
    const result = await c.execute('like', { tweetId: 'tw1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('userId is required');
  });

  // ── repost ────────────────────────────────────────────────────────────

  it('should repost (retweet) a tweet', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: { retweeted: true } }));

    const c = makeConnector();
    const result = await c.execute('repost', { tweetId: 'tw-rt' });

    expect(result.success).toBe(true);
    expect(result.data?.retweeted).toBe(true);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/users/user123/retweets');
  });

  it('should require tweetId for repost', async () => {
    const c = makeConnector();
    const result = await c.execute('repost', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('tweetId is required');
  });

  it('should require userId for repost when not in credentials', async () => {
    const c = new XTwitterConnector({ credentials: { bearerToken: 'tok' } });
    const result = await c.execute('repost', { tweetId: 'tw1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('userId is required');
  });

  // ── dm_send ───────────────────────────────────────────────────────────

  it('should send a direct message', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        data: { dm_conversation_id: 'conv1', dm_event_id: 'dmev1' },
      }),
    );

    const c = makeConnector();
    const result = await c.execute('dm_send', {
      participantId: 'part123',
      text: 'Hey there!',
    });

    expect(result.success).toBe(true);
    expect(result.data?.dmConversationId).toBe('conv1');
    expect(result.data?.dmEventId).toBe('dmev1');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/dm_conversations/with/part123/messages');
  });

  it('should require participantId and text for dm_send', async () => {
    const c = makeConnector();
    const r1 = await c.execute('dm_send', { text: 'hi' });
    expect(r1.success).toBe(false);
    const r2 = await c.execute('dm_send', { participantId: 'p1' });
    expect(r2.success).toBe(false);
  });

  // ── dm_read ───────────────────────────────────────────────────────────

  it('should read DM events', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'dm1',
            text: 'Hello',
            sender_id: 'u1',
            created_at: '2024-01-01T00:00:00Z',
            dm_conversation_id: 'conv1',
          },
        ],
        meta: { next_token: 'next123' },
      }),
    );

    const c = makeConnector();
    const result = await c.execute('dm_read', {});

    expect(result.success).toBe(true);
    const events = result.data?.events as unknown[];
    expect(events).toHaveLength(1);
    expect(result.data?.nextToken).toBe('next123');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/dm_events');
  });

  // ── timeline ──────────────────────────────────────────────────────────

  it('should fetch user timeline', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'tw-tl1',
            text: 'My tweet',
            created_at: '2024-01-01T12:00:00Z',
            author_id: 'user123',
            public_metrics: { like_count: 5, retweet_count: 2 },
          },
        ],
        meta: { result_count: 1, next_token: 'tlnext' },
      }),
    );

    const c = makeConnector();
    const result = await c.execute('timeline', {});

    expect(result.success).toBe(true);
    const tweets = result.data?.tweets as any[];
    expect(tweets).toHaveLength(1);
    expect(tweets[0].publicMetrics.like_count).toBe(5);
    expect(result.data?.nextToken).toBe('tlnext');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/users/user123/tweets');
  });

  it('should require userId for timeline when not in credentials', async () => {
    const c = new XTwitterConnector({ credentials: { bearerToken: 'tok' } });
    const result = await c.execute('timeline', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('userId is required');
  });

  // ── healthCheck ───────────────────────────────────────────────────────

  it('should return true when /users/me succeeds', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: { id: 'u1' } }));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(true);
  });

  it('should fall back to search endpoint when /users/me fails', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, 403)) // /users/me
      .mockResolvedValueOnce(jsonResponse({ data: [] })); // fallback search

    const c = makeConnector();
    expect(await c.healthCheck()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should return false when both health endpoints fail', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 401));

    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('should return false when fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('timeout'));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('should return false without bearer token', async () => {
    const c = new XTwitterConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  // ── API error handling ────────────────────────────────────────────────

  it('should parse X API error with detail field', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ detail: 'Forbidden: app-only token' }, 403),
    );
    const c = makeConnector();
    const result = await c.execute('post', { text: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Forbidden');
  });

  it('should parse X API error with errors array', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        errors: [{ message: 'Too many requests' }],
      }, 429),
    );
    const c = makeConnector();
    const result = await c.execute('post', { text: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many requests');
  });

  it('should catch thrown errors during execution', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Socket hang up'));
    const c = makeConnector();
    const result = await c.execute('post', { text: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Socket hang up');
  });
});
