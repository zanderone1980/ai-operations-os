/**
 * BudgetTracker — Tracks spending per day and per connector.
 *
 * Provides fine-grained budget management beyond the global daily limit
 * in PolicyConfig. Tracks spending at the connector level and auto-resets
 * at midnight.
 */

/** Per-connector spending record for a single day. */
interface ConnectorSpend {
  /** Total amount spent today by this connector */
  total: number;
  /** Individual transaction amounts */
  transactions: number[];
}

/**
 * BudgetTracker monitors spending across connectors with daily limits
 * and per-connector breakdowns.
 */
export class BudgetTracker {
  /** Global daily spending limit (USD). Undefined means no limit. */
  private readonly dailyLimit: number | undefined;

  /** Per-connector spending limits. Undefined entries mean no limit. */
  private readonly connectorLimits: Map<string, number> = new Map();

  /** Per-connector spending records for the current day. */
  private readonly spending: Map<string, ConnectorSpend> = new Map();

  /** Timestamp marking the start of the current tracking day. */
  private dayStart: number;

  /**
   * Create a new BudgetTracker.
   * @param dailyLimit       - Global daily spending limit in USD.
   * @param connectorLimits  - Optional per-connector spending limits.
   */
  constructor(
    dailyLimit?: number,
    connectorLimits?: Record<string, number>,
  ) {
    this.dailyLimit = dailyLimit;
    this.dayStart = this.getMidnight();

    if (connectorLimits) {
      for (const [connector, limit] of Object.entries(connectorLimits)) {
        this.connectorLimits.set(connector, limit);
      }
    }
  }

  /**
   * Check whether a given amount can be spent on a connector.
   *
   * Validates against both the global daily limit and any per-connector
   * limit. Does not record the spend -- call `recordSpend` separately
   * after the action executes.
   *
   * @param amount    - The dollar amount to check.
   * @param connector - The connector that would spend this amount.
   * @returns An object indicating whether the spend is allowed and why.
   */
  canSpend(amount: number, connector: string): { allowed: boolean; reason: string } {
    this.maybeResetDay();

    if (amount <= 0) {
      return { allowed: true, reason: 'Zero or negative amount always allowed' };
    }

    // Check global daily limit
    if (this.dailyLimit !== undefined) {
      const currentTotal = this.getDailyTotal();
      if (currentTotal + amount > this.dailyLimit) {
        return {
          allowed: false,
          reason: `Daily spend limit would be exceeded: current $${currentTotal.toFixed(2)} + $${amount.toFixed(2)} > $${this.dailyLimit.toFixed(2)}`,
        };
      }
    }

    // Check per-connector limit
    const connectorLimit = this.connectorLimits.get(connector);
    if (connectorLimit !== undefined) {
      const connectorTotal = this.getConnectorTotal(connector);
      if (connectorTotal + amount > connectorLimit) {
        return {
          allowed: false,
          reason: `Connector "${connector}" spend limit would be exceeded: current $${connectorTotal.toFixed(2)} + $${amount.toFixed(2)} > $${connectorLimit.toFixed(2)}`,
        };
      }
    }

    return { allowed: true, reason: 'Within budget limits' };
  }

  /**
   * Record a spend after an action has been executed.
   *
   * @param amount    - The dollar amount that was spent.
   * @param connector - The connector that incurred this spend.
   */
  recordSpend(amount: number, connector: string): void {
    this.maybeResetDay();

    if (amount <= 0) {
      return;
    }

    const record = this.spending.get(connector);
    if (record) {
      record.total += amount;
      record.transactions.push(amount);
    } else {
      this.spending.set(connector, {
        total: amount,
        transactions: [amount],
      });
    }
  }

  /**
   * Get the total amount spent across all connectors today.
   *
   * @returns The total daily spend in USD.
   */
  getDailyTotal(): number {
    this.maybeResetDay();

    let total = 0;
    for (const record of this.spending.values()) {
      total += record.total;
    }
    return total;
  }

  /**
   * Get the total amount spent by a specific connector today.
   *
   * @param connector - The connector name.
   * @returns The connector's daily spend in USD.
   */
  getConnectorTotal(connector: string): number {
    this.maybeResetDay();

    const record = this.spending.get(connector);
    return record?.total ?? 0;
  }

  /**
   * Get a breakdown of spending by connector for the current day.
   *
   * @returns A record mapping connector names to their spend totals.
   */
  getBreakdown(): Record<string, number> {
    this.maybeResetDay();

    const breakdown: Record<string, number> = {};
    for (const [connector, record] of this.spending.entries()) {
      breakdown[connector] = record.total;
    }
    return breakdown;
  }

  /**
   * Get the remaining daily budget.
   *
   * @returns The remaining amount in USD, or Infinity if no limit is set.
   */
  getRemainingBudget(): number {
    if (this.dailyLimit === undefined) {
      return Infinity;
    }
    return Math.max(0, this.dailyLimit - this.getDailyTotal());
  }

  /**
   * Manually reset all spending records. Useful for testing.
   */
  reset(): void {
    this.spending.clear();
    this.dayStart = this.getMidnight();
  }

  /**
   * Set a per-connector spending limit.
   *
   * @param connector - The connector name.
   * @param limit     - The daily spending limit for this connector.
   */
  setConnectorLimit(connector: string, limit: number): void {
    this.connectorLimits.set(connector, limit);
  }

  /**
   * Auto-reset if midnight has passed since the last reset.
   */
  private maybeResetDay(): void {
    const currentMidnight = this.getMidnight();
    if (currentMidnight > this.dayStart) {
      this.spending.clear();
      this.dayStart = currentMidnight;
    }
  }

  /**
   * Get the timestamp for midnight of the current day.
   */
  private getMidnight(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
}
