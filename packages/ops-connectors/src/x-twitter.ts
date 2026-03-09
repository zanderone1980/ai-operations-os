import { BaseConnector, ConnectorConfig, ConnectorResult } from './base';

const X_API = 'https://api.x.com/2';

/**
 * X (Twitter) connector — posts tweets, replies, likes, reposts,
 * sends/reads DMs, and fetches timelines using the X API v2
 * with OAuth2 Bearer tokens.
 *
 * Required credentials:
 *   - `bearerToken`: OAuth2 Bearer token for app-only authentication
 *   - `userId`: The authenticated user's X/Twitter user ID (required for
 *     like, repost, and timeline operations)
 *
 * Note: Some operations (post, reply, like, repost, dm_send) require
 * user-context authentication. When using a Bearer token obtained via
 * OAuth 2.0 with PKCE (user access token), all endpoints work. An
 * app-only Bearer token is restricted to read-only endpoints (timeline,
 * dm_read with elevated access).
 */
export class XTwitterConnector extends BaseConnector {
  private bearerToken: string;
  private userId: string;

  constructor(config?: Partial<ConnectorConfig>) {
    super({
      enabled: !!config?.credentials?.bearerToken,
      ...config,
      name: config?.name ?? 'x-twitter',
    });
    this.bearerToken = config?.credentials?.bearerToken || '';
    this.userId = config?.credentials?.userId || '';
  }

  /**
   * Supported X (Twitter) operations:
   * - `post`     : Publish a new post (tweet)
   * - `reply`    : Reply to an existing post
   * - `like`     : Like a post by ID
   * - `repost`   : Repost (retweet) a post by ID
   * - `dm_send`  : Send a direct message to a user
   * - `dm_read`  : Read direct message events
   * - `timeline` : Fetch the authenticated user's tweets
   */
  get supportedOperations(): string[] {
    return ['post', 'reply', 'like', 'repost', 'dm_send', 'dm_read', 'timeline'];
  }

  /**
   * Execute an X (Twitter) operation.
   *
   * @param operation - One of the supported operation identifiers
   * @param input - Operation-specific parameters:
   *   - `post`     : `{ text: string }`
   *   - `reply`    : `{ text: string, tweetId: string }`
   *   - `like`     : `{ tweetId: string, userId?: string }`
   *   - `repost`   : `{ tweetId: string, userId?: string }`
   *   - `dm_send`  : `{ participantId: string, text: string }`
   *   - `dm_read`  : `{ maxResults?: number }`
   *   - `timeline` : `{ userId?: string, maxResults?: number }`
   * @returns A `ConnectorResult` indicating the outcome
   */
  async execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    if (!this.bearerToken) {
      return { success: false, error: 'No X/Twitter bearer token configured. Run setup first.' };
    }
    if (!this.supportsOperation(operation)) {
      return { success: false, error: `Unsupported operation: ${operation}` };
    }

    try {
      switch (operation) {
        case 'post': return await this.postTweet(input);
        case 'reply': return await this.replyToTweet(input);
        case 'like': return await this.likeTweet(input);
        case 'repost': return await this.repostTweet(input);
        case 'dm_send': return await this.sendDm(input);
        case 'dm_read': return await this.readDms(input);
        case 'timeline': return await this.getTimeline(input);
        default: return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Verify connectivity to the X API.
   *
   * Uses the /users/me endpoint to confirm the bearer token is valid
   * and has user-context access. Falls back to checking app-only
   * auth by verifying the token format.
   *
   * @returns `true` if the X API is reachable and credentials are valid
   */
  async healthCheck(): Promise<boolean> {
    if (!this.bearerToken) return false;
    try {
      // Try the /users/me endpoint (works with user-context tokens)
      const res = await this.xFetch('/users/me');
      if (res.ok) return true;

      // If /users/me fails (e.g. app-only token), try a simple search-like
      // endpoint to verify the token is at least valid
      const fallback = await this.xFetch('/tweets/search/recent?query=test&max_results=10');
      return fallback.ok;
    } catch {
      return false;
    }
  }

  // ── Operations ────────────────────────────────────────────────────────

  /** Post a new tweet */
  private async postTweet(input: Record<string, unknown>): Promise<ConnectorResult> {
    const text = input.text as string;
    if (!text) {
      return { success: false, error: 'text is required' };
    }

    const res = await this.xFetch('/tweets', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    return {
      success: true,
      data: {
        id: data.data?.id,
        text: data.data?.text,
      },
    };
  }

  /** Reply to an existing tweet */
  private async replyToTweet(input: Record<string, unknown>): Promise<ConnectorResult> {
    const text = input.text as string;
    const tweetId = input.tweetId as string;
    if (!text || !tweetId) {
      return { success: false, error: 'text and tweetId are required' };
    }

    const res = await this.xFetch('/tweets', {
      method: 'POST',
      body: JSON.stringify({
        text,
        reply: { in_reply_to_tweet_id: tweetId },
      }),
    });
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    return {
      success: true,
      data: {
        id: data.data?.id,
        text: data.data?.text,
        inReplyToTweetId: tweetId,
      },
    };
  }

  /** Like a tweet */
  private async likeTweet(input: Record<string, unknown>): Promise<ConnectorResult> {
    const tweetId = input.tweetId as string;
    if (!tweetId) {
      return { success: false, error: 'tweetId is required' };
    }

    const uid = (input.userId as string) || this.userId;
    if (!uid) {
      return { success: false, error: 'userId is required (set in credentials or pass as input)' };
    }

    const res = await this.xFetch(`/users/${encodeURIComponent(uid)}/likes`, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: tweetId }),
    });
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    return {
      success: true,
      data: {
        liked: data.data?.liked ?? true,
        tweetId,
      },
    };
  }

