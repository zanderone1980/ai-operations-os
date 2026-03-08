/**
 * CORD Gate Middleware — Pre-flight safety evaluation for all actions.
 *
 * Every workflow step passes through the CORD gate before execution.
 * If CORD blocks the action, it never reaches the connector.
 */

export interface GateResult {
  allowed: boolean;
  decision: 'ALLOW' | 'CONTAIN' | 'CHALLENGE' | 'BLOCK';
  score: number;
  reasons: string[];
  requiresApproval: boolean;
}

// Graceful cord-engine import
let cord: any = null;
try {
  cord = require('cord-engine');
} catch {
  // cord-engine not installed — allow everything with warning
}

/**
 * Evaluate an action through the CORD safety gate.
 */
export function evaluateAction(
  connector: string,
  operation: string,
  input: Record<string, unknown>,
): GateResult {
  // If CORD is not available, allow with warning
  if (!cord) {
    return {
      allowed: true,
      decision: 'ALLOW',
      score: 0,
      reasons: ['cord-engine not installed — running without safety enforcement'],
      requiresApproval: false,
    };
  }

  try {
    // Build proposal text for CORD evaluation
    const text = buildProposalText(connector, operation, input);

    const result = cord.evaluate({
      text,
      toolName: mapConnectorToToolType(connector),
      actionType: mapOperationToActionType(operation),
    });

    const decision = result.decision || 'ALLOW';

    return {
      allowed: decision !== 'BLOCK',
      decision,
      score: result.score || 0,
      reasons: result.reasons || [],
      requiresApproval: decision === 'CHALLENGE',
    };
  } catch (err) {
    console.error('[cord-gate] Evaluation error:', err);
    // Fail-open with high risk score
    return {
      allowed: true,
      decision: 'CONTAIN',
      score: 50,
      reasons: ['CORD evaluation failed — proceeding with elevated monitoring'],
      requiresApproval: false,
    };
  }
}

/**
 * Build a human-readable proposal text from connector + operation + input.
 */
function buildProposalText(
  connector: string,
  operation: string,
  input: Record<string, unknown>,
): string {
  const parts = [`${connector}.${operation}`];

  // Add relevant input fields
  if (input.to) parts.push(`to: ${input.to}`);
  if (input.subject) parts.push(`subject: ${input.subject}`);
  if (input.command) parts.push(`command: ${input.command}`);
  if (input.url) parts.push(`url: ${input.url}`);
  if (input.path) parts.push(`path: ${input.path}`);
  if (input.amount) parts.push(`amount: ${input.amount}`);

  return parts.join(' | ');
}

/**
 * Map connector names to CORD tool types.
 */
function mapConnectorToToolType(connector: string): string {
  const map: Record<string, string> = {
    gmail: 'communication',
    calendar: 'communication',
    'x-twitter': 'communication',
    shopify: 'network',
    stripe: 'network',
    execute: 'exec',
    write_file: 'write',
    read_file: 'read',
  };
  return map[connector] || 'unknown';
}

/**
 * Map operation names to CORD action types.
 */
function mapOperationToActionType(operation: string): string {
  const map: Record<string, string> = {
    send: 'communication',
    reply: 'communication',
    post: 'communication',
    read: 'read',
    list: 'read',
    search: 'read',
    create_event: 'write',
    update_event: 'write',
    delete: 'destructive',
    refund: 'financial',
    fulfill_order: 'write',
  };
  return map[operation] || 'unknown';
}
