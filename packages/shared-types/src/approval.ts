import { randomUUID } from './uuid';

/**
 * Approval — Human-in-the-loop gate.
 *
 * When CORD or policy rules flag an action as requiring confirmation,
 * an Approval request is created. The user sees a preview and decides.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ApprovalDecision = 'approved' | 'denied' | 'modified';

export interface Approval {
  /** Approval request identifier (UUID v4) */
  id: string;

  /** The action requiring approval */
  actionId: string;

  /** Parent task for context */
  taskId: string;

  /** Risk assessment */
  risk: RiskLevel;

  /** Human-readable reason why approval is needed */
  reason: string;

  /** Preview of what the action will do (shown to user) */
  preview: string;

  /** When approval was requested (ISO 8601) */
  requestedAt: string;

  /** User's decision */
  decision?: ApprovalDecision;

  /** Who made the decision */
  decidedBy?: string;

  /** When the decision was made (ISO 8601) */
  decidedAt?: string;

  /** If decision was 'modified', what changed */
  modifications?: Record<string, unknown>;

  /** Time-to-live: auto-deny after this duration (ms). Null = wait forever. */
  ttlMs?: number | null;
}

/**
 * Create a new Approval request.
 */
export function createApproval(
  actionId: string,
  taskId: string,
  risk: RiskLevel,
  reason: string,
  preview: string,
  ttlMs?: number | null,
): Approval {
  return {
    id: randomUUID(),
    actionId,
    taskId,
    risk,
    reason,
    preview,
    requestedAt: new Date().toISOString(),
    ttlMs: ttlMs ?? null,
  };
}

/**
 * Check if an approval has expired.
 */
export function isApprovalExpired(approval: Approval): boolean {
  if (!approval.ttlMs || approval.decision) return false;
  const elapsed = Date.now() - new Date(approval.requestedAt).getTime();
  return elapsed > approval.ttlMs;
}
