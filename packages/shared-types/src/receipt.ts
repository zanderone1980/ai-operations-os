/**
 * ActionReceipt — Cryptographically signed proof of execution.
 *
 * Every action that executes gets a receipt. Receipts are hash-chained
 * for tamper detection. Auditors can verify the chain independently.
 */

import * as crypto from 'crypto';

export interface ActionReceipt {
  /** Receipt identifier (UUID v4) */
  id: string;

  /** The action this receipt covers */
  actionId: string;

  /** Policy version that was active during evaluation */
  policyVersion: string;

  /** CORD decision for this action */
  cordDecision: string;

  /** CORD risk score (0-99) */
  cordScore: number;

  /** CORD risk reasons */
  cordReasons: string[];

  /** Sanitized input (secrets redacted) */
  input: Record<string, unknown>;

  /** Output summary */
  output?: Record<string, unknown>;

  /** When this receipt was created (ISO 8601) */
  timestamp: string;

  /** SHA-256 hash of receipt content */
  hash: string;

  /** HMAC-SHA256 signature */
  signature: string;

  /** Hash of previous receipt in chain */
  prevHash: string;
}

/** Genesis hash for the first receipt in a chain */
export const GENESIS_HASH = 'genesis';

/**
 * Compute the content hash for a receipt (excludes hash and signature fields).
 */
export function computeReceiptHash(receipt: Omit<ActionReceipt, 'hash' | 'signature'>): string {
  const payload = JSON.stringify({
    id: receipt.id,
    actionId: receipt.actionId,
    policyVersion: receipt.policyVersion,
    cordDecision: receipt.cordDecision,
    cordScore: receipt.cordScore,
    cordReasons: receipt.cordReasons,
    input: receipt.input,
    output: receipt.output,
    timestamp: receipt.timestamp,
    prevHash: receipt.prevHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Sign a receipt hash with an HMAC key.
 */
export function signReceipt(hash: string, key: string): string {
  return crypto.createHmac('sha256', key).update(hash).digest('hex');
}

/**
 * Verify a receipt's signature.
 */
export function verifyReceipt(receipt: ActionReceipt, key: string): boolean {
  const expectedHash = computeReceiptHash(receipt);
  if (expectedHash !== receipt.hash) return false;
  const expectedSig = signReceipt(receipt.hash, key);
  return expectedSig === receipt.signature;
}

/**
 * Verify an entire receipt chain.
 */
export function verifyReceiptChain(
  receipts: ActionReceipt[],
  key: string,
): { valid: boolean; brokenAt?: number; reason?: string } {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    if (r.prevHash !== prevHash) {
      return { valid: false, brokenAt: i, reason: `Chain break at index ${i}: expected prevHash ${prevHash}, got ${r.prevHash}` };
    }
    if (!verifyReceipt(r, key)) {
      return { valid: false, brokenAt: i, reason: `Invalid signature at index ${i}` };
    }
    prevHash = r.hash;
  }
  return { valid: true };
}
