import { BaseConnector, ConnectorConfig, ConnectorResult } from './base';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/**
 * Google Calendar connector — lists, creates, updates, deletes events
 * and checks free/busy availability using the Google Calendar REST API
 * with OAuth2 access tokens.
 *
 * Required credentials:
 *   - `accessToken`: A valid OAuth2 access token with calendar scope
 *     (e.g. https://www.googleapis.com/auth/calendar)
 */
export class CalendarConnector extends BaseConnector {
  private accessToken: string;

  constructor(config?: Partial<ConnectorConfig>) {
    super({
      enabled: !!config?.credentials?.accessToken,
      ...config,
      name: config?.name ?? 'calendar',
    });
    this.accessToken = config?.credentials?.accessToken || '';
  }

  /**
   * Supported Calendar operations:
   * - `list_events`         : List upcoming events within a date range
   * - `create_event`        : Create a new calendar event
   * - `update_event`        : Update an existing calendar event
   * - `delete_event`        : Delete a calendar event by ID
   * - `check_availability`  : Check free/busy status for a time range
   */
  get supportedOperations(): string[] {
    return [
      'list_events',
      'create_event',
      'update_event',
      'delete_event',
      'check_availability',
    ];
  }

  /**
   * Execute a Calendar operation.
   *
   * @param operation - One of the supported operation identifiers
   * @param input - Operation-specific parameters:
   *   - `list_events`        : `{ timeMin?: string, timeMax?: string, maxResults?: number, calendarId?: string }`
   *   - `create_event`       : `{ summary: string, start: string, end: string, description?: string, location?: string, attendees?: string[] }`
   *   - `update_event`       : `{ eventId: string, summary?: string, start?: string, end?: string, description?: string, location?: string, attendees?: string[] }`
   *   - `delete_event`       : `{ eventId: string, calendarId?: string }`
   *   - `check_availability` : `{ timeMin: string, timeMax: string, items?: Array<{ id: string }> }`
   * @returns A `ConnectorResult` indicating the outcome
   */
  async execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    if (!this.accessToken) {
      return { success: false, error: 'No Google Calendar access token configured. Run setup first.' };
    }
    if (!this.supportsOperation(operation)) {
      return { success: false, error: `Unsupported operation: ${operation}` };
    }

