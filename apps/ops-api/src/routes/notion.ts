/**
 * Notion Routes — Notion workspace integration.
 *
 * GET   /api/notion/search         Search pages and databases
 * GET   /api/notion/pages/:id      Read a specific page
 * POST  /api/notion/pages          Create a new page
 * PATCH /api/notion/pages/:id      Update a page
 * POST  /api/notion/databases/:id/query  Query a database
 */

import { NotionConnector } from '@ai-operations/ops-connectors';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';

// ── Connector ──────────────────────────────────────────────────────────────

function getNotionConnector(): NotionConnector | null {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) return null;
  return new NotionConnector({ credentials: { apiKey } });
}

// ── Route Handlers ──────────────────────────────────────────────────────────

/** GET /api/notion/search — Search pages and databases */
async function searchNotion(ctx: any): Promise<void> {
  const { res, query } = ctx;
  const notion = getNotionConnector();
  if (!notion) {
    sendError(res, 401, 'Notion not connected. Set NOTION_API_KEY env var.');
    return;
  }

  const result = await notion.execute('search', {
    query: query.q || '',
    filter: query.filter ? { property: 'object', value: query.filter } : undefined,
    page_size: parseInt(query.limit || '10', 10),
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to search Notion');
    return;
  }

  sendJson(res, 200, result.data);
}

/** GET /api/notion/pages/:id — Read a page */
async function readPage(ctx: any): Promise<void> {
  const { res, params } = ctx;
  const notion = getNotionConnector();
  if (!notion) {
    sendError(res, 401, 'Notion not connected. Set NOTION_API_KEY env var.');
    return;
  }

  const result = await notion.execute('read', { pageId: params.id });
  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to read page');
    return;
  }

  sendJson(res, 200, result.data);
}

/** POST /api/notion/pages — Create a page */
async function createPage(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const notion = getNotionConnector();
  if (!notion) {
    sendError(res, 401, 'Notion not connected. Set NOTION_API_KEY env var.');
    return;
  }

  if (!body.parent) {
    sendError(res, 400, 'Missing required field: parent (database_id or page_id)');
    return;
  }

  const result = await notion.execute('create', {
    parent: body.parent,
    properties: body.properties || {},
    children: body.children,
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to create page');
    return;
  }

  sendJson(res, 201, result.data);
}

/** PATCH /api/notion/pages/:id — Update a page */
async function updatePage(ctx: any): Promise<void> {
  const { res, params, body } = ctx;
  const notion = getNotionConnector();
  if (!notion) {
    sendError(res, 401, 'Notion not connected. Set NOTION_API_KEY env var.');
    return;
  }

  const result = await notion.execute('update', {
    pageId: params.id,
    properties: body.properties || {},
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to update page');
    return;
  }

  sendJson(res, 200, result.data);
}

/** POST /api/notion/databases/:id/query — Query a database */
async function queryDatabase(ctx: any): Promise<void> {
  const { res, params, body } = ctx;
  const notion = getNotionConnector();
  if (!notion) {
    sendError(res, 401, 'Notion not connected. Set NOTION_API_KEY env var.');
    return;
  }

  const result = await notion.execute('list', {
    databaseId: params.id,
    filter: body.filter,
    sorts: body.sorts,
    page_size: body.page_size || 100,
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to query database');
    return;
  }

  sendJson(res, 200, result.data);
}

// ── Export routes ────────────────────────────────────────────────────────────

export const notionRoutes: Route[] = [
  pathToRoute('GET', '/api/notion/search', searchNotion),
  pathToRoute('GET', '/api/notion/pages/:id', readPage),
  pathToRoute('POST', '/api/notion/pages', createPage),
  pathToRoute('PATCH', '/api/notion/pages/:id', updatePage),
  pathToRoute('POST', '/api/notion/databases/:id/query', queryDatabase),
];
