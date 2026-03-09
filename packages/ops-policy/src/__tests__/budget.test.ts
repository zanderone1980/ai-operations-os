import { BudgetTracker } from '../budget';

describe('BudgetTracker', () => {
  describe('canSpend - global daily limit', () => {
    it('allows spending within the daily limit', () => {
      const tracker = new BudgetTracker(100);

      const result = tracker.canSpend(50, 'shopify');
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Within budget');
    });

    it('denies spending when it would exceed the daily limit', () => {
      const tracker = new BudgetTracker(100);
      tracker.recordSpend(80, 'shopify');

      const result = tracker.canSpend(30, 'shopify');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily spend limit');
    });

    it('allows spending exactly at the daily limit', () => {
      const tracker = new BudgetTracker(100);
      tracker.recordSpend(50, 'shopify');

      const result = tracker.canSpend(50, 'shopify');
      expect(result.allowed).toBe(true);
    });

    it('allows zero or negative amounts regardless of budget', () => {
      const tracker = new BudgetTracker(100);
      tracker.recordSpend(100, 'shopify');

      expect(tracker.canSpend(0, 'shopify').allowed).toBe(true);
      expect(tracker.canSpend(-10, 'shopify').allowed).toBe(true);
    });
  });

  describe('canSpend - per-connector limit', () => {
    it('denies spending when per-connector limit would be exceeded', () => {
      const tracker = new BudgetTracker(1000, { shopify: 50 });
      tracker.recordSpend(40, 'shopify');

      const result = tracker.canSpend(20, 'shopify');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('shopify');
    });

    it('allows spending on connectors without limits', () => {
      const tracker = new BudgetTracker(1000, { shopify: 50 });
      tracker.recordSpend(500, 'gmail'); // gmail has no per-connector limit

      const result = tracker.canSpend(200, 'gmail');
      expect(result.allowed).toBe(true);
    });

    it('checks both global and connector limits', () => {
      const tracker = new BudgetTracker(100, { shopify: 200 });
      tracker.recordSpend(90, 'shopify');

      // Under connector limit (200), but over global limit (100)
      const result = tracker.canSpend(20, 'shopify');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily spend limit');
    });
  });

  describe('canSpend - no limit', () => {
    it('allows any amount when no daily limit is set', () => {
      const tracker = new BudgetTracker();

      const result = tracker.canSpend(999999, 'shopify');
      expect(result.allowed).toBe(true);
    });
  });

  describe('recordSpend', () => {
    it('accumulates spending across multiple calls', () => {
      const tracker = new BudgetTracker(500);

      tracker.recordSpend(100, 'shopify');
      tracker.recordSpend(50, 'shopify');
      tracker.recordSpend(25, 'gmail');

      expect(tracker.getDailyTotal()).toBe(175);
    });

    it('ignores zero and negative amounts', () => {
      const tracker = new BudgetTracker(500);

      tracker.recordSpend(0, 'shopify');
      tracker.recordSpend(-10, 'shopify');

      expect(tracker.getDailyTotal()).toBe(0);
    });
  });

  describe('getDailyTotal', () => {
    it('returns 0 when no spending has occurred', () => {
      const tracker = new BudgetTracker(100);
      expect(tracker.getDailyTotal()).toBe(0);
    });

    it('sums spending across all connectors', () => {
      const tracker = new BudgetTracker(1000);
      tracker.recordSpend(30, 'shopify');
      tracker.recordSpend(20, 'gmail');
      tracker.recordSpend(50, 'calendar');

      expect(tracker.getDailyTotal()).toBe(100);
    });
  });

  describe('getConnectorTotal', () => {
    it('returns 0 for a connector with no spending', () => {
      const tracker = new BudgetTracker(100);
      expect(tracker.getConnectorTotal('shopify')).toBe(0);
    });

    it('returns correct total for a specific connector', () => {
      const tracker = new BudgetTracker(1000);
      tracker.recordSpend(30, 'shopify');
      tracker.recordSpend(20, 'shopify');
      tracker.recordSpend(100, 'gmail');

      expect(tracker.getConnectorTotal('shopify')).toBe(50);
      expect(tracker.getConnectorTotal('gmail')).toBe(100);
    });
  });

  describe('getBreakdown', () => {
    it('returns an empty object with no spending', () => {
      const tracker = new BudgetTracker(100);
      expect(tracker.getBreakdown()).toEqual({});
    });

    it('returns a breakdown by connector', () => {
      const tracker = new BudgetTracker(1000);
      tracker.recordSpend(30, 'shopify');
      tracker.recordSpend(20, 'gmail');

      expect(tracker.getBreakdown()).toEqual({
        shopify: 30,
        gmail: 20,
      });
    });
  });

  describe('getRemainingBudget', () => {
    it('returns Infinity when no daily limit is set', () => {
      const tracker = new BudgetTracker();
      expect(tracker.getRemainingBudget()).toBe(Infinity);
    });

    it('returns the full limit when no spending has occurred', () => {
      const tracker = new BudgetTracker(100);
      expect(tracker.getRemainingBudget()).toBe(100);
    });

    it('returns the correct remaining amount', () => {
      const tracker = new BudgetTracker(100);
      tracker.recordSpend(60, 'shopify');
      expect(tracker.getRemainingBudget()).toBe(40);
    });

    it('returns 0 when fully spent (not negative)', () => {
      const tracker = new BudgetTracker(100);
      tracker.recordSpend(100, 'shopify');
      expect(tracker.getRemainingBudget()).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all spending records', () => {
      const tracker = new BudgetTracker(100);
      tracker.recordSpend(50, 'shopify');
      tracker.recordSpend(30, 'gmail');

      tracker.reset();

      expect(tracker.getDailyTotal()).toBe(0);
      expect(tracker.getConnectorTotal('shopify')).toBe(0);
      expect(tracker.getBreakdown()).toEqual({});
      expect(tracker.getRemainingBudget()).toBe(100);
    });
  });

  describe('setConnectorLimit', () => {
    it('adds a new per-connector limit dynamically', () => {
      const tracker = new BudgetTracker(1000);
      tracker.setConnectorLimit('shopify', 50);
      tracker.recordSpend(40, 'shopify');

      const result = tracker.canSpend(20, 'shopify');
      expect(result.allowed).toBe(false);
    });

    it('updates an existing per-connector limit', () => {
      const tracker = new BudgetTracker(1000, { shopify: 50 });
      tracker.setConnectorLimit('shopify', 200);
      tracker.recordSpend(100, 'shopify');

      const result = tracker.canSpend(50, 'shopify');
      expect(result.allowed).toBe(true);
    });
  });
});
