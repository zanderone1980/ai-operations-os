/**
 * Auth Guard — Central authentication enforcement.
 *
 * Determines which routes require authentication and which
 * require elevated roles (admin or operator).
 */

/** Routes that don't require authentication. */
const AUTH_EXEMPT_PATHS = new Set([
  '/api/auth/register',
  '/api/auth/login',
]);

/** Check if a path is exempt from authentication. */
export function isAuthExempt(path: string): boolean {
  if (AUTH_EXEMPT_PATHS.has(path)) return true;
  // Webhooks are called by external services
  if (path.startsWith('/api/webhooks/')) return true;
  // OAuth callbacks are part of the auth flow
  if (path === '/api/oauth/google/callback') return true;
  return false;
}

/** Check if a route requires elevated roles (admin or operator). */
export function requiresElevatedRole(method: string, path: string): boolean {
  if (method === 'DELETE') return true;
  if (method === 'POST' && /^\/api\/approvals\/[^/]+\/decide$/.test(path)) return true;
  return false;
}

/** Maximum request body size (1 MB). */
export const MAX_BODY_SIZE = 1_048_576;
