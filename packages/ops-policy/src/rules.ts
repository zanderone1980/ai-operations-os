/**
 * RuleEngine — Evaluates policy rules against operations.
 *
 * Takes a PolicyConfig and evaluates incoming connector operations against
 * the configured rules. Rules are evaluated in priority order (highest first);
 * the first matching rule wins. If no rules match, the config's defaultAutonomy
 * is returned.
 */

import type { PolicyConfig, PolicyRule, AutonomyLevel } from '@ai-operations/shared-types';
import type { RiskLevel } from '@ai-operations/shared-types';

/** Context provided when evaluating a rule. */
export interface EvaluationContext {
  /** Source of the task (e.g., 'email', 'slack', 'cron') */
  source?: string;
  /** Intent of the task (e.g., 'customer-support', 'marketing') */
  intent?: string;
  /** Dollar amount for financial operations */
  amount?: number;
}

/** Result of a rule evaluation. */
export interface EvaluationResult {
  /** The resolved autonomy level for this operation */
  autonomy: AutonomyLevel;
  /** The assessed risk level */
  risk: RiskLevel;
  /** The rule that matched, if any */
  matchedRule?: PolicyRule;
  /** Human-readable explanation of the decision */
  reason: string;
}

/**
 * RuleEngine evaluates policy rules to determine autonomy and risk levels
 * for connector operations.
 */
export class RuleEngine {
  private readonly config: PolicyConfig;
  private readonly sortedRules: PolicyRule[];

  /**
   * Create a new RuleEngine with the given policy configuration.
   * @param config - The policy configuration containing rules and defaults.
   */
  constructor(config: PolicyConfig) {
    this.config = config;
    // Sort rules by priority descending so highest priority is evaluated first.
    this.sortedRules = [...config.rules]
      .filter((rule) => rule.enabled)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Evaluate a connector operation against the configured policy rules.
   *
   * Rules are checked in priority order (highest first). The first rule
   * whose match criteria are satisfied wins. If no rules match, the
   * config's defaultAutonomy is used.
   *
   * @param connector - The connector name (e.g., 'gmail', 'shopify').
   * @param operation - The operation name (e.g., 'send', 'read', 'delete').
   * @param context  - Optional context with source, intent, and amount.
   * @returns The evaluation result with autonomy level, risk, and reasoning.
   */
  evaluate(
    connector: string,
    operation: string,
    context?: EvaluationContext,
  ): EvaluationResult {
    for (const rule of this.sortedRules) {
      if (!this.matchesRule(rule, connector, operation, context)) {
        continue;
      }

      // Check time window constraints
      if (rule.timeWindow && !this.isWithinTimeWindow(rule.timeWindow)) {
        continue;
      }

      // Check amount limits: if a rule has a maxAmount and the context amount
      // exceeds it, the rule still matches but enforces a deny.
      if (
        rule.maxAmount !== undefined &&
        context?.amount !== undefined &&
        context.amount > rule.maxAmount
      ) {
        return {
          autonomy: 'deny',
          risk: rule.risk ?? 'high',
          matchedRule: rule,
          reason: `Amount $${context.amount} exceeds limit of $${rule.maxAmount} (rule: ${rule.id})`,
        };
      }

      return {
        autonomy: rule.action,
        risk: rule.risk ?? 'low',
        matchedRule: rule,
        reason: `Matched rule "${rule.id}": ${rule.description}`,
      };
    }

    // No rules matched — fall back to default
    return {
      autonomy: this.config.defaultAutonomy,
      risk: 'low',
      reason: `No matching rule found; using default autonomy: ${this.config.defaultAutonomy}`,
    };
  }

  /**
   * Check whether a rule's match criteria are satisfied.
   *
   * Each match field is optional. If specified, it must match exactly or
   * be the wildcard '*'. All specified fields must match for the rule
   * to be considered a match (logical AND).
   */
  private matchesRule(
    rule: PolicyRule,
    connector: string,
    operation: string,
    context?: EvaluationContext,
  ): boolean {
    const { match } = rule;

    if (match.connector && match.connector !== '*' && match.connector !== connector) {
      return false;
    }

    if (match.operation && match.operation !== '*' && match.operation !== operation) {
      return false;
    }

    if (match.source && match.source !== '*' && match.source !== context?.source) {
      return false;
    }

    if (match.intent && match.intent !== '*' && match.intent !== context?.intent) {
      return false;
    }

    return true;
  }

  /**
   * Check whether the current time falls within the rule's time window.
   *
   * @param timeWindow - The time window constraints from the rule.
   * @returns True if the current time is within the allowed window.
   */
  private isWithinTimeWindow(timeWindow: NonNullable<PolicyRule['timeWindow']>): boolean {
    const now = new Date();

    // Resolve current time in the specified timezone, or system default
    let currentHour: number;
    let currentDay: number;

    if (timeWindow.timezone) {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timeWindow.timezone,
        hour: 'numeric',
        hour12: false,
        weekday: 'short',
      });
      const parts = formatter.formatToParts(now);
      const hourPart = parts.find((p) => p.type === 'hour');
      const dayPart = parts.find((p) => p.type === 'weekday');

      currentHour = hourPart ? parseInt(hourPart.value, 10) : now.getHours();
      const dayMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      currentDay = dayPart ? (dayMap[dayPart.value] ?? now.getDay()) : now.getDay();
    } else {
      currentHour = now.getHours();
      currentDay = now.getDay();
    }

    // Check allowed days
    if (timeWindow.days && !timeWindow.days.includes(currentDay)) {
      return false;
    }

    // Check hour range
    if (timeWindow.startHour !== undefined && currentHour < timeWindow.startHour) {
      return false;
    }
    if (timeWindow.endHour !== undefined && currentHour >= timeWindow.endHour) {
      return false;
    }

    return true;
  }
}
