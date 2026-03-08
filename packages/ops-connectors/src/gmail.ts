import { BaseConnector, ConnectorConfig, ConnectorResult } from './base';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Gmail connector — reads, sends, replies, labels, lists, and searches email
 * using the Gmail REST API with OAuth2 access tokens.
 *
 * Required credentials:
 *   - `accessToken`: A valid OAuth2 access token with gmail.modify scope
 *   - `refreshToken` (optional): For automatic token refresh
 *   - `clientId` (optional): For token refresh flow
 *   - `clientSecret` (optional): For token refresh flow
 */
export class GmailConnector extends BaseConnector {
  private accessToken: string;

  constructor(config?: Partial<ConnectorConfig>) {
    super({
      enabled: !!config?.credentials?.accessToken,
      ...config,
      name: config?.name ?? 'gmail',
    });
    this.accessToken = config?.credentials?.accessToken || '';
  }

  get supportedOperations(): string[] {
    return ['read', 'send', 'reply', 'label', 'list', 'search'];
  }

  async execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    if (!this.accessToken) {
      return { success: false, error: 'No Gmail access token configured. Run setup first.' };
    }
    if (!this.supportsOperation(operation)) {
      return { success: false, error: `Unsupported operation: ${operation}` };
    }

    try {
      switch (operation) {
        case 'list': return await this.listMessages(input);
        case 'read': return await this.readMessage(input);
        case 'send': return await this.sendMessage(input);
        case 'reply': return await this.replyToThread(input);
        case 'label': return await this.manageLabels(input);
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
    if (!this.accessToken) return false;
    try {
      const res = await this.gmailFetch('/profile');
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Operations ────────────────────────────────────────────────────────

  /** List messages in inbox or by label */
  private async listMessages(input: Record<string, unknown>): Promise<ConnectorResult> {
    const label = (input.label as string) || 'INBOX';
    const maxResults = (input.maxResults as number) || 20;
    const q = input.query as string | undefined;

    const params = new URLSearchParams({
      labelIds: label,
      maxResults: String(maxResults),
    });
    if (q) params.set('q', q);

    const res = await this.gmailFetch(`/messages?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    const messages = data.messages || [];

    // Fetch headers for each message (batch of metadata)
    const summaries = await Promise.all(
      messages.slice(0, maxResults).map(async (m: { id: string }) => {
        const detail = await this.gmailFetch(`/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        if (!detail.ok) return { id: m.id };
        const d = await detail.json() as any;
        const headers = d.payload?.headers || [];
        return {
          id: m.id,
          threadId: d.threadId,
          snippet: d.snippet,
          from: this.getHeader(headers, 'From'),
          subject: this.getHeader(headers, 'Subject'),
          date: this.getHeader(headers, 'Date'),
          labelIds: d.labelIds,
        };
      }),
    );

    return {
      success: true,
      data: {
        messages: summaries,
        resultCount: summaries.length,
        nextPageToken: data.nextPageToken,
      },
    };
  }

  /** Read full message content */
  private async readMessage(input: Record<string, unknown>): Promise<ConnectorResult> {
    const messageId = input.messageId as string;
    if (!messageId) return { success: false, error: 'messageId is required' };

    const res = await this.gmailFetch(`/messages/${messageId}?format=full`);
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    const headers = data.payload?.headers || [];
    const body = this.extractBody(data.payload);

    return {
      success: true,
      data: {
        id: data.id,
        threadId: data.threadId,
        from: this.getHeader(headers, 'From'),
        to: this.getHeader(headers, 'To'),
        subject: this.getHeader(headers, 'Subject'),
        date: this.getHeader(headers, 'Date'),
        body,
        snippet: data.snippet,
        labelIds: data.labelIds,
      },
    };
  }

  /** Send a new email */
  private async sendMessage(input: Record<string, unknown>): Promise<ConnectorResult> {
    const to = input.to as string;
    const subject = input.subject as string;
    const body = input.body as string;
    if (!to || !subject || !body) {
      return { success: false, error: 'to, subject, and body are required' };
    }

    const cc = input.cc as string | undefined;
    const bcc = input.bcc as string | undefined;
    const raw = this.buildRawMessage({ to, subject, body, cc, bcc });

    const res = await this.gmailFetch('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    return {
      success: true,
      data: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
    };
  }

  /** Reply to an existing thread */
  private async replyToThread(input: Record<string, unknown>): Promise<ConnectorResult> {
    const threadId = input.threadId as string;
    const body = input.body as string;
    if (!threadId || !body) {
      return { success: false, error: 'threadId and body are required' };
    }

    // Get original message to extract headers for reply
    const threadRes = await this.gmailFetch(`/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`);
    if (!threadRes.ok) return this.apiError(threadRes);

    const threadData = await threadRes.json() as any;
    const lastMsg = threadData.messages?.[threadData.messages.length - 1];
    if (!lastMsg) return { success: false, error: 'Thread has no messages' };

    const headers = lastMsg.payload?.headers || [];
    const originalFrom = this.getHeader(headers, 'From');
    const originalSubject = this.getHeader(headers, 'Subject');
    const messageId = this.getHeader(headers, 'Message-ID');

    const subject = originalSubject?.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`;
    const raw = this.buildRawMessage({
      to: originalFrom || '',
      subject,
      body,
      inReplyTo: messageId,
      references: messageId,
    });

    const res = await this.gmailFetch('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw, threadId }),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    return {
      success: true,
      data: { id: data.id, threadId: data.threadId },
    };
  }

  /** Add or remove labels */
  private async manageLabels(input: Record<string, unknown>): Promise<ConnectorResult> {
    const messageId = input.messageId as string;
    if (!messageId) return { success: false, error: 'messageId is required' };

    const addLabels = (input.addLabels as string[]) || [];
    const removeLabels = (input.removeLabels as string[]) || [];

    const res = await this.gmailFetch(`/messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({
        addLabelIds: addLabels,
        removeLabelIds: removeLabels,
      }),
    });
    if (!res.ok) return this.apiError(res);

