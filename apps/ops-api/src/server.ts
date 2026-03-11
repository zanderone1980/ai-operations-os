/**
 * AI Operations OS — API Server
 *
 * HTTP/SSE API for task management, workflow orchestration,
 * approval inbox, and webhook processing.
 *
 * Zero external dependencies — uses Node.js built-in http module.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as nodePath from 'path';

// ── Load .env file (zero-dependency) ────────────────────────────────────────
function loadEnv(): void {
  // Skip in test environment — tests control their own env vars
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;

  // Walk up from dist/server.js → apps/ops-api → repo root
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const envPath = nodePath.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip inline comments (but not inside quoted values)
        if (!val.startsWith('"') && !val.startsWith("'")) {
          const commentIdx = val.indexOf('#');
          if (commentIdx > 0) val = val.slice(0, commentIdx).trim();
        }
        // Don't overwrite existing env vars (system takes precedence)
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
      break;
    }
    dir = nodePath.dirname(dir);
  }
}

loadEnv();

import { stores } from './storage';
import { createLogger } from '@ai-operations/ops-core';
import { requestLogger } from './middleware/request-logger';
import { taskRoutes } from './routes/tasks';
import { workflowRoutes } from './routes/workflows';
import { approvalRoutes } from './routes/approvals';
import { webhookRoutes } from './routes/webhooks';
import { pipelineRoutes } from './routes/pipeline';
import { oauthRoutes } from './routes/oauth';
import { gmailRoutes } from './routes/gmail';
import { shopifyRoutes } from './routes/shopify';
import { calendarRoutes } from './routes/calendar';
import { xTwitterRoutes } from './routes/x-twitter';
import { sparkRoutes } from './routes/spark';
import { connectorRoutes } from './routes/connectors';
import { receiptRoutes } from './routes/receipts';
import { slackRoutes } from './routes/slack';
import { notionRoutes } from './routes/notion';
import { authRoutes } from './routes/auth';
import { createRateLimiter } from './middleware/rate-limit';
import { setJwtVerifier, setUserLookup } from './middleware/auth';
import { verifyToken } from '@ai-operations/ops-auth';

const log = createLogger('ops-api');

// ── Wire up auth providers ──────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || process.env.OPS_API_KEY || 'ai-ops-dev-jwt-secret';

// JWT verifier — validates eyJ... tokens
setJwtVerifier((token: string) => {
  try {
    const payload = verifyToken(token, JWT_SECRET);
    return { sub: payload.sub, role: payload.role as string };
  } catch {
    return null;
  }
});

// Multi-user API key lookup — resolves aops_ keys from UserStore
setUserLookup(async (apiKey: string) => {
  const user = stores.users.getByApiKey(apiKey);
  if (!user) return null;
  return { id: user.id, role: user.role };
});

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
  ...gmailRoutes,
  ...shopifyRoutes,
  ...calendarRoutes,
  ...xTwitterRoutes,
  ...sparkRoutes,
  ...connectorRoutes,
  ...receiptRoutes,
  ...slackRoutes,
  ...notionRoutes,
  ...authRoutes,
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

// ── Rate Limiter ─────────────────────────────────────────────────────────────

const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: parseInt(process.env.OPS_RATE_LIMIT || '100', 10),
});

export { rateLimiter };

// ── Connection tracking ──────────────────────────────────────────────────────

/** Track active connections for graceful shutdown. */
const activeConnections = new Set<http.ServerResponse>();

/** Track active SSE connections for graceful shutdown. */
const sseConnections = new Set<http.ServerResponse>();

