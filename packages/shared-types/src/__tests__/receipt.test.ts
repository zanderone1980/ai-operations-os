import {
  computeReceiptHash,
  signReceipt,
  verifyReceipt,
  verifyReceiptChain,
  GENESIS_HASH,
} from '../receipt';
import type { ActionReceipt } from '../receipt';

const HMAC_KEY = 'test-secret-key-2024';

function makeReceiptData(overrides: Partial<Omit<ActionReceipt, 'hash' | 'signature'>> = {}) {
  return {
    id: 'receipt-1',
    actionId: 'action-1',
    policyVersion: '1.0.0',
    cordDecision: 'ALLOW',
    cordScore: 10,
    cordReasons: ['Low risk operation'],
    input: { to: 'user@example.com' },
    output: { messageId: 'msg-123' },
    timestamp: '2025-01-15T10:00:00.000Z',
    prevHash: GENESIS_HASH,
    ...overrides,
  };
}

function makeSignedReceipt(overrides: Partial<Omit<ActionReceipt, 'hash' | 'signature'>> = {}): ActionReceipt {
  const data = makeReceiptData(overrides);
  const hash = computeReceiptHash(data);
  const signature = signReceipt(hash, HMAC_KEY);
  return { ...data, hash, signature };
}

describe('computeReceiptHash', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = computeReceiptHash(makeReceiptData());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same hash for identical input', () => {
    const data = makeReceiptData();
    const hash1 = computeReceiptHash(data);
    const hash2 = computeReceiptHash(data);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = computeReceiptHash(makeReceiptData({ cordScore: 10 }));
    const hash2 = computeReceiptHash(makeReceiptData({ cordScore: 50 }));
    expect(hash1).not.toBe(hash2);
  });

  it('changes hash when actionId differs', () => {
    const h1 = computeReceiptHash(makeReceiptData({ actionId: 'a' }));
    const h2 = computeReceiptHash(makeReceiptData({ actionId: 'b' }));
    expect(h1).not.toBe(h2);
  });

  it('changes hash when cordReasons differ', () => {
    const h1 = computeReceiptHash(makeReceiptData({ cordReasons: ['reason A'] }));
    const h2 = computeReceiptHash(makeReceiptData({ cordReasons: ['reason B'] }));
    expect(h1).not.toBe(h2);
  });
});

describe('signReceipt', () => {
  it('returns a 64-character hex string (HMAC-SHA256)', () => {
    const hash = computeReceiptHash(makeReceiptData());
    const sig = signReceipt(hash, HMAC_KEY);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same signature for the same hash and key', () => {
    const hash = computeReceiptHash(makeReceiptData());
    const sig1 = signReceipt(hash, HMAC_KEY);
    const sig2 = signReceipt(hash, HMAC_KEY);
    expect(sig1).toBe(sig2);
  });

  it('produces different signatures for different keys', () => {
    const hash = computeReceiptHash(makeReceiptData());
    const sig1 = signReceipt(hash, 'key-a');
    const sig2 = signReceipt(hash, 'key-b');
    expect(sig1).not.toBe(sig2);
  });
});

describe('verifyReceipt', () => {
  it('returns true for a correctly signed receipt', () => {
    const receipt = makeSignedReceipt();
    expect(verifyReceipt(receipt, HMAC_KEY)).toBe(true);
  });

  it('returns false when the hash has been tampered with', () => {
    const receipt = makeSignedReceipt();
    receipt.hash = 'tampered' + receipt.hash.slice(8);
    expect(verifyReceipt(receipt, HMAC_KEY)).toBe(false);
  });

  it('returns false when the signature has been tampered with', () => {
    const receipt = makeSignedReceipt();
    receipt.signature = 'bad' + receipt.signature.slice(3);
    expect(verifyReceipt(receipt, HMAC_KEY)).toBe(false);
  });

  it('returns false when verified with wrong key', () => {
    const receipt = makeSignedReceipt();
    expect(verifyReceipt(receipt, 'wrong-key')).toBe(false);
  });

  it('returns false when receipt content has been modified', () => {
    const receipt = makeSignedReceipt();
    receipt.cordScore = 99; // tamper with content
    expect(verifyReceipt(receipt, HMAC_KEY)).toBe(false);
  });
});

describe('verifyReceiptChain', () => {
  it('returns valid for an empty chain', () => {
    const result = verifyReceiptChain([], HMAC_KEY);
    expect(result.valid).toBe(true);
  });

  it('returns valid for a single correctly chained receipt', () => {
    const r1 = makeSignedReceipt({ prevHash: GENESIS_HASH });
    const result = verifyReceiptChain([r1], HMAC_KEY);
    expect(result.valid).toBe(true);
  });

  it('returns valid for a properly chained series of receipts', () => {
    const r1 = makeSignedReceipt({ id: 'r-1', prevHash: GENESIS_HASH });
    const r2 = makeSignedReceipt({ id: 'r-2', actionId: 'action-2', prevHash: r1.hash });
    const r3 = makeSignedReceipt({ id: 'r-3', actionId: 'action-3', prevHash: r2.hash });

    const result = verifyReceiptChain([r1, r2, r3], HMAC_KEY);
    expect(result.valid).toBe(true);
  });

  it('detects a broken chain link', () => {
    const r1 = makeSignedReceipt({ id: 'r-1', prevHash: GENESIS_HASH });
    const r2 = makeSignedReceipt({ id: 'r-2', actionId: 'action-2', prevHash: 'wrong-hash' });

    const result = verifyReceiptChain([r1, r2], HMAC_KEY);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toContain('Chain break');
  });

  it('detects a tampered receipt in the middle of the chain', () => {
    const r1 = makeSignedReceipt({ id: 'r-1', prevHash: GENESIS_HASH });
    const r2 = makeSignedReceipt({ id: 'r-2', actionId: 'action-2', prevHash: r1.hash });
    const r3 = makeSignedReceipt({ id: 'r-3', actionId: 'action-3', prevHash: r2.hash });

    // Tamper with r2's content after signing
    r2.cordScore = 99;

    const result = verifyReceiptChain([r1, r2, r3], HMAC_KEY);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toContain('Invalid signature');
  });

  it('returns invalid for wrong HMAC key', () => {
    const r1 = makeSignedReceipt({ prevHash: GENESIS_HASH });
    const result = verifyReceiptChain([r1], 'wrong-key');
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });
});

describe('GENESIS_HASH', () => {
  it('is the string "genesis"', () => {
    expect(GENESIS_HASH).toBe('genesis');
  });
});
