import { GmailConnector } from '../gmail';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience wrapper to build a connector with a valid access token. */
function makeConnector(token = 'test-access-token') {
  return new GmailConnector({
    credentials: { accessToken: token },
  });
}

/** Create a minimal Response-like object that `fetch` would return. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

/** Base64url-encode a UTF-8 string (mirrors what Gmail returns). */
function b64url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GmailConnector', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Constructor ───────────────────────────────────────────────────────

  it('should default name to "gmail"', () => {
    const c = new GmailConnector();
    expect(c.name).toBe('gmail');
  });

  it('should accept a custom name via config', () => {
    const c = new GmailConnector({ name: 'my-gmail' });
    expect(c.name).toBe('my-gmail');
  });

  it('should be disabled when no accessToken is provided', () => {
    const c = new GmailConnector();
    expect(c.isEnabled()).toBe(false);
  });

  it('should be enabled when an accessToken is provided', () => {
    const c = makeConnector();
    expect(c.isEnabled()).toBe(true);
  });

  // ── supportedOperations ───────────────────────────────────────────────

  it('should expose correct supported operations', () => {
    const c = makeConnector();
    expect(c.supportedOperations).toEqual(
      expect.arrayContaining(['read', 'send', 'reply', 'label', 'list', 'search']),
    );
    expect(c.supportedOperations).toHaveLength(6);
  });

  // ── execute without token ─────────────────────────────────────────────

  it('should return error when executed without token', async () => {
    const c = new GmailConnector();
    const result = await c.execute('list', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('No Gmail access token');
  });

  // ── execute with unsupported op ───────────────────────────────────────

  it('should return error for unsupported operation', async () => {
    const c = makeConnector();
    const result = await c.execute('delete', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported operation');
  });

  // ── list ──────────────────────────────────────────────────────────────

  it('should list messages and fetch metadata for each', async () => {
    const listBody = {
      messages: [{ id: 'msg1' }, { id: 'msg2' }],
      nextPageToken: 'tok123',
    };
    const detailBody = (id: string) => ({
      id,
      threadId: `thread-${id}`,
      snippet: 'Hello...',
      payload: {
        headers: [
          { name: 'From', value: 'alice@example.com' },
          { name: 'Subject', value: 'Hello' },
          { name: 'Date', value: 'Mon, 1 Jan 2024 00:00:00 +0000' },
        ],
      },
      labelIds: ['INBOX'],
    });

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(listBody))
      .mockResolvedValueOnce(jsonResponse(detailBody('msg1')))
      .mockResolvedValueOnce(jsonResponse(detailBody('msg2')));

    const c = makeConnector();
    const result = await c.execute('list', { maxResults: 5 });

    expect(result.success).toBe(true);
    expect((result.data?.messages as unknown[]).length).toBe(2);
    expect(result.data?.nextPageToken).toBe('tok123');

    // First call should be the list endpoint
    const firstUrl = fetchSpy.mock.calls[0][0] as string;
    expect(firstUrl).toContain('/messages?');
    expect(firstUrl).toContain('maxResults=5');
  });

  it('should handle empty message list', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ messages: [] }));

    const c = makeConnector();
    const result = await c.execute('list', {});

    expect(result.success).toBe(true);
    expect(result.data?.resultCount).toBe(0);
  });

  // ── read ──────────────────────────────────────────────────────────────

  it('should read a full message and extract text/plain body', async () => {
    const body = {
      id: 'msg1',
      threadId: 'thread1',
      snippet: 'Hey there',
      labelIds: ['INBOX'],
      payload: {
        headers: [
          { name: 'From', value: 'bob@example.com' },
          { name: 'To', value: 'me@example.com' },
          { name: 'Subject', value: 'Test' },
          { name: 'Date', value: 'Tue, 2 Jan 2024 12:00:00 +0000' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('Hello World') } },
          { mimeType: 'text/html', body: { data: b64url('<p>Hello World</p>') } },
        ],
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));

    const c = makeConnector();
    const result = await c.execute('read', { messageId: 'msg1' });

    expect(result.success).toBe(true);
    expect(result.data?.body).toBe('Hello World');
    expect(result.data?.from).toBe('bob@example.com');
    expect(result.data?.subject).toBe('Test');
  });

  it('should fall back to text/html when text/plain is missing', async () => {
    const body = {
      id: 'msg2',
      threadId: 'thread2',
      snippet: 'HTML only',
      payload: {
        headers: [],
        parts: [
          { mimeType: 'text/html', body: { data: b64url('<b>Bold</b>') } },
        ],
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));

    const c = makeConnector();
    const result = await c.execute('read', { messageId: 'msg2' });

    expect(result.success).toBe(true);
    expect(result.data?.body).toBe('<b>Bold</b>');
  });

  it('should extract direct body (non-multipart)', async () => {
    const body = {
      id: 'msg3',
      threadId: 'thread3',
      snippet: 'Direct',
      payload: {
        headers: [],
        body: { data: b64url('Direct body') },
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));

    const c = makeConnector();
    const result = await c.execute('read', { messageId: 'msg3' });

    expect(result.success).toBe(true);
    expect(result.data?.body).toBe('Direct body');
  });

  it('should require messageId for read', async () => {
    const c = makeConnector();
    const result = await c.execute('read', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('messageId is required');
  });

  // ── send ──────────────────────────────────────────────────────────────

  it('should send a message with raw encoding', async () => {
    const sendResponse = { id: 'sent1', threadId: 'thread-sent1', labelIds: ['SENT'] };
    fetchSpy.mockResolvedValueOnce(jsonResponse(sendResponse));

    const c = makeConnector();
    const result = await c.execute('send', {
      to: 'recipient@example.com',
      subject: 'Greetings',
      body: 'Hi there!',
    });

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('sent1');

    // Verify the fetch call
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/messages/send');
    expect(opts.method).toBe('POST');
    const parsed = JSON.parse(opts.body);
    expect(parsed.raw).toBeDefined();

    // Decode and verify raw message content
    const raw = Buffer.from(parsed.raw, 'base64url').toString('utf-8');
    expect(raw).toContain('To: recipient@example.com');
    expect(raw).toContain('Subject: Greetings');
    expect(raw).toContain('Hi there!');
  });

  it('should include cc and bcc headers when provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: 's2', threadId: 't2' }));

    const c = makeConnector();
    await c.execute('send', {
      to: 'a@b.com',
      subject: 'CC test',
      body: 'body',
      cc: 'cc@b.com',
      bcc: 'bcc@b.com',
    });

    const parsed = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const raw = Buffer.from(parsed.raw, 'base64url').toString('utf-8');
    expect(raw).toContain('Cc: cc@b.com');
    expect(raw).toContain('Bcc: bcc@b.com');
  });

  it('should require to, subject, and body for send', async () => {
    const c = makeConnector();

    const r1 = await c.execute('send', { subject: 's', body: 'b' });
    expect(r1.success).toBe(false);

    const r2 = await c.execute('send', { to: 't', body: 'b' });
    expect(r2.success).toBe(false);

    const r3 = await c.execute('send', { to: 't', subject: 's' });
    expect(r3.success).toBe(false);
  });

  // ── reply ─────────────────────────────────────────────────────────────

  it('should reply to a thread by fetching original headers', async () => {
    const threadResponse = {
      messages: [
        {
          payload: {
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'Subject', value: 'Original Subject' },
              { name: 'Message-ID', value: '<abc123@mail.gmail.com>' },
            ],
          },
        },
      ],
    };
    const sendResponse = { id: 'reply1', threadId: 'thread-reply1' };

    fetchSpy
      .mockResolvedValueOnce(jsonResponse(threadResponse))
      .mockResolvedValueOnce(jsonResponse(sendResponse));

    const c = makeConnector();
    const result = await c.execute('reply', {
      threadId: 'thread-reply1',
      body: 'Thanks for your email',
    });

    expect(result.success).toBe(true);
    expect(result.data?.threadId).toBe('thread-reply1');

    // Verify reply headers
    const sendCall = fetchSpy.mock.calls[1];
    const parsed = JSON.parse(sendCall[1].body);
    const raw = Buffer.from(parsed.raw, 'base64url').toString('utf-8');
    expect(raw).toContain('To: sender@example.com');
    expect(raw).toContain('Re: Original Subject');
    expect(raw).toContain('In-Reply-To: <abc123@mail.gmail.com>');
    expect(raw).toContain('References: <abc123@mail.gmail.com>');
  });

  it('should not double-prefix Re: on subject', async () => {
    const threadResponse = {
      messages: [
        {
          payload: {
            headers: [
              { name: 'From', value: 'x@x.com' },
              { name: 'Subject', value: 'Re: Already replied' },
              { name: 'Message-ID', value: '<id@m>' },
            ],
          },
        },
      ],
    };
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(threadResponse))
      .mockResolvedValueOnce(jsonResponse({ id: 'r2', threadId: 't2' }));

    const c = makeConnector();
    await c.execute('reply', { threadId: 't2', body: 'Again' });

    const parsed = JSON.parse(fetchSpy.mock.calls[1][1].body);
    const raw = Buffer.from(parsed.raw, 'base64url').toString('utf-8');
    expect(raw).toContain('Subject: Re: Already replied');
    expect(raw).not.toContain('Re: Re:');
  });

  it('should require threadId and body for reply', async () => {
    const c = makeConnector();
    const r1 = await c.execute('reply', { body: 'hello' });
    expect(r1.success).toBe(false);
    const r2 = await c.execute('reply', { threadId: 't1' });
    expect(r2.success).toBe(false);
  });

  // ── healthCheck ───────────────────────────────────────────────────────

  it('should return true when /profile responds ok', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ emailAddress: 'me@g.com' }));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(true);
  });

  it('should return false when /profile responds with error', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, 401));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('should return false when fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('should return false when no token is set', async () => {
    const c = new GmailConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  // ── API error handling ────────────────────────────────────────────────

  it('should handle non-200 API response with error message', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Invalid credentials' } }, 401),
    );
    const c = makeConnector();
    const result = await c.execute('list', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid credentials');
  });

  it('should handle non-200 API response without parseable error', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
      headers: new Headers(),
    } as unknown as Response);
    const c = makeConnector();
    const result = await c.execute('list', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  it('should catch and return thrown errors from fetch', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));
    const c = makeConnector();
    const result = await c.execute('list', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
  });
});