    const data = await res.json() as any;
    return {
      success: true,
      data: { id: data.id, labelIds: data.labelIds },
    };
  }

  /** Search messages using Gmail query syntax */
  private async searchMessages(input: Record<string, unknown>): Promise<ConnectorResult> {
    const query = input.query as string;
    if (!query) return { success: false, error: 'query is required' };

    return this.listMessages({ ...input, query, label: undefined });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async gmailJson(path: string, options?: RequestInit): Promise<any> {
    const res = await this.gmailFetch(path, options);
    if (!res.ok) return null;
    return res.json();
  }

  private async gmailFetch(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${GMAIL_API}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...((options?.headers as Record<string, string>) || {}),
      },
    });
  }

  private async apiError(res: Response): Promise<ConnectorResult> {
    let msg = `Gmail API error: ${res.status}`;
    try {
      const data = await res.json() as any;
      msg = data.error?.message || msg;
    } catch { /* ignore */ }
    return { success: false, error: msg };
  }

  private getHeader(headers: Array<{ name: string; value: string }>, name: string): string | undefined {
    return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
  }

  private extractBody(payload: any): string {
    if (!payload) return '';

    // Direct body
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }

    // Multipart — find text/plain or text/html
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8');
        }
      }
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8');
        }
      }
      // Nested multipart
      for (const part of payload.parts) {
        if (part.parts) {
          const nested = this.extractBody(part);
          if (nested) return nested;
        }
      }
    }
    return '';
  }

  private buildRawMessage(opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    references?: string;
  }): string {
    const lines: string[] = [
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      'Content-Type: text/plain; charset=UTF-8',
      'MIME-Version: 1.0',
    ];
    if (opts.cc) lines.push(`Cc: ${opts.cc}`);
    if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
    if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
    if (opts.references) lines.push(`References: ${opts.references}`);
    lines.push('', opts.body);

    const raw = lines.join('\r\n');
    return Buffer.from(raw, 'utf-8').toString('base64url');
  }
}
