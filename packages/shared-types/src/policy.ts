/**
 * Policy — Business rules and autonomy levels.
 *
 * Defines what the AI can do autonomously vs. what requires human approval.
 * Separate from CORD (which handles safety); this handles business logic.
 */

export type AutonomyLevel = 'auto' | 'approve' | 'deny';

export interface PolicyRule {
  /** Rule identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** What this rule applies to */
  match: {
    /** Connector name pattern (e.g., 'gmail', '*') */
    connector?: string;
    /** Operation pattern (e.g., 'send', 'delete', '*') */
    operation?: string;
    /** Task source filter */
    source?: string;
    /** Task intent filter */
    intent?: string;
  };

  /** What happens when matched */
  action: AutonomyLevel;

  /** Risk level override */
  risk?: 'low' | 'medium' | 'high' | 'critical';

  /** Maximum dollar amount for financial operations */
  maxAmount?: number;

  /** Time window constraints (e.g., only during business hours) */
  timeWindow?: {
    /** Allowed days (0=Sun, 6=Sat) */
    days?: number[];
    /** Start hour (24h format) */
    startHour?: number;
    /** End hour (24h format) */
    endHour?: number;
    /** Timezone (e.g., 'America/New_York') */
    timezone?: string;
  };

  /** Priority — higher number wins when multiple rules match */
  priority: number;

  /** Whether this rule is currently active */
  enabled: boolean;
}

export interface PolicyConfig {
  /** Policy version for audit trail */
  version: string;

  /** Default autonomy level when no rules match */
  defaultAutonomy: AutonomyLevel;

  /** Global spending limit per day (USD) */
  dailySpendLimit?: number;

  /** Global action limit per hour */
  hourlyActionLimit?: number;

  /** Rules evaluated in priority order */
  rules: PolicyRule[];
}

/**
 * Default policy — conservative (approve everything except reads).
 */
export const DEFAULT_POLICY: PolicyConfig = {
  version: '1.0.0',
  defaultAutonomy: 'approve',
  dailySpendLimit: 100,
  hourlyActionLimit: 50,
  rules: [
    {
      id: 'allow-reads',
      description: 'Allow all read operations autonomously',
      match: { operation: 'read' },
      action: 'auto',
      priority: 10,
      enabled: true,
    },
    {
      id: 'allow-list',
      description: 'Allow listing operations autonomously',
      match: { operation: 'list' },
      action: 'auto',
      priority: 10,
      enabled: true,
    },
    {
      id: 'approve-sends',
      description: 'Require approval before sending any messages',
      match: { operation: 'send' },
      action: 'approve',
      risk: 'medium',
      priority: 20,
      enabled: true,
    },
    {
      id: 'approve-posts',
      description: 'Require approval before publishing to social media',
      match: { operation: 'post' },
      action: 'approve',
      risk: 'high',
      priority: 20,
      enabled: true,
    },
    {
      id: 'deny-delete',
      description: 'Block all delete operations',
      match: { operation: 'delete' },
      action: 'deny',
      risk: 'critical',
      priority: 100,
      enabled: true,
    },
    {
      id: 'deny-financial',
      description: 'Block financial transactions over $50',
      match: { connector: 'shopify', operation: 'refund' },
      action: 'deny',
      maxAmount: 50,
      risk: 'critical',
      priority: 100,
      enabled: true,
    },
  ],
};
