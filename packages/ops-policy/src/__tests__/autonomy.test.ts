import { AutonomyManager } from '../autonomy';
import type { PolicyConfig } from '@ai-operations/shared-types';

function makePolicy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    version: '1.0.0',
    defaultAutonomy: 'approve',
    dailySpendLimit: 100,
    hourlyActionLimit: 10,
    rules: [
      {
        id: 'allow-read',
        description: 'Allow reads',
        match: { operation: 'read' },
        action: 'auto',
        priority: 10,
        enabled: true,
      },
      {
        id: 'deny-delete',
        description: 'Deny deletes',
        match: { operation: 'delete' },
        action: 'deny',
        risk: 'critical',
        priority: 100,
        enabled: true,
      },
    ],
    ...overrides,
  };
}

describe('AutonomyManager', () => {
  describe('canExecute - policy evaluation', () => {
    it('allows auto operations without approval', () => {
      const mgr = new AutonomyManager(makePolicy());
      const decision = mgr.canExecute('gmail', 'read');

      expect(decision.allowed).toBe(true);
      expect(decision.requiresApproval).toBe(false);
    });

    it('allows approve operations but requires approval', () => {
      const mgr = new AutonomyManager(makePolicy());
      // 'send' has no matching rule, falls to defaultAutonomy: 'approve'
      const decision = mgr.canExecute('gmail', 'send');

      expect(decision.allowed).toBe(true);
      expect(decision.requiresApproval).toBe(true);
    });

    it('denies deny operations', () => {
      const mgr = new AutonomyManager(makePolicy());
      const decision = mgr.canExecute('gmail', 'delete');

      expect(decision.allowed).toBe(false);
      expect(decision.requiresApproval).toBe(false);
    });
  });

  describe('canExecute - hourly action limit', () => {
    it('denies execution when hourly action limit is reached', () => {
      const mgr = new AutonomyManager(makePolicy({ hourlyActionLimit: 3 }));

      // Record 3 actions
      mgr.recordAction();
      mgr.recordAction();
      mgr.recordAction();

      const decision = mgr.canExecute('gmail', 'read');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Hourly action limit');
    });

    it('allows execution before reaching hourly action limit', () => {
      const mgr = new AutonomyManager(makePolicy({ hourlyActionLimit: 5 }));

      mgr.recordAction();
      mgr.recordAction();

      const decision = mgr.canExecute('gmail', 'read');
      expect(decision.allowed).toBe(true);
    });
  });

  describe('canExecute - daily spend limit', () => {
    it('denies execution when daily spend would be exceeded', () => {
      const mgr = new AutonomyManager(makePolicy({ dailySpendLimit: 100 }));

      mgr.recordAction(80);

      const decision = mgr.canExecute('shopify', 'read', { amount: 30 });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Daily spend limit');
    });

    it('allows execution within daily spend limit', () => {
      const mgr = new AutonomyManager(makePolicy({ dailySpendLimit: 100 }));

      mgr.recordAction(50);

      const decision = mgr.canExecute('shopify', 'read', { amount: 30 });
      expect(decision.allowed).toBe(true);
    });
  });

  describe('recordAction', () => {
    it('increments the hourly action count', () => {
      const mgr = new AutonomyManager(makePolicy());
      expect(mgr.getHourlyActionCount()).toBe(0);

      mgr.recordAction();
      expect(mgr.getHourlyActionCount()).toBe(1);

      mgr.recordAction();
      expect(mgr.getHourlyActionCount()).toBe(2);
    });

    it('accumulates daily spend', () => {
      const mgr = new AutonomyManager(makePolicy());
      expect(mgr.getDailySpend()).toBe(0);

      mgr.recordAction(25);
      expect(mgr.getDailySpend()).toBe(25);

      mgr.recordAction(30);
      expect(mgr.getDailySpend()).toBe(55);
    });

    it('does not accumulate spend for zero or negative amounts', () => {
      const mgr = new AutonomyManager(makePolicy());

      mgr.recordAction(0);
      expect(mgr.getDailySpend()).toBe(0);

      mgr.recordAction(-10);
      expect(mgr.getDailySpend()).toBe(0);
    });

    it('increments action count even without an amount', () => {
      const mgr = new AutonomyManager(makePolicy());

      mgr.recordAction();
      mgr.recordAction();

      expect(mgr.getHourlyActionCount()).toBe(2);
      expect(mgr.getDailySpend()).toBe(0);
    });
  });

  describe('resetCounters', () => {
    it('resets all counters to zero', () => {
      const mgr = new AutonomyManager(makePolicy());

      mgr.recordAction(50);
      mgr.recordAction(30);

      expect(mgr.getHourlyActionCount()).toBe(2);
      expect(mgr.getDailySpend()).toBe(80);

      mgr.resetCounters();

      expect(mgr.getHourlyActionCount()).toBe(0);
      expect(mgr.getDailySpend()).toBe(0);
    });
  });

  describe('no limits configured', () => {
    it('does not enforce hourly limit when undefined', () => {
      const mgr = new AutonomyManager(makePolicy({ hourlyActionLimit: undefined }));

      // Record many actions
      for (let i = 0; i < 100; i++) {
        mgr.recordAction();
      }

      const decision = mgr.canExecute('gmail', 'read');
      expect(decision.allowed).toBe(true);
    });

    it('does not enforce daily spend limit when undefined', () => {
      const mgr = new AutonomyManager(makePolicy({ dailySpendLimit: undefined }));

      mgr.recordAction(10000);

      const decision = mgr.canExecute('shopify', 'read', { amount: 5000 });
      expect(decision.allowed).toBe(true);
    });
  });
});
