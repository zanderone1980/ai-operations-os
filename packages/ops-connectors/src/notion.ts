import { BaseConnector, ConnectorConfig, ConnectorResult } from './base';

const NOTION_API = 'https://api.notion.com';
const NOTION_VERSION = '2022-06-28';

/**
 * Notion connector — searches, reads, creates, and updates pages and databases
 * using the Notion REST API.
 *
 * Required credentials:
 *   - `apiKey`: A Notion integration token (secret_...)
 */
export class NotionConnector extends BaseConnector {
  private apiKey: string;

  constructor(config?: Partial<ConnectorConfig>) {
    super({
      enabled: !!config?.credentials?.apiKey,
      ...config,
      name: config?.name ?? 'notion',
    });
    this.apiKey = config?.credentials?.apiKey || '';
  }

  get supportedOperations(): string[] {
    return ['search', 'read', 'create', 'update', 'list'];
  }

  async execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    if (!this.apiKey) {
      return { success: false, error: 'No Notion API key configured. Set credentials.apiKey.' };
    }
    if (!this.supportsOperation(operation)) {
      return { success: false, error: `Unsupported operation: ${operation}` };
    }

    try {
      switch (operation) {
        case 'search': return await this.searchPages(input);
        case 'read': return await this.readPage(input);
        case 'create': return await this.createPage(input);
        case 'update': return await this.updatePage(input);
        case 'list': return await this.queryDatabase(input);
        default: return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await this.notionFetch('/v1/users/me');
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Operations ────────────────────────────────────────────────────────

  /** Search pages and databases */
  private async searchPages(input: Record<string, unknown>): Promise<ConnectorResult> {
    const query = (input.query as string) || '';
    const filter = input.filter as Record<string, unknown> | undefined;
    const pageSize = (input.pageSize as number) || 20;

    const body: Record<string, unknown> = { page_size: pageSize };
    if (query) body.query = query;
    if (filter) body.filter = filter;

    const res = await this.notionFetch('/v1/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    const results = (data.results || []).map((r: any) => ({
      id: r.id,
      type: r.object,
      title: this.extractTitle(r),
      url: r.url,
      createdTime: r.created_time,
      lastEditedTime: r.last_edited_time,
    }));

    return {
      success: true,
      data: { results, count: results.length, hasMore: data.has_more },
    };
  }

  /** Read a specific page */
  private async readPage(input: Record<string, unknown>): Promise<ConnectorResult> {
    const pageId = input.pageId as string;
    if (!pageId) return { success: false, error: 'pageId is required' };

    const res = await this.notionFetch(`/v1/pages/${pageId}`);
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    return {
      success: true,
      data: {
        id: data.id,
        title: this.extractTitle(data),
        url: data.url,
        properties: data.properties,
        createdTime: data.created_time,
        lastEditedTime: data.last_edited_time,
        archived: data.archived,
      },
    };
  }

  /** Create a new page in a database */
  private async createPage(input: Record<string, unknown>): Promise<ConnectorResult> {
    const parent = input.parent as Record<string, unknown>;
    const properties = input.properties as Record<string, unknown>;
    if (!parent || !properties) {
      return { success: false, error: 'parent and properties are required' };
    }

    const body: Record<string, unknown> = { parent, properties };
    if (input.children) body.children = input.children;

    const res = await this.notionFetch('/v1/pages', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    return {
      success: true,
      data: {
        id: data.id,
        url: data.url,
        createdTime: data.created_time,
      },
    };
  }

  /** Update page properties */
  private async updatePage(input: Record<string, unknown>): Promise<ConnectorResult> {
    const pageId = input.pageId as string;
    const properties = input.properties as Record<string, unknown>;
    if (!pageId) return { success: false, error: 'pageId is required' };

    const body: Record<string, unknown> = {};
    if (properties) body.properties = properties;
    if (input.archived !== undefined) body.archived = input.archived;

    const res = await this.notionFetch(`/v1/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    return {
      success: true,
      data: {
        id: data.id,
        url: data.url,
        lastEditedTime: data.last_edited_time,
      },
    };
  }

  /** Query a database */
  private async queryDatabase(input: Record<string, unknown>): Promise<ConnectorResult> {
    const databaseId = input.databaseId as string;
    if (!databaseId) return { success: false, error: 'databaseId is required' };

    const pageSize = (input.pageSize as number) || 20;
    const body: Record<string, unknown> = { page_size: pageSize };
    if (input.filter) body.filter = input.filter;
    if (input.sorts) body.sorts = input.sorts;
    if (input.startCursor) body.start_cursor = input.startCursor;

    const res = await this.notionFetch(`/v1/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    const results = (data.results || []).map((r: any) => ({
      id: r.id,
      title: this.extractTitle(r),
      url: r.url,
      properties: r.properties,
      createdTime: r.created_time,
      lastEditedTime: r.last_edited_time,
    }));

    return {
      success: true,
      data: { results, count: results.length, hasMore: data.has_more },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async notionFetch(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${NOTION_API}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
        ...((options?.headers as Record<string, string>) || {}),
      },
    });
  }

  private async apiError(res: Response): Promise<ConnectorResult> {
    let msg = `Notion API error: ${res.status}`;
    try {
      const data = await res.json() as any;
      msg = data.message || data.code || msg;
    } catch { /* ignore */ }
    return { success: false, error: msg };
  }

  private extractTitle(obj: any): string {
    if (!obj?.properties) return '';
    // Find the title property
    for (const value of Object.values(obj.properties) as any[]) {
      if (value?.type === 'title' && value?.title) {
        return value.title.map((t: any) => t.plain_text || '').join('');
      }
    }
    return '';
  }
}
