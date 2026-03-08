/**
 * CordSafetyGate — Wraps cord-engine's evaluate function for safe action gating.
 *
 * Provides a graceful abstraction over cord-engine. If cord-engine is not
 * installed (it is an optional dependency), all evaluations return ALLOW
 * with a warning so the system can still operate in a permissive mode.
 */

import type { CordDecision } from '@ai-ops/shared-types';

// ---------------------------------------------------------------------------
// Graceful cord-engine import
// ---------------------------------------------------------------------------

let cord: any = null;
try {
  cord = require('cord-engine');
} catch {
  /* cord-engine not installed */
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a CORD safety evaluation. */
export interface SafetyResult {
  /** The safety decision — mirrors CordDecision from shared-types. */
  decision: CordDecision;

  /** Numeric risk score (0-99). Higher means riskier. */
  score: number;

  /** Human-readable reasons that contributed to the decision. */
  reasons: string[];

  /** Whether this is a hard block that cannot be overridden. */
  hardBlock: boolean;
}

/**
 * Mapping from connector operation types to CORD tool categories.
 * CORD evaluates risk differently depending on the tool type.
 */
const CONNECTOR_TO_CORD_TOOL: Record<string, string> = {
  send: 'communication',
  reply: 'communication',
  forward: 'communication',
  post: 'publication',
  tweet: 'publication',
  delete: 'destructive',
  remove: 'destructive',
  archive: 'destructive',
  create_event: 'scheduling',
  update_event: 'scheduling',
  cancel_event: 'scheduling',
  refund: 'financial',
  charge: 'financial',
  transfer: 'financial',
  read: 'readonly',
  list: 'readonly',
  search: 'readonly',
  get: 'readonly',
};

// ---------------------------------------------------------------------------
// CordSafetyGate
// ---------------------------------------------------------------------------

/**
 * CordSafetyGate wraps cord-engine to evaluate proposed connector actions
 * against safety policies before execution.
 *
 * @example
 * ```ts
 * const gate = new CordSafetyGate();
 * const result = gate.evaluateAction('gmail', 'send', { to: 'user@example.com', subject: 'Hi' });
 * if (result.decision === 'BLOCK') {
 *   console.error('Action blocked:', result.reasons);
 * }
 * ```
 */
export class CordSafetyGate {
  /** Whether cord-engine is available for real evaluations. */
  private readonly cordAvailable: boolean;

  constructor() {
    this.cordAvailable = cord !== null;
    if (!this.cordAvailable) {
      console.warn(
        '[CordSafetyGate] cord-engine is not installed. All evaluations will return ALLOW.',
      );
    }
  }

  /**
   * Evaluate a proposed connector action through CORD safety analysis.
   *
   * @param connector - The connector name (e.g., 'gmail', 'shopify', 'x').
   * @param operation - The operation to perform (e.g., 'send', 'delete', 'post').
   * @param input     - The input data for the operation.
   * @returns A SafetyResult with the decision, score, reasons, and hard-block flag.
   */
  evaluateAction(
    connector: string,
    operation: string,
    input: Record<string, unknown>,
  ): SafetyResult {
    if (!this.cordAvailable) {
      return {
        decision: 'ALLOW',
        score: 0,
        reasons: ['cord-engine not installed — defaulting to ALLOW'],
        hardBlock: false,
      };
    }

    const proposal = this.buildProposal(connector, operation, input);
    const cordToolType = this.mapOperationToToolType(operation);

    try {
      const evaluation = cord.evaluate(proposal, { toolType: cordToolType });

      return {
        decision: evaluation.decision as CordDecision,
        score: typeof evaluation.score === 'number' ? evaluation.score : 0,
        reasons: Array.isArray(evaluation.reasons) ? evaluation.reasons : [],
        hardBlock: evaluation.hardBlock === true,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        decision: 'CONTAIN',
        score: 50,
        reasons: [`CORD evaluation error: ${message}`],
        hardBlock: false,
      };
    }
  }

  /**
   * Check whether cord-engine is available.
   *
   * @returns True if cord-engine was successfully loaded.
   */
  isAvailable(): boolean {
    return this.cordAvailable;
  }

  /**
   * Build a proposal text string for CORD evaluation from connector action details.
   *
   * @param connector - The connector name.
   * @param operation - The operation name.
   * @param input     - The input data.
   * @returns A proposal string describing the intended action.
   */
  private buildProposal(
    connector: string,
    operation: string,
    input: Record<string, unknown>,
  ): string {
    const inputSummary = Object.entries(input)
      .map(([key, value]) => {
        const display = typeof value === 'string' ? value : JSON.stringify(value);
        return `  ${key}: ${display}`;
      })
      .join('\n');

    return [
      `Action: ${connector}.${operation}`,
      `Connector: ${connector}`,
      `Operation: ${operation}`,
      `Input:`,
      inputSummary,
    ].join('\n');
  }

  /**
   * Map a connector operation to its corresponding CORD tool type.
   *
   * @param operation - The operation name (e.g., 'send', 'delete').
   * @returns The CORD tool type category string.
   */
  private mapOperationToToolType(operation: string): string {
    return CONNECTOR_TO_CORD_TOOL[operation] ?? 'general';
  }
}
