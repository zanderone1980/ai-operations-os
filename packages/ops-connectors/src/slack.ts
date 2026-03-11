import { BaseConnector, ConnectorConfig, ConnectorResult } from './base';

const SLACK_API = 'https://slack.com/api';

/**
 * Slack connector — sends messages, lists channels, reads history,
 * reacts to messages, and searches using the Slack Web API.
 *
 * Required credentials:
 *   - `botToken`: A valid Slack bot token (xoxb-...)
 */
export class SlackConnector extends BaseConnector {
  private botToken: string;

  constructor(config?: Partial<ConnectorConfig>) {
    super({
      enabled: !!config?.credentials?.botToken,
      ...config,
      name: config?.name ?? 'slack',
    });
    this.botToken = config?.credentials?.botToken || '';
  }

  get supportedOperations(): string[] {
    return ['send', 'list', 'read', 'react', 'search'];
  }

  async execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    if (!this.botToken) {
      return { success: false, error: 'No Slack bot token configured. Set credentials.botToken.' };
    }
    if (!this.supportsOperation(operation)) {
      return { success: false, error: `Unsupported operation: ${operation}` };
    }

    try {
      switch (operation) {
        case 'send': return await this.sendMessage(input);
        case 'list': return await this.listChannels(input);
        case 'read': return await this.readHistory(input);
        case 'react': return await this.addReaction(input);
        case 'search': return await this.searchMessages(input);
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
    if (!this.botToken) return false;
    try {
      const res = await this.slackFetch('auth.test');
      if (!res.ok) return false;
      const data = await res.json() as any;
      return data.ok === true;
    } catch {
      return false;
    }
  }

  // ── Operations ────────────────────────────────────────────────────────

  /** Send a message to a channel */
  private async sendMessage(input: Record<string, unknown>): Promise<ConnectorResult> {
    const channel = input.channel as string;
    const text = input.text as string;
    if (!channel || !text) {
      return { success: false, error: 'channel and text are required' };
    }

    const body: Record<string, unknown> = { channel, text };
    if (input.blocks) body.blocks = input.blocks;
    if (input.thread_ts) body.thread_ts = input.thread_ts;

    const res = await this.slackFetch('chat.postMessage', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    if (!data.ok) return { success: false, error: data.error || 'Slack API error' };

    return {
      success: true,
      data: { ts: data.ts, channel: data.channel },
    };
  }

  /** List channels the bot has access to */
  private async listChannels(input: Record<string, unknown>): Promise<ConnectorResult> {
    const limit = (input.limit as number) || 100;
    const types = (input.types as string) || 'public_channel,private_channel';

    const params = new URLSearchParams({
      limit: String(limit),
      types,
    });

    const res = await this.slackFetch(`conversations.list?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    if (!data.ok) return { success: false, error: data.error || 'Slack API error' };

    const channels = (data.channels || []).map((ch: any) => ({
      id: ch.id,
      name: ch.name,
      topic: ch.topic?.value,
      purpose: ch.purpose?.value,
      memberCount: ch.num_members,
      isPrivate: ch.is_private,
    }));

    return {
      success: true,
      data: { channels, count: channels.length },
    };
  }

  /** Read message history from a channel */
  private async readHistory(input: Record<string, unknown>): Promise<ConnectorResult> {
    const channel = input.channel as string;
    if (!channel) return { success: false, error: 'channel is required' };

    const limit = (input.limit as number) || 20;
    const params = new URLSearchParams({
      channel,
      limit: String(limit),
    });
    if (input.oldest) params.set('oldest', String(input.oldest));
    if (input.latest) params.set('latest', String(input.latest));

    const res = await this.slackFetch(`conversations.history?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    if (!data.ok) return { success: false, error: data.error || 'Slack API error' };

    const messages = (data.messages || []).map((m: any) => ({
      ts: m.ts,
      user: m.user,
      text: m.text,
      type: m.type,
      threadTs: m.thread_ts,
      replyCount: m.reply_count,
    }));

    return {
      success: true,
      data: { messages, count: messages.length, hasMore: data.has_more },
    };
  }

  /** Add an emoji reaction to a message */
  private async addReaction(input: Record<string, unknown>): Promise<ConnectorResult> {
    const channel = input.channel as string;
    const timestamp = input.timestamp as string;
    const name = input.name as string; // emoji name without colons
    if (!channel || !timestamp || !name) {
      return { success: false, error: 'channel, timestamp, and name (emoji) are required' };
    }

    const res = await this.slackFetch('reactions.add', {
      method: 'POST',
      body: JSON.stringify({ channel, timestamp, name }),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    if (!data.ok) return { success: false, error: data.error || 'Slack API error' };

    return { success: true, data: { ok: true } };
  }

  /** Search messages */
  private async searchMessages(input: Record<string, unknown>): Promise<ConnectorResult> {
    const query = input.query as string;
    if (!query) return { success: false, error: 'query is required' };

    const count = (input.count as number) || 20;
    const params = new URLSearchParams({
      query,
      count: String(count),
    });

    const res = await this.slackFetch(`search.messages?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    if (!data.ok) return { success: false, error: data.error || 'Slack API error' };

    const matches = (data.messages?.matches || []).map((m: any) => ({
      text: m.text,
      user: m.user,
      ts: m.ts,
      channel: m.channel?.name,
      permalink: m.permalink,
    }));

    return {
      success: true,
      data: { matches, total: data.messages?.total || 0 },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async slackFetch(method: string, options?: RequestInit): Promise<Response> {
    const url = method.includes('?')
      ? `${SLACK_API}/${method}`
      : `${SLACK_API}/${method}`;
    return fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
        ...((options?.headers as Record<string, string>) || {}),
      },
    });
  }

  private async apiError(res: Response): Promise<ConnectorResult> {
    let msg = `Slack API error: ${res.status}`;
    try {
      const data = await res.json() as any;
      msg = data.error || msg;
    } catch { /* ignore */ }
    return { success: false, error: msg };
  }
}
