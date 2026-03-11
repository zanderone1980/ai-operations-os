/**
 * JWT — Hand-rolled JSON Web Token implementation.
 *
 * Uses Node.js built-in `crypto.createHmac('sha256', secret)` for signing.
 * Zero external dependencies.
 *
 * Token format: header.payload.signature (base64url encoded)
 */

import * as crypto from 'node:crypto';

// ── Helpers ────────────────────────────────────────────────────────────────

function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return buf.toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface JwtPayload {
  /** Subject — typically user ID */
  sub: string;
  /** Email (optional) */
  email?: string;
  /** Role (optional) */
  role?: string;
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Expiration (Unix timestamp) */
  exp: number;
  /** Additional claims */
  [key: string]: unknown;
}

export interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

// ── Sign / Verify ──────────────────────────────────────────────────────────

/**
 * Create a signed JWT token.
 *
 * @param payload - Claims to include in the token
 * @param secret  - HMAC signing secret
 * @param expiresInSec - Token lifetime in seconds (default: 24 hours)
 * @returns Signed JWT string (header.payload.signature)
 */
export function signToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'> & { sub: string },
  secret: string,
  expiresInSec: number = 86_400,
): string {
  const now = Math.floor(Date.now() / 1000);

  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSec,
  } as JwtPayload;

  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(fullPayload));

  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Verify a JWT token and return the decoded payload.
 *
 * @param token  - JWT string to verify
 * @param secret - HMAC signing secret
 * @returns Decoded payload
 * @throws Error if token is invalid, expired, or signature doesn't match
 */
export function verifyToken(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts');
  }

  const [headerEncoded, payloadEncoded, signatureProvided] = parts;

  // Verify signature
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  if (!crypto.timingSafeEqual(
    Buffer.from(signatureProvided, 'base64url'),
    Buffer.from(expectedSignature, 'base64url'),
  )) {
    throw new Error('Invalid JWT: signature mismatch');
  }

  // Decode header
  const header = JSON.parse(base64urlDecode(headerEncoded)) as JwtHeader;
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('Invalid JWT: unsupported algorithm or type');
  }

  // Decode payload
  const payload = JSON.parse(base64urlDecode(payloadEncoded)) as JwtPayload;

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Invalid JWT: token expired');
  }

  return payload;
}

/**
 * Decode a JWT without verifying. Useful for reading claims.
 * WARNING: Do not trust the contents — always verify before acting on claims.
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(base64urlDecode(parts[1])) as JwtPayload;
  } catch {
    return null;
  }
}
