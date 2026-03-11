/**
 * Auth Routes — User registration, login, and credential vault.
 *
 * POST  /api/auth/register              Register a new user (email + password)
 * POST  /api/auth/login                 Login and receive JWT + API key
 * GET   /api/auth/me                    Get current user profile (requires auth)
 * POST  /api/auth/credentials           Store an encrypted connector credential
 * GET   /api/auth/credentials/:connector  List credentials for a connector
 * DELETE /api/auth/credentials/:id       Delete a stored credential
 */

import { signToken, hashPassword, verifyPassword, encrypt, getVaultKey } from '@ai-operations/ops-auth';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';
import { stores } from '../storage';
import { authenticate } from '../middleware/auth';
import { createLogger } from '@ai-operations/ops-core';
import type * as http from 'http';

const log = createLogger('auth');

const JWT_SECRET = process.env.JWT_SECRET || process.env.OPS_API_KEY || 'ai-ops-dev-jwt-secret';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Extract auth context, requiring authentication. */
async function requireAuth(req: http.IncomingMessage, res: http.ServerResponse): Promise<string | null> {
  const auth = await authenticate(req);
  if (!auth.authenticated || !auth.userId) {
    sendError(res, 401, 'Authentication required');
    return null;
  }
  return auth.userId;
}

// ── Route Handlers ──────────────────────────────────────────────────────────

/**
 * POST /api/auth/register — Create a new user account.
 *
 * Body: { email, password, name? }
 * Returns: { user, token, apiKey }
 */
async function registerUser(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const email = body.email as string;
  const password = body.password as string;
  const name = (body.name as string) || email.split('@')[0];

  if (!email || !password) {
    sendError(res, 400, 'Missing required fields: email, password');
    return;
  }

  if (password.length < 6) {
    sendError(res, 400, 'Password must be at least 6 characters');
    return;
  }

  // Check if email already exists
  const existing = stores.users.getByEmail(email);
  if (existing) {
    stores.audit.log('auth.register', {
      details: { email, reason: 'email_already_registered' },
    });
    sendError(res, 409, 'Email already registered');
    return;
  }

  // Hash password and create user
  const passwordHash = hashPassword(password);
  const user = stores.users.create({
    email,
    name,
    passwordHash,
    role: 'operator',
  });

  // Generate JWT
  const token = signToken(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    86_400, // 24 hours
  );

  stores.audit.log('auth.register', {
    actorId: user.id,
    resourceType: 'user',
    resourceId: user.id,
    details: { email: user.email },
  });

  log.info('User registered', { userId: user.id, email: user.email });

  sendJson(res, 201, {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
    token,
    apiKey: user.apiKey,
  });
}

/**
 * POST /api/auth/login — Authenticate with email + password.
 *
 * Body: { email, password }
 * Returns: { user, token, apiKey }
 */
async function loginUser(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const email = body.email as string;
  const password = body.password as string;

  if (!email || !password) {
    sendError(res, 400, 'Missing required fields: email, password');
    return;
  }

  const user = stores.users.getByEmail(email);
  if (!user || !user.passwordHash) {
    stores.audit.log('auth.login_failed', {
      details: { email, reason: 'user_not_found' },
    });
    sendError(res, 401, 'Invalid email or password');
    return;
  }

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) {
    stores.audit.log('auth.login_failed', {
      actorId: user.id,
      details: { email, reason: 'invalid_password' },
    });
    sendError(res, 401, 'Invalid email or password');
    return;
  }

  // Update last login
  stores.users.recordLogin(user.id);

  // Generate JWT
  const token = signToken(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    86_400,
  );

  stores.audit.log('auth.login', {
    actorId: user.id,
    resourceType: 'user',
    resourceId: user.id,
    details: { email: user.email },
  });

  log.info('User logged in', { userId: user.id, email: user.email });

  sendJson(res, 200, {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
    token,
    apiKey: user.apiKey,
  });
}

/**
 * GET /api/auth/me — Get current user profile.
 *
 * Requires authentication (Bearer token — JWT or API key).
 */
async function getCurrentUser(ctx: any): Promise<void> {
  const { req, res } = ctx;

  const userId = await requireAuth(req, res);
  if (!userId) return;

  const user = stores.users.get(userId);
  if (!user) {
    sendError(res, 404, 'User not found');
    return;
  }

  sendJson(res, 200, {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  });
}

/**
 * POST /api/auth/credentials — Store an encrypted connector credential.
 *
 * Body: { connector, key, value }
 *
 * The `value` is encrypted with the vault key before storage.
 * Requires VAULT_KEY env var to be set.
 */
async function storeCredential(ctx: any): Promise<void> {
  const { req, res, body } = ctx;

  const userId = await requireAuth(req, res);
  if (!userId) return;

  const connector = body.connector as string;
  const key = body.key as string;
  const value = body.value as string;

  if (!connector || !key || !value) {
    sendError(res, 400, 'Missing required fields: connector, key, value');
    return;
  }

  const vaultKey = getVaultKey();
  if (!vaultKey) {
    sendError(res, 503, 'Vault not configured. Set VAULT_KEY env var.');
    return;
  }

  const encryptedValue = encrypt(value, vaultKey);
  const credential = stores.credentials.save(connector, key, encryptedValue, userId);

  stores.audit.log('credential.created', {
    actorId: userId,
    resourceType: 'credential',
    resourceId: credential.id,
    details: { connector, key },
  });

  sendJson(res, 201, {
    id: credential.id,
    connector: credential.connector,
    key: credential.key,
    createdAt: credential.createdAt,
    // Never return the encrypted or decrypted value
  });
}

/**
 * GET /api/auth/credentials/:connector — List credentials for a connector.
 *
 * Returns metadata only (never the encrypted values).
 */
async function getCredentials(ctx: any): Promise<void> {
  const { req, res, params } = ctx;

  const userId = await requireAuth(req, res);
  if (!userId) return;

  const credentials = stores.credentials.getForConnector(params.connector, userId);

  sendJson(res, 200, {
    credentials: credentials.map((c) => ({
      id: c.id,
      connector: c.connector,
      key: c.key,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}

/**
 * DELETE /api/auth/credentials/:id — Delete a stored credential.
 */
async function deleteCredential(ctx: any): Promise<void> {
  const { req, res, params } = ctx;

  const userId = await requireAuth(req, res);
  if (!userId) return;

  const deleted = stores.credentials.delete(params.id);
  if (!deleted) {
    sendError(res, 404, `Credential not found: ${params.id}`);
    return;
  }

  stores.audit.log('credential.deleted', {
    actorId: userId,
    resourceType: 'credential',
    resourceId: params.id,
  });

  sendJson(res, 200, { deleted: true });
}

// ── Export routes ────────────────────────────────────────────────────────────

export const authRoutes: Route[] = [
  pathToRoute('POST', '/api/auth/register', registerUser),
  pathToRoute('POST', '/api/auth/login', loginUser),
  pathToRoute('GET', '/api/auth/me', getCurrentUser),
  pathToRoute('POST', '/api/auth/credentials', storeCredential),
  pathToRoute('GET', '/api/auth/credentials/:connector', getCredentials),
  pathToRoute('DELETE', '/api/auth/credentials/:id', deleteCredential),
];
