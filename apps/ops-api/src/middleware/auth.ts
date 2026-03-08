/**
 * Auth Middleware — Session/token authentication.
 *
 * For MVP: simple bearer token auth. Production: JWT or OAuth.
 */

import type * as http from 'http';

const AUTH_TOKEN = process.env.OPS_AUTH_TOKEN || '';

export interface AuthContext {
  authenticated: boolean;
  userId?: string;
}

/**
 * Validate authorization header.
 * If OPS_AUTH_TOKEN is not set, all requests are allowed (dev mode).
 */
export function authenticate(req: http.IncomingMessage): AuthContext {
  // Dev mode — no auth required
  if (!AUTH_TOKEN) {
    return { authenticated: true, userId: 'dev-user' };
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return { authenticated: false };
  }

  const token = header.slice(7);
  if (token === AUTH_TOKEN) {
    return { authenticated: true, userId: 'authenticated-user' };
  }

  return { authenticated: false };
}

/**
 * Check if a request is authenticated. Returns false if auth fails.
 */
export function requireAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const auth = authenticate(req);
  if (!auth.authenticated) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}