    try {
      switch (operation) {
        case 'list_events': return await this.listEvents(input);
        case 'create_event': return await this.createEvent(input);
        case 'update_event': return await this.updateEvent(input);
        case 'delete_event': return await this.deleteEvent(input);
        case 'check_availability': return await this.checkAvailability(input);
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
   * Verify connectivity to the Google Calendar API.
   *
   * @returns `true` if the Calendar API is reachable and credentials are valid
   */
  async healthCheck(): Promise<boolean> {
    if (!this.accessToken) return false;
    try {
      const res = await this.calendarFetch('/calendars/primary');
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Operations ────────────────────────────────────────────────────────

  /** List events from the primary calendar within a date range */
  private async listEvents(input: Record<string, unknown>): Promise<ConnectorResult> {
    const calendarId = (input.calendarId as string) || 'primary';
    const maxResults = (input.maxResults as number) || 25;
    const timeMin = input.timeMin as string | undefined;
    const timeMax = input.timeMax as string | undefined;

    const params = new URLSearchParams({
      maxResults: String(maxResults),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    if (timeMin) params.set('timeMin', timeMin);
    if (timeMax) params.set('timeMax', timeMax);

    const res = await this.calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    const events = (data.items || []).map((ev: any) => ({
      id: ev.id,
      summary: ev.summary,
      start: ev.start,
      end: ev.end,
      status: ev.status,
      attendees: (ev.attendees || []).map((a: any) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus: a.responseStatus,
      })),
    }));

    return {
      success: true,
      data: {
        events,
        resultCount: events.length,
        nextPageToken: data.nextPageToken,
      },
    };
  }

  /** Create a new calendar event */
  private async createEvent(input: Record<string, unknown>): Promise<ConnectorResult> {
    const summary = input.summary as string;
    const start = input.start as string;
    const end = input.end as string;
    if (!summary || !start || !end) {
      return { success: false, error: 'summary, start, and end are required' };
    }

    const calendarId = (input.calendarId as string) || 'primary';
    const description = input.description as string | undefined;
    const location = input.location as string | undefined;
    const attendees = input.attendees as string[] | undefined;

    const body: Record<string, unknown> = {
      summary,
      start: { dateTime: start },
      end: { dateTime: end },
    };
    if (description) body.description = description;
    if (location) body.location = location;
    if (attendees && attendees.length > 0) {
      body.attendees = attendees.map((email) => ({ email }));
    }

    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    return {
      success: true,
      data: {
        id: data.id,
        summary: data.summary,
        start: data.start,
        end: data.end,
        status: data.status,
        htmlLink: data.htmlLink,
      },
    };
  }

  /** Update an existing calendar event */
  private async updateEvent(input: Record<string, unknown>): Promise<ConnectorResult> {
    const eventId = input.eventId as string;
    if (!eventId) {
      return { success: false, error: 'eventId is required' };
    }

    const calendarId = (input.calendarId as string) || 'primary';

    // Build partial update body — only include fields that are provided
    const body: Record<string, unknown> = {};
    if (input.summary !== undefined) body.summary = input.summary;
    if (input.description !== undefined) body.description = input.description;
    if (input.location !== undefined) body.location = input.location;
    if (input.start !== undefined) body.start = { dateTime: input.start as string };
    if (input.end !== undefined) body.end = { dateTime: input.end as string };
    if (input.attendees !== undefined) {
      body.attendees = (input.attendees as string[]).map((email) => ({ email }));
    }

    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    return {
      success: true,
      data: {
        id: data.id,
        summary: data.summary,
        start: data.start,
        end: data.end,
        status: data.status,
        htmlLink: data.htmlLink,
      },
    };
  }

  /** Delete a calendar event by its ID */
  private async deleteEvent(input: Record<string, unknown>): Promise<ConnectorResult> {
    const eventId = input.eventId as string;
    if (!eventId) {
      return { success: false, error: 'eventId is required' };
    }

    const calendarId = (input.calendarId as string) || 'primary';

    const res = await this.calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    );
    // DELETE returns 204 No Content on success
    if (!res.ok && res.status !== 204) return this.apiError(res);

    return {
      success: true,
      data: { eventId, deleted: true },
    };
  }

  /** Check free/busy availability for a time range */
  private async checkAvailability(input: Record<string, unknown>): Promise<ConnectorResult> {
    const timeMin = input.timeMin as string;
    const timeMax = input.timeMax as string;
    if (!timeMin || !timeMax) {
      return { success: false, error: 'timeMin and timeMax are required' };
    }

    // Items to check availability for — defaults to the primary calendar
    const items = (input.items as Array<{ id: string }>) || [{ id: 'primary' }];

    const body = {
      timeMin,
      timeMax,
      items,
    };

    const res = await this.calendarFetch('/freeBusy', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    const calendars = data.calendars || {};

    // Transform the response into a more usable format
    const availability: Record<string, unknown> = {};
    for (const [calId, calData] of Object.entries(calendars)) {
      const cal = calData as any;
      availability[calId] = {
        busy: cal.busy || [],
        errors: cal.errors || [],
      };
    }

    return {
      success: true,
      data: {
        timeMin: data.timeMin,
        timeMax: data.timeMax,
        availability,
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async calendarFetch(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${CALENDAR_API}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...((options?.headers as Record<string, string>) || {}),
      },
    });
  }

  private async apiError(res: Response): Promise<ConnectorResult> {
    let msg = `Google Calendar API error: ${res.status}`;
    try {
      const data = (await res.json()) as any;
      msg = data.error?.message || msg;
    } catch { /* ignore parse errors */ }
    return { success: false, error: msg };
  }
}
