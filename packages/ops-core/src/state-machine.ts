/**
 * StateMachine — Enforces valid workflow step state transitions.
 *
 * Workflow steps move through a well-defined lifecycle:
 *
 *   pending  --> running
 *   running  --> completed | failed | blocked
 *   blocked  --> approved
 *   approved --> running
 *   paused   --> running
 *
 * Any transition not in the table above is rejected with an error.
 */

import type { StepStatus } from '@ai-operations/shared-types';

/** Events that trigger state transitions. */
export type StepEvent =
  | 'start'
  | 'complete'
  | 'fail'
  | 'block'
  | 'approve'
  | 'pause'
  | 'resume';

/**
 * A single entry in the transition table.
 * Maps (fromState, event) --> toState.
 */
interface TransitionRule {
  from: StepStatus;
  event: StepEvent;
  to: StepStatus;
}

/** The canonical set of valid transitions. */
const TRANSITION_TABLE: readonly TransitionRule[] = [
  { from: 'pending', event: 'start', to: 'running' },
  { from: 'running', event: 'complete', to: 'completed' },
  { from: 'running', event: 'fail', to: 'failed' },
  { from: 'running', event: 'block', to: 'blocked' },
  { from: 'running', event: 'pause', to: 'pending' },
  { from: 'blocked', event: 'approve', to: 'approved' },
  { from: 'approved', event: 'start', to: 'running' },
  { from: 'approved', event: 'resume', to: 'running' },
  { from: 'pending', event: 'resume', to: 'running' },
] as const;

/**
 * Error thrown when a transition is not allowed.
 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly currentState: StepStatus,
    public readonly event: StepEvent,
  ) {
    super(
      `Invalid transition: cannot apply event '${event}' to state '${currentState}'`,
    );
    this.name = 'InvalidTransitionError';
  }
}

/**
 * StateMachine enforces valid step-status transitions.
 *
 * @example
 * ```ts
 * const sm = new StateMachine();
 * const next = sm.transition('pending', 'start'); // => 'running'
 * sm.transition('pending', 'complete');            // throws InvalidTransitionError
 * ```
 */
export class StateMachine {
  /** Lookup map built from the transition table for O(1) access. */
  private readonly transitions: Map<string, StepStatus>;

  constructor() {
    this.transitions = new Map();
    for (const rule of TRANSITION_TABLE) {
      this.transitions.set(this.key(rule.from, rule.event), rule.to);
    }
  }

  /**
   * Attempt a state transition.
   *
   * @param currentState - The step's current status.
   * @param event        - The event to apply.
   * @returns The resulting status after the transition.
   * @throws {InvalidTransitionError} If the transition is not allowed.
   */
  transition(currentState: StepStatus, event: StepEvent): StepStatus {
    const next = this.transitions.get(this.key(currentState, event));
    if (next === undefined) {
      throw new InvalidTransitionError(currentState, event);
    }
    return next;
  }

  /**
   * Check whether a transition is valid without throwing.
   *
   * @param currentState - The step's current status.
   * @param event        - The event to test.
   * @returns `true` if the transition is allowed.
   */
  canTransition(currentState: StepStatus, event: StepEvent): boolean {
    return this.transitions.has(this.key(currentState, event));
  }

  /**
   * Return all events that are valid from the given state.
   *
   * @param currentState - The step's current status.
   * @returns Array of events that can be applied.
   */
  validEvents(currentState: StepStatus): StepEvent[] {
    const events: StepEvent[] = [];
    for (const rule of TRANSITION_TABLE) {
      if (rule.from === currentState) {
        events.push(rule.event);
      }
    }
    return events;
  }

  /** Build a composite key for the transition map. */
  private key(state: StepStatus, event: StepEvent): string {
    return `${state}:${event}`;
  }
}
