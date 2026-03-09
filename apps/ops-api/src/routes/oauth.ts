/**
 * OAuth Routes — Google OAuth2 flow for Gmail & Calendar.
 *
 * GET  /api/oauth/google/url     Get the authorization URL to redirect user
 * GET  /api/oauth/google/callback  Handle the OAuth callback with auth code
 * GET  /api/oauth/status           Check which connectors are authenticated
 * POST /api/oauth/google/refresh   Refresh an expired access token
 *
 * Credentials are stored in ~/.ai-ops/credentials.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';

// ── Config ───────────────────────────────────────────────────────────────────

const CREDENTIALS_PATH = path.join(os.homedir(), '.ai-ops', 'credentials.json');
const CONFIG_DIR = path.join(os.homedir(), '.ai-ops');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

interface StoredCredentials {
  google?: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string;
  };
  x?: {
    bearerToken: string;
    userId?: string;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadCredentials(): StoredCredentials {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveCredentials(creds: StoredCredentials): void {
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
  fs.chmodSync(CREDENTIALS_PATH, 0o600); // Owner read/write only
}

/**
 * Get the currently valid Google access token, refreshing if expired.
 */
export async function getGoogleAccessToken(): Promise<string | null> {
  const creds = loadCredentials();
  if (!creds.google) return null;

  // Check if token is expired (with 5 min buffer)
  if (creds.google.expiresAt && Date.now() > creds.google.expiresAt - 300_000) {
    // Try to refresh
    if (creds.google.refreshToken && creds.google.clientId && creds.google.clientSecret) {
      const refreshed = await refreshGoogleToken(creds.google);
      if (refreshed) {
        creds.google.accessToken = refreshed.accessToken;
        creds.google.expiresAt = refreshed.expiresAt;
        saveCredentials(creds);
        return refreshed.accessToken;
      }
    }
    return null;
  }

  return creds.google.accessToken;
}

async function refreshGoogleToken(google: NonNullable<StoredCredentials['google']>): Promise<{ accessToken: string; expiresAt: number } | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: google.clientId,
        client_secret: google.clientSecret,
        refresh_token: google.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as any;
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
  } catch {
    return null;
  }
}

/**
 * Get X/Twitter bearer token.
 */
export function getXBearerToken(): string | null {
  const creds = loadCredentials();
  return creds.x?.bearerToken || null;
}

// ── Route Handlers ───────────────────────────────────────────────────────────

/** Get Google OAuth2 authorization URL */
async function getGoogleAuthUrl(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const clientId = query.client_id || process.env.GOOGLE_CLIENT_ID;
  const redirectUri = query.redirect_uri || `http://localhost:3100/api/oauth/google/callback`;

  if (!clientId) {
    sendError(res, 400, 'Missing client_id. Set GOOGLE_CLIENT_ID env var or pass ?client_id=...');
    return;
  }

  // Store client_id temporarily for the callback
  const state = crypto.randomBytes(16).toString('hex');
  const creds = loadCredentials();
  (creds as any)._pendingOauth = { clientId, clientSecret: query.client_secret || process.env.GOOGLE_CLIENT_SECRET || '', redirectUri, state };
  saveCredentials(creds);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params}`;

  sendJson(res, 200, {
    url: authUrl,
    instructions: 'Open this URL in your browser to authorize Gmail & Calendar access.',
  });
}

/** Handle Google OAuth2 callback */
async function handleGoogleCallback(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const code = query.code;
  const state = query.state;

  if (!code) {
    sendError(res, 400, 'Missing authorization code');
    return;
  }

  const creds = loadCredentials();
  const pending = (creds as any)._pendingOauth;
  if (!pending) {
    sendError(res, 400, 'No pending OAuth flow. Start with GET /api/oauth/google/url first.');
    return;
  }

  if (state && pending.state && state !== pending.state) {
    sendError(res, 400, 'State mismatch — possible CSRF attack');
    return;
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: pending.clientId,
        client_secret: pending.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: pending.redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json() as any;
      sendError(res, 400, `Token exchange failed: ${err.error_description || err.error || 'unknown'}`);
      return;
    }

    const tokens = await tokenRes.json() as any;

    // Save credentials
    creds.google = {
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || '',
      expiresAt: Date.now() + (tokens.expires_in * 1000),
      scopes: tokens.scope || GOOGLE_SCOPES,
    };
    delete (creds as any)._pendingOauth;
    saveCredentials(creds);

    // Return success page
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>AI Ops — Connected</title></head>
      <body style="background:#0a0a0f;color:#e0e0e8;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;">
        <div style="text-align:center;">
          <h1 style="color:#34d399;">Connected!</h1>
          <p>Gmail & Calendar are now connected to AI Operations OS.</p>
          <p>You can close this window.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    sendError(res, 500, `Token exchange error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Check authentication status for all connectors */
async function getOAuthStatus(ctx: any): Promise<void> {
  const { res } = ctx;
  const creds = loadCredentials();

  const status: Record<string, { connected: boolean; expiresAt?: string; scopes?: string }> = {
    google: {
      connected: !!creds.google?.accessToken,
      expiresAt: creds.google?.expiresAt ? new Date(creds.google.expiresAt).toISOString() : undefined,
      scopes: creds.google?.scopes,
    },
    x: {
      connected: !!creds.x?.bearerToken,
    },
  };

  sendJson(res, 200, { connectors: status });
}

/** Manually refresh Google access token */
async function handleRefreshToken(ctx: any): Promise<void> {
  const { res } = ctx;
  const creds = loadCredentials();

  if (!creds.google?.refreshToken) {
    sendError(res, 400, 'No refresh token available. Re-authorize with /api/oauth/google/url');
    return;
  }

  const refreshed = await refreshGoogleToken(creds.google);
  if (!refreshed) {
    sendError(res, 500, 'Token refresh failed. Re-authorize with /api/oauth/google/url');
    return;
  }

  creds.google.accessToken = refreshed.accessToken;
  creds.google.expiresAt = refreshed.expiresAt;
  saveCredentials(creds);

  sendJson(res, 200, {
    success: true,
    expiresAt: new Date(refreshed.expiresAt).toISOString(),
  });
}

/** Save X/Twitter bearer token */
async function saveXToken(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const bearerToken = body.bearerToken as string;
  const userId = body.userId as string | undefined;

  if (!bearerToken) {
    sendError(res, 400, 'Missing bearerToken');
    return;
  }

  const creds = loadCredentials();
  creds.x = { bearerToken, userId };
  saveCredentials(creds);

  sendJson(res, 200, { success: true });
}

// ── Export routes ────────────────────────────────────────────────────────────

export const oauthRoutes: Route[] = [
  pathToRoute('GET', '/api/oauth/google/url', getGoogleAuthUrl),
  pathToRoute('GET', '/api/oauth/google/callback', handleGoogleCallback),
  pathToRoute('GET', '/api/oauth/status', getOAuthStatus),
  pathToRoute('POST', '/api/oauth/google/refresh', handleRefreshToken),
  pathToRoute('POST', '/api/oauth/x/token', saveXToken),
];
