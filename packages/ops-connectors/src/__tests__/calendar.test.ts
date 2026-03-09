import { CalendarConnector } from '../calendar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnector(token = 'test-access-token') {
  return new CalendarConnector({
    credentials: { accessToken: token },
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

describe('CalendarConnector', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Constructor ───────────────────────────────────────────────────────

  it('should default name to "calendar"', () => {
    const c = new CalendarConnector();
    expect(c.name).toBe('calendar');
  });

  it('should accept a custom name', () => {
    const c = new CalendarConnector({ name: 'my-cal' });
    expect(c.name).toBe('my-cal');
  });

  it('should be disabled without accessToken', () => {
    const c = new CalendarConnector();
    expect(c.isEnabled()).toBe(false);
  });

  it('should be enabled with accessToken', () => {
    const c = makeConnector();
    expect(c.isEnabled()).toBe(true);
  });

  it('should expose correct supported operations', () => {
    const c = makeConnector();
    expect(c.supportedOperations).toEqual([
      'list_events',
      'create_event',
      'update_event',
      'delete_event',
      'check_availability',
    ]);
  });

  // ── execute without token ─────────────────────────────────────────────

  it('should return error when executed without token', async () => {
    const c = new CalendarConnector();
    const result = await c.execute('list_events', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('No Google Calendar access token');
  });

  it('should return error for unsupported operation', async () => {
    const c = makeConnector();
    const result = await c.execute('cancel_event', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported operation');
  });

  // ── list_events ───────────────────────────────────────────────────────

  it('should list events with default parameters', async () => {
    const apiBody = {
      items: [
        {
          id: 'ev1',
          summary: 'Standup',
          start: { dateTime: '2024-01-15T09:00:00Z' },
          end: { dateTime: '2024-01-15T09:30:00Z' },
          status: 'confirmed',
          attendees: [
            { email: 'a@b.com', displayName: 'A', responseStatus: 'accepted' },
          ],
        },
      ],
      nextPageToken: 'page2',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(apiBody));

    const c = makeConnector();
    const result = await c.execute('list_events', {});

    expect(result.success).toBe(true);
    const events = result.data?.events as unknown[];
    expect(events).toHaveLength(1);
    expect(result.data?.nextPageToken).toBe('page2');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/calendars/primary/events');
    expect(url).toContain('singleEvents=true');
    expect(url).toContain('orderBy=startTime');
  });

  it('should pass timeMin/timeMax when provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [] }));

    const c = makeConnector();
    await c.execute('list_events', {
      timeMin: '2024-01-01T00:00:00Z',
      timeMax: '2024-01-31T23:59:59Z',
      maxResults: 10,
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('timeMin=2024-01-01');
    expect(url).toContain('timeMax=2024-01-31');
    expect(url).toContain('maxResults=10');
  });

  it('should handle empty event list', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const c = makeConnector();
    const result = await c.execute('list_events', {});
    expect(result.success).toBe(true);
    expect(result.data?.resultCount).toBe(0);
  });

  // ── create_event ──────────────────────────────────────────────────────

  it('should create an event with required fields', async () => {
    const created = {
      id: 'ev-new',
      summary: 'Meeting',
      start: { dateTime: '2024-02-01T10:00:00Z' },
      end: { dateTime: '2024-02-01T11:00:00Z' },
      status: 'confirmed',
      htmlLink: 'https://calendar.google.com/event?eid=ev-new',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(created));

    const c = makeConnector();
    const result = await c.execute('create_event', {
      summary: 'Meeting',
      start: '2024-02-01T10:00:00Z',
      end: '2024-02-01T11:00:00Z',
    });

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('ev-new');
    expect(result.data?.htmlLink).toBeDefined();

    const opts = fetchSpy.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.summary).toBe('Meeting');
    expect(body.start.dateTime).toBe('2024-02-01T10:00:00Z');
  });

  it('should include optional fields (description, location, attendees)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: 'ev2' }));

    const c = makeConnector();
    await c.execute('create_event', {
      summary: 'Lunch',
      start: '2024-02-01T12:00:00Z',
      end: '2024-02-01T13:00:00Z',
      description: 'Team lunch',
      location: 'HQ',
      attendees: ['a@b.com', 'c@d.com'],
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.description).toBe('Team lunch');
    expect(body.location).toBe('HQ');
    expect(body.attendees).toEqual([{ email: 'a@b.com' }, { email: 'c@d.com' }]);
  });

  it('should require summary, start, and end for create_event', async () => {
    const c = makeConnector();

    const r1 = await c.execute('create_event', { start: 's', end: 'e' });
    expect(r1.success).toBe(false);

    const r2 = await c.execute('create_event', { summary: 'X', end: 'e' });
    expect(r2.success).toBe(false);

    const r3 = await c.execute('create_event', { summary: 'X', start: 's' });
    expect(r3.success).toBe(false);
  });

  // ── update_event ──────────────────────────────────────────────────────

  it('should patch an event with partial fields', async () => {
    const updated = {
      id: 'ev1',
      summary: 'Updated Meeting',
      start: { dateTime: '2024-02-01T11:00:00Z' },
      end: { dateTime: '2024-02-01T12:00:00Z' },
      status: 'confirmed',
      htmlLink: 'https://calendar.google.com/event?eid=ev1',
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(updated));

    const c = makeConnector();
    const result = await c.execute('update_event', {
      eventId: 'ev1',
      summary: 'Updated Meeting',
    });

    expect(result.success).toBe(true);
    expect(result.data?.summary).toBe('Updated Meeting');

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(opts.method).toBe('PATCH');
    expect(url).toContain('/events/ev1');
  });

  it('should require eventId for update_event', async () => {
    const c = makeConnector();
    const result = await c.execute('update_event', { summary: 'No ID' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('eventId is required');
  });

  // ── delete_event ──────────────────────────────────────────────────────

  it('should delete an event and handle 204 response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => ({}),
      headers: new Headers(),
    } as unknown as Response);

    const c = makeConnector();
    const result = await c.execute('delete_event', { eventId: 'ev-del' });

    expect(result.success).toBe(true);
    expect(result.data?.deleted).toBe(true);
    expect(result.data?.eventId).toBe('ev-del');

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(opts.method).toBe('DELETE');
    expect(url).toContain('/events/ev-del');
  });

  it('should require eventId for delete_event', async () => {
    const c = makeConnector();
    const result = await c.execute('delete_event', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('eventId is required');
  });

  // ── check_availability ────────────────────────────────────────────────

  it('should post a freeBusy request', async () => {
    const freeBusyResponse = {
      timeMin: '2024-01-15T08:00:00Z',
      timeMax: '2024-01-15T18:00:00Z',
      calendars: {
        primary: {
          busy: [{ start: '2024-01-15T09:00:00Z', end: '2024-01-15T10:00:00Z' }],
          errors: [],
        },
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(freeBusyResponse));

    const c = makeConnector();
    const result = await c.execute('check_availability', {
      timeMin: '2024-01-15T08:00:00Z',
      timeMax: '2024-01-15T18:00:00Z',
    });

    expect(result.success).toBe(true);
    expect(result.data?.timeMin).toBe('2024-01-15T08:00:00Z');
    const availability = result.data?.availability as Record<string, any>;
    expect(availability.primary.busy).toHaveLength(1);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/freeBusy');
    expect(opts.method).toBe('POST');
  });

  it('should require timeMin and timeMax for check_availability', async () => {
    const c = makeConnector();
    const r1 = await c.execute('check_availability', { timeMin: 'x' });
    expect(r1.success).toBe(false);
    const r2 = await c.execute('check_availability', { timeMax: 'x' });
    expect(r2.success).toBe(false);
  });

  // ── healthCheck ───────────────────────────────────────────────────────

  it('should return true when /calendars/primary responds ok', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: 'primary' }));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(true);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/calendars/primary');
  });

  it('should return false on 401', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, 401));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('should return false when fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network down'));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('should return false without token', async () => {
    const c = new CalendarConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  // ── API error handling ────────────────────────────────────────────────

  it('should parse Google Calendar API error message', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Rate limit exceeded' } }, 429),
    );
    const c = makeConnector();
    const result = await c.execute('list_events', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Rate limit exceeded');
  });

  it('should catch thrown errors during execution', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('DNS failure'));
    const c = makeConnector();
    const result = await c.execute('list_events', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('DNS failure');
  });
});
