/**
 * Slack Routes — Slack messaging integration.
 *
 * GET   /api/slack/channels          List channels
 * GET   /api/slack/messages/:channel  Read messages from a channel
 * POST  /api/slack/send              Send a message to a channel
 * POST  /api/slack/react             Add a reaction to a message
 * GET   /api/slack/search            Search messages
 */

import { SlackConnector } from '@ai-operations/ops-connectors';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';

// ── Connector ──────────────────────────────────────────────────────────────

function getSlackConnector(): SlackConnector | null {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return null;
  return new SlackConnector({ credentials: { botToken } });
}

// ── Route Handlers ──────────────────────────────────────────────────────────

/** GET /api/slack/channels — List channels */
async function listChannels(ctx: any): Promise<void> {
  const { res, query } = ctx;
  const slack = getSlackConnector();
  if (!slack) {
    sendError(res, 401, 'Slack not connected. Set SLACK_BOT_TOKEN env var.');
    return;
  }

  const result = await slack.execute('list', {
    limit: parseInt(query.limit || '100', 10),
    types: query.types || 'public_channel,private_channel',
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to list channels');
    return;
  }

  sendJson(res, 200, result.data);
}

/** GET /api/slack/messages/:channel — Read messages from a channel */
async function readMessages(ctx: any): Promise<void> {
  const { res, params, query } = ctx;
  const slack = getSlackConnector();
  if (!slack) {
    sendError(res, 401, 'Slack not connected. Set SLACK_BOT_TOKEN env var.');
    return;
  }

  const result = await slack.execute('read', {
    channel: params.channel,
    limit: parseInt(query.limit || '20', 10),
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to read messages');
    return;
  }

  sendJson(res, 200, result.data);
}

/** POST /api/slack/send — Send a message */
async function sendMessage(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const slack = getSlackConnector();
  if (!slack) {
    sendError(res, 401, 'Slack not connected. Set SLACK_BOT_TOKEN env var.');
    return;
  }

  if (!body.channel || !body.text) {
    sendError(res, 400, 'Missing required fields: channel, text');
    return;
  }

  const result = await slack.execute('send', {
    channel: body.channel as string,
    text: body.text as string,
    blocks: body.blocks,
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to send message');
    return;
  }

  sendJson(res, 200, result.data);
}

/** POST /api/slack/react — Add a reaction */
async function addReaction(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const slack = getSlackConnector();
  if (!slack) {
    sendError(res, 401, 'Slack not connected. Set SLACK_BOT_TOKEN env var.');
    return;
  }

  if (!body.channel || !body.timestamp || !body.name) {
    sendError(res, 400, 'Missing required fields: channel, timestamp, name');
    return;
  }

  const result = await slack.execute('react', {
    channel: body.channel as string,
    timestamp: body.timestamp as string,
    name: body.name as string,
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to add reaction');
    return;
  }

  sendJson(res, 200, result.data);
}

/** GET /api/slack/search — Search messages */
async function searchMessages(ctx: any): Promise<void> {
  const { res, query } = ctx;
  const slack = getSlackConnector();
  if (!slack) {
    sendError(res, 401, 'Slack not connected. Set SLACK_BOT_TOKEN env var.');
    return;
  }

  if (!query.q) {
    sendError(res, 400, 'Missing required query parameter: q');
    return;
  }

  const result = await slack.execute('search', {
    query: query.q,
    count: parseInt(query.count || '20', 10),
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to search messages');
    return;
  }

  sendJson(res, 200, result.data);
}

// ── Export routes ────────────────────────────────────────────────────────────

export const slackRoutes: Route[] = [
  pathToRoute('GET', '/api/slack/channels', listChannels),
  pathToRoute('GET', '/api/slack/messages/:channel', readMessages),
  pathToRoute('GET', '/api/slack/search', searchMessages),
  pathToRoute('POST', '/api/slack/send', sendMessage),
  pathToRoute('POST', '/api/slack/react', addReaction),
];
