/**
 * Calendar Routes — End-to-end Google Calendar pipeline.
 *
 * GET   /api/calendar/events           List upcoming events (requires OAuth)
 * GET   /api/calendar/events/:id       Get a specific event by ID
 * POST  /api/calendar/process          Full pipeline: classify intent -> policy -> CORD safety -> approve -> execute -> receipt
 * POST  /api/calendar/availability     Check free/busy availability for a time range
 * POST  /api/calendar/create           Create event through the pipeline (classify -> policy -> safety -> approve -> execute -> receipt)
 *
 * All endpoints dynamically load OAuth credentials from ~/.ai-ops/credentials.json
 * so the Calendar connector is always initialized with the freshest token.
 */

import { CalendarConnector } from '@ai-ops/ops-connectors';
import { IntentClassifier } from '@ai-ops/ops-core';
import { RuleEngine } from '@ai-ops/ops-policy';
import {
  DEFAULT_POLICY,
  createTask,
  createApproval,
  verifyReceiptChain,
} from '@ai-ops/shared-types';
import type { TaskSource, CordDecision } from '@ai-ops/shared-types';
import { ReceiptBuilder } from '@ai-ops/codebot-adapter';
import { evaluateAction } from '../middleware/cord-gate';
import { requestApproval } from './approvals';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import { getGoogleAccessToken } from './oauth';

// -- Singletons ---------------------------------------------------------------

const classifier = new IntentClassifier();
const ruleEngine = new RuleEngine(DEFAULT_POLICY);
const HMAC_KEY = process.env.CORD_HMAC_KEY || 'ai-ops-dev-key';

/**
 * Create a Calendar connector with fresh OAuth credentials.
 * Returns null if no credentials are available.
 */
async function getCalendarConnector(): Promise<CalendarConnector | null> {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) return null;

  return new CalendarConnector({
    credentials: { accessToken },
  });
}

// -- Route Handlers -----------------------------------------------------------

/**
 * GET /api/calendar/events -- List upcoming calendar events.
 * Query: ?timeMin=...&timeMax=...&maxResults=25&calendarId=primary
 */
