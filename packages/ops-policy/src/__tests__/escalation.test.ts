import { EscalationManager } from '../escalation';
import type { EscalationConfig, EscalationTarget } from '../escalation';

const customConfig: EscalationConfig = {
  thresholds: [
    {
      denialCount: 2,
      target: { role: 'owner', channel: 'email', urgency: 'normal' },
    },
    {
      denialCount: 5,
      target: { role: 'team-lead', channel: 'slack', urgency: 'high' },
    },
    {
      denialCount: 10,
      target: { role: 'admin', channel: 'sms', urgency: 'critical' },
    },
  ],
};

describe('EscalationManager', () => {
  describe('shouldEscalate', () => {
    it('returns false when denial count is below the lowest threshold', () => {
      const mgr = new EscalationManager(customConfig);
      expect(mgr.shouldEscalate('task-1', 1)).toBe(false);
    });

    it('returns true when denial count meets the lowest threshold', () => {
      const mgr = new EscalationManager(customConfig);
      expect(mgr.shouldEscalate('task-1', 2)).toBe(true);
    });

    it('returns true when denial count exceeds the lowest threshold', () => {
      const mgr = new EscalationManager(customConfig);
      expect(mgr.shouldEscalate('task-1', 3)).toBe(true);
    });

    it('returns true when denial count meets a higher threshold', () => {
      const mgr = new EscalationManager(customConfig);
      expect(mgr.shouldEscalate('task-1', 5)).toBe(true);
    });

    it('returns true for the highest threshold', () => {
      const mgr = new EscalationManager(customConfig);
      expect(mgr.shouldEscalate('task-1', 10)).toBe(true);
    });

    it('returns false after recording escalation at the same level', () => {
      const mgr = new EscalationManager(customConfig);

      // First check triggers escalation
      mgr.shouldEscalate('task-1', 2);
      const target = mgr.getEscalationTarget('task-1');
      mgr.recordEscalation('task-1', target!);

      // Same denial count should not re-escalate
      expect(mgr.shouldEscalate('task-1', 2)).toBe(false);
    });

    it('returns true when denial count crosses a higher threshold after previous escalation', () => {
      const mgr = new EscalationManager(customConfig);

      // Escalate at level 1 (denialCount: 2)
      mgr.shouldEscalate('task-1', 2);
      const target = mgr.getEscalationTarget('task-1');
      mgr.recordEscalation('task-1', target!);

      // Denial count rises to level 2 (denialCount: 5)
      expect(mgr.shouldEscalate('task-1', 5)).toBe(true);
    });
  });

  describe('getEscalationTarget', () => {
    it('returns undefined for an unknown task', () => {
      const mgr = new EscalationManager(customConfig);
      expect(mgr.getEscalationTarget('unknown')).toBeUndefined();
    });

    it('returns the correct target for the lowest threshold', () => {
      const mgr = new EscalationManager(customConfig);
      mgr.shouldEscalate('task-1', 2);

      const target = mgr.getEscalationTarget('task-1');
      expect(target).toBeDefined();
      expect(target!.role).toBe('owner');
      expect(target!.channel).toBe('email');
      expect(target!.urgency).toBe('normal');
    });

    it('returns the highest matching target for a high denial count', () => {
      const mgr = new EscalationManager(customConfig);
      mgr.shouldEscalate('task-1', 10);

      const target = mgr.getEscalationTarget('task-1');
      expect(target!.role).toBe('admin');
      expect(target!.channel).toBe('sms');
      expect(target!.urgency).toBe('critical');
    });

    it('returns the correct mid-level target', () => {
      const mgr = new EscalationManager(customConfig);
      mgr.shouldEscalate('task-1', 7); // between 5 and 10

      const target = mgr.getEscalationTarget('task-1');
      expect(target!.role).toBe('team-lead');
      expect(target!.channel).toBe('slack');
    });
  });

  describe('recordDenial', () => {
    it('creates state for a new task on first denial', () => {
      const mgr = new EscalationManager(customConfig);

      mgr.recordDenial('task-1');

      const state = mgr.getState('task-1');
      expect(state).toBeDefined();
      expect(state!.denialCount).toBe(1);
      expect(state!.escalated).toBe(false);
    });

    it('increments denial count on subsequent denials', () => {
      const mgr = new EscalationManager(customConfig);

      mgr.recordDenial('task-1');
      mgr.recordDenial('task-1');
      mgr.recordDenial('task-1');

      const state = mgr.getState('task-1');
      expect(state!.denialCount).toBe(3);
    });

    it('tracks denials independently per task', () => {
      const mgr = new EscalationManager(customConfig);

      mgr.recordDenial('task-1');
      mgr.recordDenial('task-1');
      mgr.recordDenial('task-2');

      expect(mgr.getState('task-1')!.denialCount).toBe(2);
      expect(mgr.getState('task-2')!.denialCount).toBe(1);
    });
  });

  describe('recordEscalation', () => {
    it('marks the task as escalated', () => {
      const mgr = new EscalationManager(customConfig);
      mgr.shouldEscalate('task-1', 3);

      const target: EscalationTarget = { role: 'owner', channel: 'email', urgency: 'normal' };
      mgr.recordEscalation('task-1', target);

      const state = mgr.getState('task-1');
      expect(state!.escalated).toBe(true);
      expect(state!.escalatedTo).toEqual(target);
      expect(state!.escalatedAt).toBeDefined();
    });
  });

  describe('clearState', () => {
    it('removes all escalation state for a task', () => {
      const mgr = new EscalationManager(customConfig);

      mgr.recordDenial('task-1');
      mgr.recordDenial('task-1');
      expect(mgr.getState('task-1')).toBeDefined();

      mgr.clearState('task-1');
      expect(mgr.getState('task-1')).toBeUndefined();
    });

    it('does not affect other tasks', () => {
      const mgr = new EscalationManager(customConfig);

      mgr.recordDenial('task-1');
      mgr.recordDenial('task-2');

      mgr.clearState('task-1');

      expect(mgr.getState('task-1')).toBeUndefined();
      expect(mgr.getState('task-2')).toBeDefined();
    });
  });

  describe('default config', () => {
    it('uses default config when none provided', () => {
      const mgr = new EscalationManager();

      // Default first threshold is at 3 denials
      expect(mgr.shouldEscalate('task-1', 2)).toBe(false);
      expect(mgr.shouldEscalate('task-1', 3)).toBe(true);
    });
  });
});
