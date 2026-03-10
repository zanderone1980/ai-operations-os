/**
 * Webhook Routes — Inbound event processing from external services.
 *
 * POST   /api/webhooks/gmail       Gmail push notification
 * POST   /api/webhooks/calendar    Google Calendar push notification
 * POST   /api/webhooks/shopify     Shopify webhook
 * POST   /api/webhooks/stripe      Stripe webhook
 * POST   /api/webhooks/generic     Generic webhook (custom integrations)
 */

import { randomUUID } from 'node:crypto';
import { createTask } from '@ai-operations/shared-types';
import type { TaskSource } from '@ai-operations/shared-types';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';

// ── Webhook event log ────────────────────────────────────────────────────────

interface WebhookEvent {
  id: string;
  source: string;
  receivedAt: string;
  payload: Record<string, unknown>;
  taskCreated?: string;
}

const webhookLog: WebhookEvent[] = [];

// ── Route handlers ───────────────────────────────────────────────────────────

/** Process Gmail push notification */
async function handleGmailWebhook(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const event: WebhookEvent = {
    id: randomUUID(),
    source: 'gmail',
    receivedAt: new Date().toISOString(),
    payload: body,
  };

  // Create a task from the webhook
  const task = createTask({
    source: 'email',
    title: (body.subject as string) || 'New email received',
    body: (body.snippet as string) || undefined,
    sourceId: (body.messageId as string) || undefined,
    metadata: body,
  });

  event.taskCreated = task.id;
  webhookLog.push(event);

  console.log(`[webhook] Gmail: created task ${task.id}`);
  sendJson(res, 200, { received: true, taskId: task.id });
}

/** Process Calendar push notification */
async function handleCalendarWebhook(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const event: WebhookEvent = {
    id: randomUUID(),
    source: 'calendar',
    receivedAt: new Date().toISOString(),
    payload: body,
  };

  const task = createTask({
    source: 'calendar',
    title: (body.summary as string) || 'Calendar event update',
    body: (body.description as string) || undefined,
    sourceId: (body.eventId as string) || undefined,
    intent: 'schedule',
    metadata: body,
  });

  event.taskCreated = task.id;
  webhookLog.push(event);

  console.log(`[webhook] Calendar: created task ${task.id}`);
  sendJson(res, 200, { received: true, taskId: task.id });
}

/** Process Shopify webhook */
async function handleShopifyWebhook(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const event: WebhookEvent = {
    id: randomUUID(),
    source: 'shopify',
    receivedAt: new Date().toISOString(),
    payload: body,
  };

  const task = createTask({
    source: 'store',
    title: `Order ${(body.order_number as string) || 'received'}`,
    intent: 'fulfill',
    sourceId: (body.id as string)?.toString() || undefined,
    metadata: body,
  });

  event.taskCreated = task.id;
  webhookLog.push(event);

  console.log(`[webhook] Shopify: created task ${task.id}`);
  sendJson(res, 200, { received: true, taskId: task.id });
}

/** Process Stripe webhook */
async function handleStripeWebhook(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const event: WebhookEvent = {
    id: randomUUID(),
    source: 'stripe',
    receivedAt: new Date().toISOString(),
    payload: body,
  };

  const eventType = (body.type as string) || 'unknown';
  const task = createTask({
    source: 'store',
    title: `Stripe: ${eventType}`,
    sourceId: (body.id as string) || undefined,
    metadata: body,
  });

  event.taskCreated = task.id;
  webhookLog.push(event);

  console.log(`[webhook] Stripe (${eventType}): created task ${task.id}`);
  sendJson(res, 200, { received: true, taskId: task.id });
}

/** Process generic webhook */
async function handleGenericWebhook(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const source = (body.source as TaskSource) || 'manual';
  const event: WebhookEvent = {
    id: randomUUID(),
    source: 'generic',
    receivedAt: new Date().toISOString(),
    payload: body,
  };

  const task = createTask({
    source,
    title: (body.title as string) || 'Webhook event',
    body: (body.body as string) || undefined,
    metadata: body,
  });

  event.taskCreated = task.id;
  webhookLog.push(event);

  console.log(`[webhook] Generic: created task ${task.id}`);
  sendJson(res, 200, { received: true, taskId: task.id });
}

// ── Export routes ────────────────────────────────────────────────────────────

export const webhookRoutes: Route[] = [
  pathToRoute('POST', '/api/webhooks/gmail', handleGmailWebhook),
  pathToRoute('POST', '/api/webhooks/calendar', handleCalendarWebhook),
  pathToRoute('POST', '/api/webhooks/shopify', handleShopifyWebhook),
  pathToRoute('POST', '/api/webhooks/stripe', handleStripeWebhook),
  pathToRoute('POST', '/api/webhooks/generic', handleGenericWebhook),
];
