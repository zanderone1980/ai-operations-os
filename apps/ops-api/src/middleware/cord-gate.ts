/**
 * CORD Gate Middleware — Pre-flight safety evaluation for all actions.
 *
 * Every workflow step passes through the CORD gate before execution.
 * If CORD blocks the action, it never reaches the connector.
 *
 * Delegates to CordSafetyGate from @ai-operations/cord-adapter for the actual
 * evaluation logic, keeping the API layer thin.
 */

import { CordSafetyGate } from '@ai-operations/cord-adapter';

export interface GateResult {
  allowed: boolean;
  decision: 'ALLOW' | 'CONTAIN' | 'CHALLENGE' | 'BLOCK';
  score: number;
  reasons: string[];
  requiresApproval: boolean;
}

// Singleton safety gate
const safetyGate = new CordSafetyGate();

/** Whether cord-engine is loaded and available. */
export const cordAvailable = safetyGate.isAvailable();

/**
 * Evaluate an action through the CORD safety gate.
 */
export function evaluateAction(
  connector: string,
  operation: string,
  input: Record<string, unknown>,
): GateResult {
  const result = safetyGate.evaluateAction(connector, operation, input);

  return {
    allowed: result.decision !== 'BLOCK',
    decision: result.decision,
    score: result.score,
    reasons: result.reasons,
    requiresApproval: result.decision === 'CHALLENGE' || result.hardBlock,
  };
}