async function listEvents(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const calendar = await getCalendarConnector();
  if (!calendar) {
    sendError(res, 401, 'Calendar not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  const result = await calendar.execute('list_events', {
    calendarId: query.calendarId || 'primary',
    maxResults: parseInt(query.maxResults || '25', 10),
    timeMin: query.timeMin,
    timeMax: query.timeMax,
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to list events');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * GET /api/calendar/events/:id -- Get a specific event by ID.
 * Query: ?calendarId=primary
 */
async function getEvent(ctx: any): Promise<void> {
  const { res, params, query } = ctx;

  const calendar = await getCalendarConnector();
  if (!calendar) {
    sendError(res, 401, 'Calendar not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  // Use list_events with a filter — the Calendar connector doesn't expose a
  // single-event read, but the Google Calendar API supports it. We issue a
  // direct list call scoped to the event ID. Since the connector wraps the
  // REST API, we can also just call execute with an operation that fetches by
  // ID. For now, return a 501 if a dedicated get isn't supported, but attempt
  // it first via the connector's list with a narrow scope.

  // The connector doesn't have a dedicated 'get_event' operation, but we can
  // still list events and the caller can filter. Let's return a not-implemented
  // if the connector doesn't support it directly.
  const eventId = params.id;
  if (!eventId) {
    sendError(res, 400, 'Missing event ID');
    return;
  }

  // The CalendarConnector doesn't expose a get_event operation, so we
  // make a targeted list call. The event ID won't directly filter via
  // list_events, but we keep the route available for future connector
  // expansion. For now return 501.
  sendError(res, 501, 'Get single event is not yet supported by the Calendar connector. Use GET /api/calendar/events to list events.');
}

/**
 * POST /api/calendar/process -- Full pipeline for a calendar request.
 *
 * Body: {
 *   summary: string,
 *   start: string,
 *   end: string,
 *   description?: string,
 *   location?: string,
 *   attendees?: string[],
 *   eventId?: string,          // If present, treat as update
 *   autoApprove?: boolean
 * }
 *
 * Returns the complete pipeline result with receipt chain:
 * {
 *   task, intent, policy, safety, approval,
 *   execution, receipts, receiptChainValid
 * }
 */
async function processCalendarRequest(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const autoApprove = body.autoApprove === true;

  const summary = body.summary as string || '';
  const description = body.description as string || '';
  const start = body.start as string || '';
  const end = body.end as string || '';
  const location = body.location as string || '';
  const attendees = body.attendees as string[] || [];
  const eventId = body.eventId as string | undefined;

  if (!summary && !eventId) {
    sendError(res, 400, 'Missing required field: summary (or eventId for updates)');
    return;
  }

  const calendar = await getCalendarConnector();
  if (!calendar) {
    sendError(res, 401, 'Calendar not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  const receiptBuilder = new ReceiptBuilder();
  const policyVersion = DEFAULT_POLICY.version;

  // -- Step 1: Classify intent ------------------------------------------------
  const intentText = `${summary} ${description}`.trim();
  const classification = classifier.classifyDetailed(intentText);

  // Determine operation: update if eventId present, otherwise create
  const operation = eventId ? 'update_event' : 'create_event';

  const task = createTask({
    source: 'api' as TaskSource,
    title: summary || `Calendar ${operation}: ${eventId}`,
    body: description || `${operation} event: ${summary}`,
    sourceId: eventId || `new-event-${Date.now()}`,
    intent: classification.intent,
    metadata: {
      summary,
      start,
      end,
      location,
      attendees,
      eventId,
      operation,
      classificationConfidence: classification.confidence,
      classificationKeywords: classification.matchedKeywords,
    },
  });

  // -- Step 2: Evaluate policy ------------------------------------------------
  const policyResult = ruleEngine.evaluate('calendar', operation, { source: 'api' });

  // -- Step 3: Evaluate CORD safety -------------------------------------------
  const actionInput = eventId
    ? { eventId, summary, start, end, description, location, attendees }
    : { summary, start, end, description, location, attendees };

  const cordSafety = evaluateAction('calendar', operation, actionInput);

  // Receipt for classification step
  receiptBuilder.addStep({
    actionId: `classify-${task.sourceId}`,
    policyVersion,
    cordDecision: cordSafety.decision as CordDecision,
    cordScore: cordSafety.score,
    cordReasons: cordSafety.reasons,
    input: { summary, operation },
    output: { intent: classification.intent, confidence: classification.confidence },
  });

  const needsApproval = cordSafety.decision === 'CHALLENGE'
    || policyResult.autonomy === 'approve';
  const isBlocked = cordSafety.decision === 'BLOCK'
    || policyResult.autonomy === 'deny';

  // -- Step 4: Handle blocked --------------------------------------------------
  if (isBlocked) {
    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: {
        decision: cordSafety.decision,
        score: cordSafety.score,
        reasons: cordSafety.reasons,
      },
      blocked: true,
      reason: policyResult.autonomy === 'deny'
        ? `Policy denied: ${policyResult.reason}`
        : `CORD blocked: ${cordSafety.reasons.join(', ')}`,
      receipts: receiptBuilder.finalize(HMAC_KEY),
    });
    return;
  }

  // -- Step 5: Approval gate --------------------------------------------------
  let approvalResult: { needed: boolean; decision?: string; approvalId?: string } = {
    needed: needsApproval,
  };

  if (needsApproval && !autoApprove) {
    const approval = requestApproval(
      `${operation}-${task.sourceId}`,
      task.id,
      policyResult.risk as 'low' | 'medium' | 'high' | 'critical',
      needsApproval && cordSafety.decision === 'CHALLENGE'
        ? `CORD challenge (score: ${cordSafety.score})`
        : `Policy requires approval: ${policyResult.reason}`,
      `${operation}: ${summary || eventId}`,
    );

    approvalResult = {
      needed: true,
      decision: 'pending',
      approvalId: approval.id,
    };

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: {
        decision: cordSafety.decision,
        score: cordSafety.score,
        reasons: cordSafety.reasons,
      },
      approval: approvalResult,
      message: 'Approval required. Decide at POST /api/approvals/:id/decide',
      receipts: receiptBuilder.finalize(HMAC_KEY),
    });
    return;
  }

  // -- Step 6: Execute calendar operation -------------------------------------
  let execution: { success: boolean; data?: Record<string, unknown>; error?: string };

  if (operation === 'update_event') {
    const updateResult = await calendar.execute('update_event', {
      eventId,
      summary: summary || undefined,
      start: start || undefined,
      end: end || undefined,
      description: description || undefined,
      location: location || undefined,
      attendees: attendees.length > 0 ? attendees : undefined,
    });

    execution = {
      success: updateResult.success,
      data: updateResult.data,
      error: updateResult.error,
    };
  } else {
    if (!start || !end) {
      sendError(res, 400, 'Missing required fields: start and end are required for create_event');
      return;
    }

    const createResult = await calendar.execute('create_event', {
      summary,
      start,
      end,
      description: description || undefined,
      location: location || undefined,
      attendees: attendees.length > 0 ? attendees : undefined,
    });

    execution = {
      success: createResult.success,
      data: createResult.data,
      error: createResult.error,
    };
  }

  // Receipt for execution step
  receiptBuilder.addStep({
    actionId: `${operation}-${task.sourceId}`,
    policyVersion,
    cordDecision: cordSafety.decision as CordDecision,
    cordScore: cordSafety.score,
    cordReasons: cordSafety.reasons,
    input: actionInput,
    output: execution.data || {},
  });

  // -- Step 7: Build receipt chain --------------------------------------------
  const receipts = receiptBuilder.finalize(HMAC_KEY);
  const chainValid = verifyReceiptChain(receipts, HMAC_KEY);

  sendJson(res, 200, {
    task,
    intent: classification,
    policy: policyResult,
    safety: {
      decision: cordSafety.decision,
      score: cordSafety.score,
      reasons: cordSafety.reasons,
    },
    approval: approvalResult,
    execution,
    receipts,
    receiptChainValid: chainValid.valid,
  });
}

/**
 * POST /api/calendar/availability -- Check free/busy availability.
 *
 * Body: { timeMin: string, timeMax: string, items?: Array<{ id: string }> }
 */
async function checkAvailability(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const timeMin = body.timeMin as string;
  const timeMax = body.timeMax as string;

  if (!timeMin || !timeMax) {
    sendError(res, 400, 'Missing required fields: timeMin and timeMax');
    return;
  }

  const calendar = await getCalendarConnector();
  if (!calendar) {
    sendError(res, 401, 'Calendar not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  const result = await calendar.execute('check_availability', {
    timeMin,
    timeMax,
    items: body.items || [{ id: 'primary' }],
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to check availability');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * POST /api/calendar/create -- Create event through the full pipeline.
 *
 * Body: {
 *   summary: string,
 *   start: string,
 *   end: string,
 *   description?: string,
 *   location?: string,
 *   attendees?: string[],
 *   autoApprove?: boolean
 * }
 *
 * Runs: classify intent -> policy -> CORD safety -> approve -> execute -> receipt
 */
async function createEvent(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const summary = body.summary as string;
  const start = body.start as string;
  const end = body.end as string;

  if (!summary || !start || !end) {
    sendError(res, 400, 'Missing required fields: summary, start, and end');
    return;
  }

  const calendar = await getCalendarConnector();
  if (!calendar) {
    sendError(res, 401, 'Calendar not connected. Authorize at GET /api/oauth/google/url');
    return;
  }

  const autoApprove = body.autoApprove === true;
  const description = body.description as string || '';
  const location = body.location as string || '';
  const attendees = body.attendees as string[] || [];

  const receiptBuilder = new ReceiptBuilder();
  const policyVersion = DEFAULT_POLICY.version;

  // -- Step 1: Classify intent ------------------------------------------------
  const intentText = `${summary} ${description}`.trim();
  const classification = classifier.classifyDetailed(intentText);

  const task = createTask({
    source: 'api' as TaskSource,
    title: `Create event: ${summary}`,
    body: description || `Create calendar event: ${summary}`,
    sourceId: `new-event-${Date.now()}`,
    intent: classification.intent,
    metadata: {
      summary,
      start,
      end,
      location,
      attendees,
      classificationConfidence: classification.confidence,
      classificationKeywords: classification.matchedKeywords,
    },
  });

  // -- Step 2: Evaluate policy ------------------------------------------------
  const policyResult = ruleEngine.evaluate('calendar', 'create_event', { source: 'api' });

  // -- Step 3: Evaluate CORD safety -------------------------------------------
  const actionInput = { summary, start, end, description, location, attendees };
  const cordSafety = evaluateAction('calendar', 'create_event', actionInput);

  // Receipt for classification step
  receiptBuilder.addStep({
    actionId: `classify-${task.sourceId}`,
    policyVersion,
    cordDecision: cordSafety.decision as CordDecision,
    cordScore: cordSafety.score,
    cordReasons: cordSafety.reasons,
    input: { summary, operation: 'create_event' },
    output: { intent: classification.intent, confidence: classification.confidence },
  });

  const needsApproval = cordSafety.decision === 'CHALLENGE'
    || policyResult.autonomy === 'approve';
  const isBlocked = cordSafety.decision === 'BLOCK'
    || policyResult.autonomy === 'deny';

  // -- Step 4: Handle blocked --------------------------------------------------
  if (isBlocked) {
    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: {
        decision: cordSafety.decision,
        score: cordSafety.score,
        reasons: cordSafety.reasons,
      },
      blocked: true,
      reason: policyResult.autonomy === 'deny'
        ? `Policy denied: ${policyResult.reason}`
        : `CORD blocked: ${cordSafety.reasons.join(', ')}`,
      receipts: receiptBuilder.finalize(HMAC_KEY),
    });
    return;
  }

  // -- Step 5: Approval gate --------------------------------------------------
  let approvalResult: { needed: boolean; decision?: string; approvalId?: string } = {
    needed: needsApproval,
  };

  if (needsApproval && !autoApprove) {
    const approval = requestApproval(
      `create_event-${task.sourceId}`,
      task.id,
      policyResult.risk as 'low' | 'medium' | 'high' | 'critical',
      needsApproval && cordSafety.decision === 'CHALLENGE'
        ? `CORD challenge (score: ${cordSafety.score})`
        : `Policy requires approval: ${policyResult.reason}`,
      `Create event: ${summary}`,
    );

    approvalResult = {
      needed: true,
      decision: 'pending',
      approvalId: approval.id,
    };

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: {
        decision: cordSafety.decision,
        score: cordSafety.score,
        reasons: cordSafety.reasons,
      },
      approval: approvalResult,
      message: 'Approval required. Decide at POST /api/approvals/:id/decide',
      receipts: receiptBuilder.finalize(HMAC_KEY),
    });
    return;
  }

  // -- Step 6: Execute create -------------------------------------------------
  const createResult = await calendar.execute('create_event', {
    summary,
    start,
    end,
    description: description || undefined,
    location: location || undefined,
    attendees: attendees.length > 0 ? attendees : undefined,
  });

  const execution = {
    success: createResult.success,
    data: createResult.data,
    error: createResult.error,
  };

  // Receipt for execution step
  receiptBuilder.addStep({
    actionId: `create_event-${task.sourceId}`,
    policyVersion,
    cordDecision: cordSafety.decision as CordDecision,
    cordScore: cordSafety.score,
    cordReasons: cordSafety.reasons,
    input: actionInput,
    output: createResult.data || {},
  });

  // -- Step 7: Build receipt chain --------------------------------------------
  const receipts = receiptBuilder.finalize(HMAC_KEY);
  const chainValid = verifyReceiptChain(receipts, HMAC_KEY);

  sendJson(res, 200, {
    task,
    intent: classification,
    policy: policyResult,
    safety: {
      decision: cordSafety.decision,
      score: cordSafety.score,
      reasons: cordSafety.reasons,
    },
    approval: approvalResult,
    execution,
    receipts,
    receiptChainValid: chainValid.valid,
  });
}

// -- Export routes -------------------------------------------------------------

export const calendarRoutes: Route[] = [
  pathToRoute('GET', '/api/calendar/events', listEvents),
  pathToRoute('GET', '/api/calendar/events/:id', getEvent),
  pathToRoute('POST', '/api/calendar/process', processCalendarRequest),
  pathToRoute('POST', '/api/calendar/availability', checkAvailability),
  pathToRoute('POST', '/api/calendar/create', createEvent),
];
