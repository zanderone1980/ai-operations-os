/**
 * ops-auth — Unit Tests
 *
 * Tests JWT sign/verify, password hash/verify, and vault encrypt/decrypt.
 */

import { signToken, verifyToken, decodeToken } from '../jwt';
import { hashPassword, verifyPassword } from '../password';
import { encrypt, decrypt } from '../vault';

// ── JWT ────────────────────────────────────────────────────────────────────

describe('JWT', () => {
  const secret = 'test-secret-key-for-jwt';

  test('signToken creates a valid 3-part token', () => {
    const token = signToken({ sub: 'user-1', email: 'test@test.com' }, secret);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  test('verifyToken returns the payload for a valid token', () => {
    const token = signToken({ sub: 'user-1', email: 'test@test.com', role: 'admin' }, secret);
    const payload = verifyToken(token, secret);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('test@test.com');
    expect(payload.role).toBe('admin');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  test('verifyToken throws on wrong secret', () => {
    const token = signToken({ sub: 'user-1' }, secret);
    expect(() => verifyToken(token, 'wrong-secret')).toThrow('signature mismatch');
  });

  test('verifyToken throws on expired token', () => {
    const token = signToken({ sub: 'user-1' }, secret, -1); // Already expired
    expect(() => verifyToken(token, secret)).toThrow('token expired');
  });

  test('verifyToken throws on malformed token', () => {
    expect(() => verifyToken('not.a.valid.jwt', secret)).toThrow('expected 3 parts');
    expect(() => verifyToken('invalid', secret)).toThrow('expected 3 parts');
  });

  test('verifyToken throws on tampered payload', () => {
    const token = signToken({ sub: 'user-1' }, secret);
    const parts = token.split('.');
    // Tamper with the payload
    const tampered = `${parts[0]}.${Buffer.from('{"sub":"hacker","iat":0,"exp":99999999999}').toString('base64url')}.${parts[2]}`;
    expect(() => verifyToken(tampered, secret)).toThrow('signature mismatch');
  });

  test('signToken uses custom expiration', () => {
    const token = signToken({ sub: 'user-1' }, secret, 3600); // 1 hour
    const payload = verifyToken(token, secret);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  test('decodeToken returns payload without verification', () => {
    const token = signToken({ sub: 'user-1', email: 'a@b.com' }, secret);
    const payload = decodeToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('user-1');
  });

  test('decodeToken returns null for invalid input', () => {
    expect(decodeToken('invalid')).toBeNull();
    expect(decodeToken('')).toBeNull();
  });
});

// ── Password ───────────────────────────────────────────────────────────────

describe('Password', () => {
  test('hashPassword returns salt:key format', () => {
    const hash = hashPassword('test-password');
    const parts = hash.split(':');
    expect(parts).toHaveLength(2);
    // Salt is 16 bytes = 32 hex chars
    expect(parts[0]).toHaveLength(32);
    // Key is 64 bytes = 128 hex chars
    expect(parts[1]).toHaveLength(128);
  });

  test('verifyPassword returns true for correct password', () => {
    const hash = hashPassword('correct-password');
    expect(verifyPassword('correct-password', hash)).toBe(true);
  });

  test('verifyPassword returns false for wrong password', () => {
    const hash = hashPassword('correct-password');
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  test('hashPassword produces unique hashes (different salts)', () => {
    const hash1 = hashPassword('same-password');
    const hash2 = hashPassword('same-password');
    expect(hash1).not.toBe(hash2); // Different salts
    // But both verify correctly
    expect(verifyPassword('same-password', hash1)).toBe(true);
    expect(verifyPassword('same-password', hash2)).toBe(true);
  });

  test('verifyPassword returns false for malformed hash', () => {
    expect(verifyPassword('password', 'not-a-valid-hash')).toBe(false);
    expect(verifyPassword('password', '')).toBe(false);
  });
});

// ── Vault ──────────────────────────────────────────────────────────────────

describe('Vault', () => {
  const masterKey = 'test-vault-master-key-2024';

  test('encrypt returns iv:authTag:ciphertext format', () => {
    const encrypted = encrypt('secret-api-key', masterKey);
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    // IV is 16 bytes = 32 hex chars
    expect(parts[0]).toHaveLength(32);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext is non-empty
    expect(parts[2].length).toBeGreaterThan(0);
  });

  test('decrypt recovers the original plaintext', () => {
    const plaintext = 'xoxb-slack-bot-token-12345';
    const encrypted = encrypt(plaintext, masterKey);
    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  test('decrypt with wrong key throws', () => {
    const encrypted = encrypt('secret', masterKey);
    expect(() => decrypt(encrypted, 'wrong-key')).toThrow();
  });

  test('encrypt produces unique ciphertexts (different IVs)', () => {
    const enc1 = encrypt('same-value', masterKey);
    const enc2 = encrypt('same-value', masterKey);
    expect(enc1).not.toBe(enc2); // Different IVs
    // But both decrypt to the same value
    expect(decrypt(enc1, masterKey)).toBe('same-value');
    expect(decrypt(enc2, masterKey)).toBe('same-value');
  });

  test('decrypt throws on tampered ciphertext', () => {
    const encrypted = encrypt('secret', masterKey);
    const parts = encrypted.split(':');
    // Tamper with ciphertext
    const tampered = `${parts[0]}:${parts[1]}:ff${parts[2].slice(2)}`;
    expect(() => decrypt(tampered, masterKey)).toThrow();
  });

  test('decrypt throws on invalid format', () => {
    expect(() => decrypt('not-valid', masterKey)).toThrow('invalid encrypted format');
  });

  test('encrypt throws without master key', () => {
    expect(() => encrypt('secret', '')).toThrow('master key is required');
  });

  test('decrypt throws without master key', () => {
    expect(() => decrypt('aa:bb:cc', '')).toThrow('master key is required');
  });

  test('handles unicode and special characters', () => {
    const special = '🔑 API Key: sk-test_123!@#$%^&*()';
    const encrypted = encrypt(special, masterKey);
    expect(decrypt(encrypted, masterKey)).toBe(special);
  });

  test('handles empty string', () => {
    const encrypted = encrypt('', masterKey);
    expect(decrypt(encrypted, masterKey)).toBe('');
  });

  test('handles long values', () => {
    const long = 'a'.repeat(10_000);
    const encrypted = encrypt(long, masterKey);
    expect(decrypt(encrypted, masterKey)).toBe(long);
  });
});
