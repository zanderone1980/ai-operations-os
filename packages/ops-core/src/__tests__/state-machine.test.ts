import { StateMachine, InvalidTransitionError } from '../state-machine';

describe('StateMachine', () => {
  let sm: StateMachine;

  beforeEach(() => {
    sm = new StateMachine();
  });

  describe('transition', () => {
    it('transitions pending -> running on start', () => {
      expect(sm.transition('pending', 'start')).toBe('running');
    });

    it('transitions running -> completed on complete', () => {
      expect(sm.transition('running', 'complete')).toBe('completed');
    });

    it('transitions running -> failed on fail', () => {
      expect(sm.transition('running', 'fail')).toBe('failed');
    });

    it('transitions running -> blocked on block', () => {
      expect(sm.transition('running', 'block')).toBe('blocked');
    });

    it('transitions running -> pending on pause', () => {
      expect(sm.transition('running', 'pause')).toBe('pending');
    });

    it('transitions blocked -> approved on approve', () => {
      expect(sm.transition('blocked', 'approve')).toBe('approved');
    });

    it('transitions approved -> running on start', () => {
      expect(sm.transition('approved', 'start')).toBe('running');
    });

    it('transitions approved -> running on resume', () => {
      expect(sm.transition('approved', 'resume')).toBe('running');
    });

    it('transitions pending -> running on resume', () => {
      expect(sm.transition('pending', 'resume')).toBe('running');
    });

    it('throws InvalidTransitionError for pending -> complete', () => {
      expect(() => sm.transition('pending', 'complete')).toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError for completed -> start', () => {
      expect(() => sm.transition('completed', 'start')).toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError for failed -> start', () => {
      expect(() => sm.transition('failed', 'start')).toThrow(InvalidTransitionError);
    });

    it('throws InvalidTransitionError for blocked -> start', () => {
      expect(() => sm.transition('blocked', 'start')).toThrow(InvalidTransitionError);
    });

    it('includes state and event in the error', () => {
      try {
        sm.transition('completed', 'fail');
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidTransitionError);
        const err = e as InvalidTransitionError;
        expect(err.currentState).toBe('completed');
        expect(err.event).toBe('fail');
        expect(err.message).toContain('completed');
        expect(err.message).toContain('fail');
      }
    });
  });

  describe('canTransition', () => {
    it('returns true for valid transitions', () => {
      expect(sm.canTransition('pending', 'start')).toBe(true);
      expect(sm.canTransition('running', 'complete')).toBe(true);
      expect(sm.canTransition('blocked', 'approve')).toBe(true);
    });

    it('returns false for invalid transitions', () => {
      expect(sm.canTransition('pending', 'complete')).toBe(false);
      expect(sm.canTransition('completed', 'start')).toBe(false);
      expect(sm.canTransition('failed', 'resume')).toBe(false);
    });
  });

  describe('validEvents', () => {
    it('returns [start, resume] for pending', () => {
      const events = sm.validEvents('pending');
      expect(events).toContain('start');
      expect(events).toContain('resume');
      expect(events).toHaveLength(2);
    });

    it('returns [complete, fail, block, pause] for running', () => {
      const events = sm.validEvents('running');
      expect(events).toContain('complete');
      expect(events).toContain('fail');
      expect(events).toContain('block');
      expect(events).toContain('pause');
      expect(events).toHaveLength(4);
    });

    it('returns [approve] for blocked', () => {
      const events = sm.validEvents('blocked');
      expect(events).toEqual(['approve']);
    });

    it('returns [start, resume] for approved', () => {
      const events = sm.validEvents('approved');
      expect(events).toContain('start');
      expect(events).toContain('resume');
      expect(events).toHaveLength(2);
    });

    it('returns empty array for completed (terminal state)', () => {
      expect(sm.validEvents('completed')).toEqual([]);
    });

    it('returns empty array for failed (terminal state)', () => {
      expect(sm.validEvents('failed')).toEqual([]);
    });
  });
});
