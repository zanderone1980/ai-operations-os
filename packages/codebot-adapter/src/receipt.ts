/**
 * ReceiptBuilder — Builds hash-chained action receipts during execution.
 *
 * Tracks workflow steps as they execute and produces cryptographically
 * signed ActionReceipt objects linked in a hash chain. Uses the receipt
 * functions from @ai-ops/shared-types for hashing and signing.
 */

import type { ActionReceipt, CordDecision } from '@ai-ops/shared-types';
import {
  GENESIS_HASH,
  computeReceiptHash,
  signReceipt,
} from '@ai-ops/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data for a single step to be recorded in a receipt. */
export interface ReceiptStepData {
  /** The action identifier for this step. */
  actionId: string;

  /** Policy version active during this step. */
  policyVersion: string;

  /** CORD decision for this step. */
  cordDecision: CordDecision;

  /** CORD risk score (0-99). */
  cordScore: number;

  /** CORD risk reasons. */
  cordReasons: string[];

  /** Sanitized input data (secrets should be redacted before adding). */
  input: Record<string, unknown>;

  /** Output data from the step execution. */
  output?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ReceiptBuilder
// ---------------------------------------------------------------------------

/**
 * ReceiptBuilder accumulates step data during workflow execution and
 * produces a finalized chain of ActionReceipt objects. Each receipt
 * is hash-chained to the previous one for tamper detection.
 *
 * @example
 * ```ts
 * const builder = new ReceiptBuilder();
 *
 * builder.addStep({
 *   actionId: 'act-001',
 *   policyVersion: '1.0.0',
 *   cordDecision: 'ALLOW',
 *   cordScore: 12,
 *   cordReasons: ['Low risk read operation'],
 *   input: { query: 'inbox' },
 *   output: { count: 5 },
 * });
 *
 * builder.addStep({
 *   actionId: 'act-002',
 *   policyVersion: '1.0.0',
 *   cordDecision: 'CONTAIN',
 *   cordScore: 45,
 *   cordReasons: ['Medium risk send operation'],
 *   input: { to: 'user@example.com', subject: 'Hi' },
 * });
 *
 * const receipts = builder.finalize('my-signing-key');
 * console.log(receipts.length); // 2
 * ```
 */
export class ReceiptBuilder {
  /** Accumulated step data awaiting finalization. */
  private steps: ReceiptStepData[] = [];

  /**
   * Add a step to the receipt chain.
   *
   * Steps are recorded in order and will be linked via hash chain
   * when finalize() is called.
   *
   * @param step - The step data to record.
   */
  addStep(step: ReceiptStepData): void {
    this.steps.push(step);
  }

  /**
   * Finalize the receipt chain by computing hashes and signatures.
   *
   * Builds a hash-chained sequence of ActionReceipt objects from
   * all accumulated steps. The first receipt chains from GENESIS_HASH.
   * Each subsequent receipt chains from the previous receipt's hash.
   *
   * @param key - The HMAC signing key for receipt signatures.
   * @returns An array of signed, hash-chained ActionReceipt objects.
   */
  finalize(key: string): ActionReceipt[] {
    const receipts: ActionReceipt[] = [];
    let prevHash = GENESIS_HASH;

    for (const step of this.steps) {
      const partial = {
        id: crypto.randomUUID(),
        actionId: step.actionId,
        policyVersion: step.policyVersion,
        cordDecision: step.cordDecision,
        cordScore: step.cordScore,
        cordReasons: step.cordReasons,
        input: step.input,
        output: step.output,
        timestamp: new Date().toISOString(),
        prevHash,
      };

      const hash = computeReceiptHash(partial);
      const signature = signReceipt(hash, key);

      const receipt: ActionReceipt = {
        ...partial,
        hash,
        signature,
      };

      receipts.push(receipt);
      prevHash = hash;
    }

    // Clear accumulated steps after finalization
    this.steps = [];

    return receipts;
  }

  /**
   * Get the number of steps currently accumulated.
   *
   * @returns The count of pending steps.
   */
  get stepCount(): number {
    return this.steps.length;
  }

  /**
   * Reset the builder, discarding all accumulated steps.
   */
  reset(): void {
    this.steps = [];
  }
}
