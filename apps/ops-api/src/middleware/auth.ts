/**
 * Auth Middleware — Multi-mode authentication.
 *
 * Four modes (checked in order):
 *   1. Dev mode    — OPS_API_KEY not set → all requests allowed
 *   2. JWT token   — eyJ... prefixed → verify JWT signature
 *   3. Multi-user  — aops_ prefixed keys → lookup via UserStore
 *   4. Single-user — OPS_API_KEY set → simple bearer token
 */

import type * as http from 'http';

type UserRole = 'admin' | 'operator' | 'viewer';

const SINGLE_USER_KEY = process.env.OPS_API_KEY || '';

export interface AuthContext {
  authenticated: boolean;
  userId?: string;
  role?: UserRole;
}

// Dependency injection for multi-user lookup
let userLookup: ((apiKey: string) => Promise<{ id: string; role: UserRole } | null>) | null = null;

// Dependency injection for JWT verification
let jwtVerifier: ((token: string) => { sub: string; role?: string } | null) | null = null;

export function setUserLookup(
  fn: (apiKey: string) => Promise<{ id: string; role: UserRole } | null>,
): void {
  userLookup = fn;
}

export function setJwtVerifier(
  fn: (token: string) => { sub: string; role?: string } | null,
): void {
  jwtVerifier = fn;
}

/**
 * Validate authorization header.
 */
export async function authenticate(req: http.IncomingMessage): Promise<AuthContext> {
  // Dev mode — no auth required
  if (!SINGLE_USER_KEY && !userLookup && !jwtVerifier) {
    return { authenticated: true, userId: 'dev-user', role: 'admin' };
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return { authenticated: false };
  }

  const token = header.slice(7);

  // JWT: eyJ... prefixed tokens (base64url-encoded JSON header)
  if (token.startsWith('eyJ') && jwtVerifier) {
    const payload = jwtVerifier(token);
    if (payload) {
      return {
        authenticated: true,
        userId: payload.sub,
        role: (payload.role as UserRole) || 'operator',
      };
    }
    return { authenticated: false };
  }

  // Multi-user: aops_ prefixed keys
  if (token.startsWith('aops_') && userLookup) {
    const user = await userLookup(token);
    if (user) {
      return { authenticated: true, userId: user.id, role: user.role };
    }
    return { authenticated: false };
  }

  // Single-user: match OPS_API_KEY
  if (SINGLE_USER_KEY && token === SINGLE_USER_KEY) {
    return { authenticated: true, userId: 'authenticated-user', role: 'admin' };
  }

  return { authenticated: false };
}

/**
 * Check if a request is authenticated. Returns false if auth fails.
 */
export async function requireAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const auth = await authenticate(req);
  if (!auth.authenticated) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  // Attach auth context to request for downstream use
  (req as any).auth = auth;
  return true;
}

/**
 * Role-based access control middleware.
 * Returns a function that checks if the authenticated user has the required role.
 */
export function requireRole(...allowed: UserRole[]) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    const ok = await requireAuth(req, res);
    if (!ok) return false;

    const auth: AuthContext = (req as any).auth;
    if (!auth.role || !allowed.includes(auth.role)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden — insufficient role' }));
      return false;
    }
    return true;
  };
}