  /** Repost (retweet) a tweet */
  private async repostTweet(input: Record<string, unknown>): Promise<ConnectorResult> {
    const tweetId = input.tweetId as string;
    if (!tweetId) {
      return { success: false, error: 'tweetId is required' };
    }

    const uid = (input.userId as string) || this.userId;
    if (!uid) {
      return { success: false, error: 'userId is required (set in credentials or pass as input)' };
    }

    const res = await this.xFetch(`/users/${encodeURIComponent(uid)}/retweets`, {
      method: 'POST',
      body: JSON.stringify({ tweet_id: tweetId }),
    });
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    return {
      success: true,
      data: {
        retweeted: data.data?.retweeted ?? true,
        tweetId,
      },
    };
  }

  /**
   * Send a direct message.
   *
   * Note: The DM API requires elevated access on X API v2.
   */
  private async sendDm(input: Record<string, unknown>): Promise<ConnectorResult> {
    const participantId = input.participantId as string;
    const text = input.text as string;
    if (!participantId || !text) {
      return { success: false, error: 'participantId and text are required' };
    }

    const res = await this.xFetch(
      `/dm_conversations/with/${encodeURIComponent(participantId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ text }),
      },
    );
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    return {
      success: true,
      data: {
        dmConversationId: data.data?.dm_conversation_id,
        dmEventId: data.data?.dm_event_id,
      },
    };
  }

  /**
   * Read direct message events.
   *
   * Note: The DM API requires elevated access on X API v2.
   */
  private async readDms(input: Record<string, unknown>): Promise<ConnectorResult> {
    const maxResults = (input.maxResults as number) || 20;

    const params = new URLSearchParams({
      event_types: 'MessageCreate',
      'dm_event.fields': 'id,text,sender_id,created_at,dm_conversation_id',
      max_results: String(Math.min(maxResults, 100)),
    });

    const res = await this.xFetch(`/dm_events?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    const events = (data.data || []).map((ev: any) => ({
      id: ev.id,
      text: ev.text,
      senderId: ev.sender_id,
      createdAt: ev.created_at,
      dmConversationId: ev.dm_conversation_id,
    }));

    return {
      success: true,
      data: {
        events,
        resultCount: events.length,
        nextToken: data.meta?.next_token,
      },
    };
  }

  /** Fetch tweets from a user's timeline */
  private async getTimeline(input: Record<string, unknown>): Promise<ConnectorResult> {
    const uid = (input.userId as string) || this.userId;
    if (!uid) {
      return { success: false, error: 'userId is required (set in credentials or pass as input)' };
    }

    const maxResults = (input.maxResults as number) || 10;

    const params = new URLSearchParams({
      max_results: String(Math.min(Math.max(maxResults, 5), 100)),
      'tweet.fields': 'id,text,created_at,public_metrics,author_id',
    });

    const res = await this.xFetch(`/users/${encodeURIComponent(uid)}/tweets?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    const tweets = (data.data || []).map((tw: any) => ({
      id: tw.id,
      text: tw.text,
      createdAt: tw.created_at,
      authorId: tw.author_id,
      publicMetrics: tw.public_metrics,
    }));

    return {
      success: true,
      data: {
        tweets,
        resultCount: data.meta?.result_count ?? tweets.length,
        nextToken: data.meta?.next_token,
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async xFetch(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${X_API}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
        ...((options?.headers as Record<string, string>) || {}),
      },
    });
  }

  private async apiError(res: Response): Promise<ConnectorResult> {
    let msg = `X API error: ${res.status}`;
    try {
      const data = (await res.json()) as any;
      // X API v2 returns errors in different shapes
      if (data.detail) {
        msg = data.detail;
      } else if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
        msg = data.errors.map((e: any) => e.message || e.detail).join('; ');
      } else if (data.title) {
        msg = `${data.title}: ${data.detail || res.status}`;
      }
    } catch { /* ignore parse errors */ }
    return { success: false, error: msg };
  }
}
