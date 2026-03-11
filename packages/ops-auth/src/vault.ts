/**
 * Vault — AES-256-GCM encrypted credential storage.
 *
 * Encrypts sensitive values (API keys, tokens, secrets) using
 * AES-256-GCM with a master key derived from `VAULT_KEY` env var.
 *
 * Store format: `iv:authTag:ciphertext` (all hex-encoded).
 * Zero external dependencies.
 */

import * as crypto from 'node:crypto';

/** AES-256 requires a 32-byte key. */
const KEY_LENGTH = 32;

/** Initialization vector length for GCM. */
const IV_LENGTH = 16;

/** GCM authentication tag length in bytes. */
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 32-byte encryption key from the master key using scrypt.
 * Uses a fixed salt (the key is already high-entropy; salt prevents
 * rainbow tables but the master key IS the entropy source here).
 */
function deriveKey(masterKey: string): Buffer {
  const salt = Buffer.from('ai-ops-vault-v1', 'utf-8');
  return crypto.scryptSync(masterKey, salt, KEY_LENGTH);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - Value to encrypt
 * @param masterKey - Master encryption key (e.g., from VAULT_KEY env var)
 * @returns Encrypted string in `iv:authTag:ciphertext` format (hex-encoded)
 */
export function encrypt(plaintext: string, masterKey: string): string {
  if (!masterKey) {
    throw new Error('Vault: master key is required for encryption');
  }

  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string using AES-256-GCM.
 *
 * @param encrypted - Encrypted value in `iv:authTag:ciphertext` format
 * @param masterKey - Master encryption key
 * @returns Decrypted plaintext string
 * @throws Error if the key is wrong, data is tampered, or format is invalid
 */
export function decrypt(encrypted: string, masterKey: string): string {
  if (!masterKey) {
    throw new Error('Vault: master key is required for decryption');
  }

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Vault: invalid encrypted format (expected iv:authTag:ciphertext)');
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  const key = deriveKey(masterKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');

  return decrypted;
}

/**
 * Get the vault master key from the environment.
 * Returns undefined if not set (vault operations will fail).
 */
export function getVaultKey(): string | undefined {
  return process.env.VAULT_KEY;
}
