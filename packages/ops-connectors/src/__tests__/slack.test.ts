import { SlackConnector } from '../slack';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeConnector(token = 'xoxb-test-token') {
  return new SlackConnector({
    credentials: { botToken: token },
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

// ── Tests ────────────────────────────────────────────────────────────────

describe('SlackConnector', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Constructor ──────────────────────────────────────────────────────

  it('defaults name to "slack"', () => {
    const c = new SlackConnector();
    expect(c.name).toBe('slack');
  });

  it('accepts a custom name', () => {
    const c = new SlackConnector({ name: 'my-slack' });
    expect(c.name).toBe('my-slack');
  });

  it('is disabled without botToken', () => {
    const c = new SlackConnector();
    expect(c.isEnabled()).toBe(false);
  });

  it('is enabled with botToken', () => {
    const c = makeConnector();
    expect(c.isEnabled()).toBe(true);
  });

  it('lists supported operations', () => {
    const c = makeConnector();
    expect(c.supportedOperations).toEqual(['send', 'list', 'read', 'react', 'search']);
  });

  // ── Missing credentials ──────────────────────────────────────────────

  it('returns error when executing without token', async () => {
    const c = new SlackConnector();
    const result = await c.execute('send', { channel: '#test', text: 'hello' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No Slack bot token');
  });

  // ── Unsupported operation ────────────────────────────────────────────

  it('returns error for unsupported operation', async () => {
    const c = makeConnector();
    const result = await c.execute('delete', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported operation');
  });

  // ── send ─────────────────────────────────────────────────────────────

  it('sends a message to a channel', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      ok: true,
      ts: '1234567890.123456',
      channel: 'C123',
    }));

    const c = makeConnector();
    const result = await c.execute('send', { channel: '#general', text: 'Hello team!' });
    expect(result.success).toBe(true);
    expect(result.data?.ts).toBe('1234567890.123456');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('chat.postMessage'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requires channel and text for send', async () => {
    const c = makeConnector();
    const result = await c.execute('send', { text: 'no channel' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('channel and text are required');
  });

  // ── list ─────────────────────────────────────────────────────────────

  it('lists channels', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      ok: true,
      channels: [
        { id: 'C1', name: 'general', num_members: 50, is_private: false, topic: { value: 'General chat' }, purpose: { value: '' } },
        { id: 'C2', name: 'dev', num_members: 10, is_private: false, topic: { value: '' }, purpose: { value: '' } },
      ],
    }));

    const c = makeConnector();
    const result = await c.execute('list', {});
    expect(result.success).toBe(true);
    expect((result.data?.channels as any[]).length).toBe(2);
  });

  // ── read ─────────────────────────────────────────────────────────────

  it('reads channel history', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      ok: true,
      messages: [
        { ts: '123', user: 'U1', text: 'Hello', type: 'message' },
      ],
      has_more: false,
    }));

    const c = makeConnector();
    const result = await c.execute('read', { channel: 'C123' });
    expect(result.success).toBe(true);
    expect((result.data?.messages as any[]).length).toBe(1);
  });

  it('requires channel for read', async () => {
    const c = makeConnector();
    const result = await c.execute('read', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('channel is required');
  });

  // ── react ────────────────────────────────────────────────────────────

  it('adds a reaction', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const c = makeConnector();
    const result = await c.execute('react', {
      channel: 'C123',
      timestamp: '123.456',
      name: 'thumbsup',
    });
    expect(result.success).toBe(true);
  });

  it('requires channel, timestamp, and name for react', async () => {
    const c = makeConnector();
    const result = await c.execute('react', { channel: 'C123' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('channel, timestamp, and name');
  });

  // ── search ───────────────────────────────────────────────────────────

  it('searches messages', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      ok: true,
      messages: {
        total: 1,
        matches: [{ text: 'found', user: 'U1', ts: '123', channel: { name: 'general' }, permalink: 'https://...' }],
      },
    }));

    const c = makeConnector();
    const result = await c.execute('search', { query: 'found' });
    expect(result.success).toBe(true);
    expect((result.data?.matches as any[]).length).toBe(1);
  });

  it('requires query for search', async () => {
    const c = makeConnector();
    const result = await c.execute('search', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('query is required');
  });

  // ── healthCheck ──────────────────────────────────────────────────────

  it('returns true when API responds ok', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(true);
  });

  it('returns false without token', async () => {
    const c = new SlackConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('returns false when API returns error', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false }, 401));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });
});