/** Register an SSE connection for tracking. Call from SSE route handlers. */
export function trackSSE(res: http.ServerResponse): void {
  sseConnections.add(res);
  res.on('close', () => sseConnections.delete(res));
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // Track active connection
  activeConnections.add(res);
  res.on('finish', () => activeConnections.delete(res));
  res.on('close', () => activeConnections.delete(res));

  // Run request logger middleware
  requestLogger(req, res, () => {});
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

  // Health check — skip rate limiting
  if (path === '/health' || path === '/api/health') {
    sendJson(res, 200, { status: 'ok', version: '0.1.0', uptime: process.uptime() });
    return;
  }

  // Readiness check — verifies DB connectivity
  if (path === '/api/readiness') {
    try {
      const result = stores.db.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      const dbOk = result?.ok === 1;
      const status = dbOk ? 'ready' : 'not_ready';
      const httpStatus = dbOk ? 200 : 503;
      sendJson(res, httpStatus, {
        status,
        components: {
          database: dbOk ? 'ok' : 'unavailable',
        },
      });
    } catch (err) {
      sendJson(res, 503, {
        status: 'not_ready',
        components: {
          database: 'error',
        },
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // Liveness check — process health
  if (path === '/api/liveness') {
    const mem = process.memoryUsage();
    sendJson(res, 200, {
      status: 'alive',
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
      },
      activeConnections: activeConnections.size,
      sseConnections: sseConnections.size,
    });
    return;
  }

  // Rate limiting — applied to all non-health routes
  const rateResult = rateLimiter.check(req);
  rateLimiter.setHeaders(res, rateResult);
  if (!rateResult.allowed) {
    sendJson(res, 429, { error: 'Too many requests. Please try again later.' });
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
      const correlationId = (req as any).correlationId as string | undefined;
      log.error(`Error in ${method} ${path}`, {
        error: err instanceof Error ? err.message : String(err),
      }, correlationId);
      sendError(res, 500, 'Internal server error');
    }
    return;
  }

  // Static file serving for dashboard (ops-web)
  if (method === 'GET') {
    const webDir = nodePath.resolve(__dirname, '../../ops-web/src');
    const filePath = path === '/' ? '/index.html' : path;
    const fullPath = nodePath.join(webDir, filePath);

    // Prevent directory traversal
    if (fullPath.startsWith(webDir) && fs.existsSync(fullPath)) {
      const ext = nodePath.extname(fullPath);
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const content = fs.readFileSync(fullPath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(content);
      return;
    }
  }

  // 404
  sendError(res, 404, `Not found: ${method} ${path}`);
});

server.listen(PORT, HOST, () => {
  log.info('Server started', {
    host: HOST,
    port: PORT,
    routes: routes.length,
  });
  console.log(`\n  AI Operations OS — API Server`);
  console.log(`  Listening on http://${HOST}:${PORT}`);
  console.log(`  Health:    http://localhost:${PORT}/health`);
  console.log(`  Readiness: http://localhost:${PORT}/api/readiness`);
  console.log(`  Liveness:  http://localhost:${PORT}/api/liveness`);
  console.log(`  Routes: ${routes.length} registered\n`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info('Shutdown initiated', { signal });

  // 1. Stop accepting new connections
  server.close(() => {
    log.info('HTTP server closed — no longer accepting connections');
  });

  // 2. Close all SSE connections
  log.info('Closing SSE connections', { count: sseConnections.size });
  for (const sseRes of sseConnections) {
    try {
      sseRes.end();
    } catch {
      // Already closed — ignore
    }
  }
  sseConnections.clear();

  // 3. Wait for in-flight requests to drain (up to 10 seconds)
  const drainTimeout = 10_000;
  const drainStart = Date.now();
  while (activeConnections.size > 0 && Date.now() - drainStart < drainTimeout) {
    log.info('Draining in-flight requests', { remaining: activeConnections.size });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (activeConnections.size > 0) {
    log.warn('Force-closing remaining connections', { remaining: activeConnections.size });
    for (const connRes of activeConnections) {
      try {
        connRes.end();
      } catch {
        // Already closed — ignore
      }
    }
    activeConnections.clear();
  }

  // 4. Close the SQLite database
  try {
    stores.db.close();
    log.info('Database closed');
  } catch (err) {
    log.error('Error closing database', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.info('Shutdown complete', { signal });
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export { server };
