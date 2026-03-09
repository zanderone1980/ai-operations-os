/**
 * AI Operations OS — API Server
 *
 * HTTP/SSE API for task management, workflow orchestration,
 * approval inbox, and webhook processing.
 *
 * Zero external dependencies — uses Node.js built-in http module.
 */

import * as http from 'http';
import { stores } from './storage';
import { taskRoutes } from './routes/tasks';
import { workflowRoutes } from './routes/workflows';
import { approvalRoutes } from './routes/approvals';
import { webhookRoutes } from './routes/webhooks';
import { pipelineRoutes } from './routes/pipeline';
import { oauthRoutes } from './routes/oauth';

export { stores };

const PORT = parseInt(process.env.OPS_PORT || '3100', 10);
const HOST = process.env.OPS_HOST || '0.0.0.0';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  path: string;
  method: string;
  body: Record<string, unknown>;
  params: Record<string, string>;
  query: Record<string, string>;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void>;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

// ── Routing ──────────────────────────────────────────────────────────────────

const routes: Route[] = [
  ...taskRoutes,
  ...workflowRoutes,
  ...approvalRoutes,
  ...webhookRoutes,
  ...pipelineRoutes,
  ...oauthRoutes,
];

/**
 * Parse a URL path like /api/tasks/:id into a RegExp with named params.
 */
export function pathToRoute(method: string, path: string, handler: RouteHandler): Route {
  const paramNames: string[] = [];
  const pattern = path.replace(/:(\w+)/g, (_match, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return {
    method: method.toUpperCase(),
    pattern: new RegExp(`^${pattern}$`),
    paramNames,
    handler,
  };
}

/**
 * Parse query string into key-value pairs.
 */
function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  const qs = url.slice(idx + 1);
  for (const pair of qs.split('&')) {
    const [key, val] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || '');
  }
  return params;
}

/**
 * Read request body as JSON.
 */
async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

export function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const url = req.url || '/';
  const path = url.split('?')[0];

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  // Health check
  if (path === '/health' || path === '/api/health') {
    sendJson(res, 200, { status: 'ok', version: '0.1.0', uptime: process.uptime() });
    return;
  }

  // Match route
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.pattern);
    if (!match) continue;

    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      params[name] = match[i + 1];
    });

    try {
      const body = await readBody(req);
      const query = parseQuery(url);
      await route.handler({ req, res, path, method, body, params, query });
    } catch (err) {
      console.error(`[ops-api] Error in ${method} ${path}:`, err);
      sendError(res, 500, 'Internal server error');
    }
    return;
  }

  // 404
  sendError(res, 404, `Not found: ${method} ${path}`);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  AI Operations OS — API Server`);
  console.log(`  Listening on http://${HOST}:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log(`  Routes: ${routes.length} registered\n`);
});

export { server };
