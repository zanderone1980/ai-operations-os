/**
 * Password — Secure password hashing with scrypt.
 *
 * Uses Node.js built-in `crypto.scryptSync` for key derivation.
 * Store format: `salt:derivedKey` (both hex-encoded).
 * Zero external dependencies.
 */

import * as crypto from 'node:crypto';

/** Length of the derived key in bytes. */
const KEY_LENGTH = 64;

/** Length of the random salt in bytes. */
const SALT_LENGTH = 16;

/** scrypt cost parameters — tuned for security while keeping hashing under 100ms. */
const SCRYPT_OPTIONS: crypto.ScryptOptions = {
  N: 16384,      // CPU/memory cost
  r: 8,          // Block size
  p: 1,          // Parallelization
  maxmem: 128 * 16384 * 8 * 2, // 32 MiB
};

/**
 * Hash a password using scrypt.
 *
 * @param password - Plaintext password
 * @returns Hash string in `salt:derivedKey` format (hex-encoded)
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

/**
 * Verify a password against a stored hash.
 *
 * @param password - Plaintext password to verify
 * @param hash     - Stored hash in `salt:derivedKey` format
 * @returns true if password matches
 */
export function verifyPassword(password: string, hash: string): boolean {
  const [saltHex, keyHex] = hash.split(':');
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);

  return crypto.timingSafeEqual(derivedKey, storedKey);
}
