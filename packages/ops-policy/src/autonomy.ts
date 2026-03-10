/**
 * AutonomyManager — High-level autonomy decision-making.
 *
 * Wraps the RuleEngine and adds rate limiting (daily spend, hourly action
 * counts). Provides a simple `canExecute` interface for the orchestration
 * layer to call before executing any connector operation.
 */

import type { PolicyConfig } from '@ai-operations/shared-types';
import { RuleEngine } from './rules';
import type { EvaluationContext } from './rules';

/** Result of an autonomy check. */
export interface AutonomyDecision {
  /** Whether the operation is allowed to proceed */
  allowed: boolean;
  /** Whether the operation requires human approval before proceeding */
  requiresApproval: boolean;
  /** Human-readable explanation of the decision */
  reason: string;
}

/**
 * AutonomyManager orchestrates policy evaluation with rate limiting
 * and spending constraints.
 */
export class AutonomyManager {
  private readonly engine: RuleEngine;
  private readonly config: PolicyConfig;

  /** Accumulated spend for the current day (USD). */
  private dailySpend: number = 0;

  /** Number of actions taken in the current hour. */
  private hourlyActionCount: number = 0;

  /** Timestamp of the last hourly counter reset. */
  private lastHourlyReset: number = Date.now();

  /** Timestamp of the last daily counter reset. */
  private lastDailyReset: number = Date.now();

  /**
   * Create a new AutonomyManager.
   * @param config - The policy configuration to enforce.
   */
  constructor(config: PolicyConfig) {
    this.config = config;
    this.engine = new RuleEngine(config);
  }

  /**
   * Determine whether a connector operation can be executed.
   *
   * This checks the policy rules via the RuleEngine, then applies
   * rate-limiting constraints (hourly action limit, daily spend limit).
   *
   * @param connector - The connector name (e.g., 'gmail', 'shopify').
   * @param operation - The operation name (e.g., 'send', 'refund').
   * @param context   - Optional context with source, intent, and amount.
   * @returns An AutonomyDecision indicating whether the operation is allowed.
   */
  canExecute(
    connector: string,
    operation: string,
    context?: EvaluationContext,
  ): AutonomyDecision {
    // Auto-reset counters if enough time has elapsed
    this.maybeResetCounters();

    // Check hourly action limit
    if (
      this.config.hourlyActionLimit !== undefined &&
      this.hourlyActionCount >= this.config.hourlyActionLimit
    ) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Hourly action limit reached (${this.config.hourlyActionLimit} actions/hour)`,
      };
    }

    // Check daily spend limit
    if (
      this.config.dailySpendLimit !== undefined &&
      context?.amount !== undefined &&
      this.dailySpend + context.amount > this.config.dailySpendLimit
    ) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Daily spend limit would be exceeded: current $${this.dailySpend} + $${context.amount} > $${this.config.dailySpendLimit}`,
      };
    }

    // Evaluate against policy rules
    const result = this.engine.evaluate(connector, operation, context);

    switch (result.autonomy) {
      case 'auto':
        return {
          allowed: true,
          requiresApproval: false,
          reason: result.reason,
        };

      case 'approve':
        return {
          allowed: true,
          requiresApproval: true,
          reason: result.reason,
        };

      case 'deny':
        return {
          allowed: false,
          requiresApproval: false,
          reason: result.reason,
        };

      default:
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Unknown autonomy level: ${result.autonomy}`,
        };
    }
  }

  /**
   * Record that an action was executed, updating counters.
   *
   * Call this after an action is successfully executed to keep
   * rate-limiting counters accurate.
   *
   * @param amount - Optional dollar amount spent by this action.
   */
  recordAction(amount?: number): void {
    this.maybeResetCounters();
    this.hourlyActionCount += 1;
    if (amount !== undefined && amount > 0) {
      this.dailySpend += amount;
    }
  }

  /**
   * Manually reset all counters. Useful for testing or forced resets.
   */
  resetCounters(): void {
    this.dailySpend = 0;
    this.hourlyActionCount = 0;
    this.lastHourlyReset = Date.now();
    this.lastDailyReset = Date.now();
  }

  /**
   * Get the current daily spend total.
   */
  getDailySpend(): number {
    return this.dailySpend;
  }

  /**
   * Get the current hourly action count.
   */
  getHourlyActionCount(): number {
    return this.hourlyActionCount;
  }

  /**
   * Auto-reset counters when the hour or day rolls over.
   */
  private maybeResetCounters(): void {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (now - this.lastHourlyReset >= ONE_HOUR) {
      this.hourlyActionCount = 0;
      this.lastHourlyReset = now;
    }

    if (now - this.lastDailyReset >= ONE_DAY) {
      this.dailySpend = 0;
      this.lastDailyReset = now;
    }
  }
}
