import { NotionConnector } from '../notion';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeConnector(apiKey = 'secret_test_key') {
  return new NotionConnector({
    credentials: { apiKey },
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

describe('NotionConnector', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Constructor ──────────────────────────────────────────────────────

  it('defaults name to "notion"', () => {
    const c = new NotionConnector();
    expect(c.name).toBe('notion');
  });

  it('accepts a custom name', () => {
    const c = new NotionConnector({ name: 'my-notion' });
    expect(c.name).toBe('my-notion');
  });

  it('is disabled without apiKey', () => {
    const c = new NotionConnector();
    expect(c.isEnabled()).toBe(false);
  });

  it('is enabled with apiKey', () => {
    const c = makeConnector();
    expect(c.isEnabled()).toBe(true);
  });

  it('lists supported operations', () => {
    const c = makeConnector();
    expect(c.supportedOperations).toEqual(['search', 'read', 'create', 'update', 'list']);
  });

  // ── Missing credentials ──────────────────────────────────────────────

  it('returns error when executing without key', async () => {
    const c = new NotionConnector();
    const result = await c.execute('search', { query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No Notion API key');
  });

  // ── Unsupported operation ────────────────────────────────────────────

  it('returns error for unsupported operation', async () => {
    const c = makeConnector();
    const result = await c.execute('delete', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported operation');
  });

  // ── search ───────────────────────────────────────────────────────────

  it('searches pages and databases', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      results: [
        {
          id: 'page-1',
          object: 'page',
          url: 'https://notion.so/page-1',
          created_time: '2026-01-01T00:00:00Z',
          last_edited_time: '2026-01-02T00:00:00Z',
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'Test Page' }] },
          },
        },
      ],
      has_more: false,
    }));

    const c = makeConnector();
    const result = await c.execute('search', { query: 'test' });
    expect(result.success).toBe(true);
    expect((result.data?.results as any[])[0].title).toBe('Test Page');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/v1/search'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // ── read ─────────────────────────────────────────────────────────────

  it('reads a specific page', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      id: 'page-1',
      url: 'https://notion.so/page-1',
      properties: { Name: { type: 'title', title: [{ plain_text: 'My Page' }] } },
      created_time: '2026-01-01T00:00:00Z',
      last_edited_time: '2026-01-02T00:00:00Z',
      archived: false,
    }));

    const c = makeConnector();
    const result = await c.execute('read', { pageId: 'page-1' });
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('My Page');
  });

  it('requires pageId for read', async () => {
    const c = makeConnector();
    const result = await c.execute('read', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('pageId is required');
  });

  // ── create ───────────────────────────────────────────────────────────

  it('creates a page in a database', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      id: 'new-page-1',
      url: 'https://notion.so/new-page-1',
      created_time: '2026-01-01T00:00:00Z',
    }));

    const c = makeConnector();
    const result = await c.execute('create', {
      parent: { database_id: 'db-1' },
      properties: {
        Name: { title: [{ text: { content: 'New Page' } }] },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('new-page-1');
  });

  it('requires parent and properties for create', async () => {
    const c = makeConnector();
    const result = await c.execute('create', { parent: { database_id: 'db-1' } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('parent and properties are required');
  });

  // ── update ───────────────────────────────────────────────────────────

  it('updates page properties', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      id: 'page-1',
      url: 'https://notion.so/page-1',
      last_edited_time: '2026-01-03T00:00:00Z',
    }));

    const c = makeConnector();
    const result = await c.execute('update', {
      pageId: 'page-1',
      properties: { Status: { select: { name: 'Done' } } },
    });
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('page-1');
  });

  it('requires pageId for update', async () => {
    const c = makeConnector();
    const result = await c.execute('update', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('pageId is required');
  });

  // ── list (query database) ────────────────────────────────────────────

  it('queries a database', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({
      results: [
        {
          id: 'row-1',
          url: 'https://notion.so/row-1',
          properties: { Name: { type: 'title', title: [{ plain_text: 'Row 1' }] } },
          created_time: '2026-01-01T00:00:00Z',
          last_edited_time: '2026-01-01T00:00:00Z',
        },
      ],
      has_more: false,
    }));

    const c = makeConnector();
    const result = await c.execute('list', { databaseId: 'db-1' });
    expect(result.success).toBe(true);
    expect((result.data?.results as any[]).length).toBe(1);
  });

  it('requires databaseId for list', async () => {
    const c = makeConnector();
    const result = await c.execute('list', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('databaseId is required');
  });

  // ── healthCheck ──────────────────────────────────────────────────────

  it('returns true when API responds ok', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ object: 'user' }));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(true);
  });

  it('returns false without apiKey', async () => {
    const c = new NotionConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('returns false when API returns error', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, 401));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  // ── Notion-Version header ────────────────────────────────────────────

  it('sends Notion-Version header', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }));

    const c = makeConnector();
    await c.execute('search', { query: 'test' });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Notion-Version': '2022-06-28',
        }),
      }),
    );
  });
});
