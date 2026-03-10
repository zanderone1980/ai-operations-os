/**
 * WorkflowEngine — Sequential step executor with safety gates.
 *
 * Drives a WorkflowRun through its steps one at a time. Each step is
 * handed off to a connector (looked up from an injected registry) after
 * passing through a safety gate callback. The engine yields typed events
 * so callers can react to progress in real time.
 */

import type {
  WorkflowRun,
  WorkflowStep,
  StepStatus,
  WorkflowState,
  CordDecision,
} from '@ai-operations/shared-types';

import { StateMachine, InvalidTransitionError } from './state-machine';
import type { StepEvent } from './state-machine';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/** Base shape for all workflow events. */
interface WorkflowEventBase {
  /** ISO 8601 timestamp of when the event was emitted. */
  timestamp: string;
  /** The workflow run that produced this event. */
  runId: string;
}

export interface StepStartEvent extends WorkflowEventBase {
  type: 'step_start';
  stepId: string;
  connector: string;
  operation: string;
}

export interface StepCompleteEvent extends WorkflowEventBase {
  type: 'step_complete';
  stepId: string;
  output: Record<string, unknown>;
  durationMs: number;
}

export interface StepBlockedEvent extends WorkflowEventBase {
  type: 'step_blocked';
  stepId: string;
  cordDecision: CordDecision;
  cordScore: number;
  reason: string;
}

export interface StepFailedEvent extends WorkflowEventBase {
  type: 'step_failed';
  stepId: string;
  error: string;
}

export interface RunCompleteEvent extends WorkflowEventBase {
  type: 'run_complete';
}

export interface RunFailedEvent extends WorkflowEventBase {
  type: 'run_failed';
  error: string;
  failedStepId?: string;
}

/** Union of all events emitted during workflow execution. */
export type WorkflowEvent =
  | StepStartEvent
  | StepCompleteEvent
  | StepBlockedEvent
  | StepFailedEvent
  | RunCompleteEvent
  | RunFailedEvent;

// ---------------------------------------------------------------------------
// Connector interface
// ---------------------------------------------------------------------------

/**
 * A connector executes a single operation against an external service.
 */
export interface Connector {
  /** Unique connector name (e.g., 'gmail', 'calendar', 'shopify'). */
  name: string;

  /**
   * Execute an operation.
   *
   * @param operation - The operation to perform (e.g., 'send', 'read').
   * @param input     - Operation-specific input data.
   * @returns The output from the operation.
   */
  execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

/**
 * Registry that resolves connector names to Connector instances.
 */
export interface ConnectorRegistry {
  /**
   * Look up a connector by name.
   *
   * @param name - The connector name.
   * @returns The connector, or `undefined` if not registered.
   */
  get(name: string): Connector | undefined;
}

// ---------------------------------------------------------------------------
// Safety gate
// ---------------------------------------------------------------------------

/**
 * Result returned by a safety gate callback.
 */
export interface SafetyGateResult {
  /** The CORD decision. */
  decision: CordDecision;
  /** Risk score from 0 (safe) to 99 (dangerous). */
  score: number;
  /** Human-readable reason for the decision. */
  reason: string;
}

/**
 * Safety gate callback invoked before each step execution.
 * Returning a decision of 'BLOCK' or 'CHALLENGE' will prevent the step
 * from executing and move it to 'blocked' state.
 */
export type SafetyGate = (
  step: WorkflowStep,
  run: WorkflowRun,
) => Promise<SafetyGateResult>;

// ---------------------------------------------------------------------------
// WorkflowEngine
// ---------------------------------------------------------------------------

/**
 * WorkflowEngine executes a WorkflowRun's steps sequentially, yielding
 * typed events as an AsyncGenerator.
 *
 * @example
 * ```ts
 * const engine = new WorkflowEngine(registry, safetyGate);
 *
 * for await (const event of engine.execute(run)) {
 *   console.log(event.type, event);
 * }
 * ```
 */
export class WorkflowEngine {
  private readonly connectors: ConnectorRegistry;
  private readonly safetyGate: SafetyGate;
  private readonly stateMachine: StateMachine;

  /** Set to `true` when pause is requested. Checked between steps. */
  private pauseRequested = false;

  /** Set to `true` when resume is called. */
  private resumeRequested = false;

  /** Resolves when resume() is called, unblocking the execute loop. */
  private resumePromise: Promise<void> | null = null;
  private resumeResolve: (() => void) | null = null;

  /**
   * Create a new WorkflowEngine.
   *
   * @param connectors - Registry to look up connectors by name.
   * @param safetyGate - Callback invoked before each step to evaluate safety.
   */
  constructor(connectors: ConnectorRegistry, safetyGate: SafetyGate) {
    this.connectors = connectors;
    this.safetyGate = safetyGate;
    this.stateMachine = new StateMachine();
  }

  /**
   * Execute a workflow run, yielding events for each lifecycle change.
   *
   * Steps are executed sequentially. If a step is blocked by the safety gate,
   * execution stops at that step. If a step fails, the entire run fails.
   *
   * @param run - The WorkflowRun to execute (mutated in place).
   * @yields {WorkflowEvent} Events as the run progresses.
   */
  async *execute(run: WorkflowRun): AsyncGenerator<WorkflowEvent> {
    run.state = 'running';

    for (const step of run.steps) {
      // ---- Pause check ----
      if (this.pauseRequested) {
        run.state = 'paused';
        this.pauseRequested = false;

        // Create a promise that will be resolved when resume() is called
        this.resumePromise = new Promise<void>((resolve) => {
          this.resumeResolve = resolve;
        });

        await this.resumePromise;
        this.resumePromise = null;
        this.resumeResolve = null;
        this.resumeRequested = false;
        run.state = 'running';
      }

      // ---- Skip already-completed steps (for resume after block) ----
      if (step.status === 'completed') {
        continue;
      }

      // ---- Safety gate ----
      const gateResult = await this.safetyGate(step, run);
      step.cordDecision = gateResult.decision;
      step.cordScore = gateResult.score;

      if (gateResult.decision === 'BLOCK' || gateResult.decision === 'CHALLENGE') {
        this.applyTransition(step, 'start');
        this.applyTransition(step, 'block');

        yield this.event<StepBlockedEvent>(run, {
          type: 'step_blocked',
          stepId: step.id,
          cordDecision: gateResult.decision,
          cordScore: gateResult.score,
          reason: gateResult.reason,
        });

        // Run does not fail -- it waits for manual approval or skipping
        return;
      }

      // ---- Resolve connector ----
      const connector = this.connectors.get(step.connector);
      if (!connector) {
        const errorMsg = `Connector '${step.connector}' not found in registry`;
        step.status = 'failed';
        step.error = errorMsg;
        run.state = 'failed';
        run.error = errorMsg;
        run.endedAt = new Date().toISOString();

        yield this.event<StepFailedEvent>(run, {
          type: 'step_failed',
          stepId: step.id,
          error: errorMsg,
        });

        yield this.event<RunFailedEvent>(run, {
          type: 'run_failed',
          error: errorMsg,
          failedStepId: step.id,
        });
        return;
      }

      // ---- Execute step ----
      this.applyTransition(step, 'start');

      yield this.event<StepStartEvent>(run, {
        type: 'step_start',
        stepId: step.id,
        connector: step.connector,
        operation: step.operation,
      });

      const startTime = Date.now();

      try {
        const output = await connector.execute(step.operation, step.input);
        const durationMs = Date.now() - startTime;

        step.output = output;
        step.durationMs = durationMs;
        this.applyTransition(step, 'complete');

        yield this.event<StepCompleteEvent>(run, {
          type: 'step_complete',
          stepId: step.id,
          output,
          durationMs,
        });
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);

        step.durationMs = durationMs;
        step.error = errorMsg;
        this.applyTransition(step, 'fail');

        run.state = 'failed';
        run.error = errorMsg;
        run.endedAt = new Date().toISOString();

        yield this.event<StepFailedEvent>(run, {
          type: 'step_failed',
          stepId: step.id,
          error: errorMsg,
        });

        yield this.event<RunFailedEvent>(run, {
          type: 'run_failed',
          error: errorMsg,
          failedStepId: step.id,
        });
        return;
      }
    }

    // ---- All steps completed ----
    run.state = 'completed';
    run.endedAt = new Date().toISOString();

    yield this.event<RunCompleteEvent>(run, {
      type: 'run_complete',
    });
  }

  /**
   * Request the engine to pause after the current step completes.
   * The engine will suspend between steps and wait for `resume()`.
   */
  pause(): void {
    this.pauseRequested = true;
  }

  /**
   * Resume a paused engine. Has no effect if the engine is not paused.
   */
  resume(): void {
    this.resumeRequested = true;
    if (this.resumeResolve) {
      this.resumeResolve();
    }
  }

  /**
   * Apply a state-machine transition to a step, updating its status in place.
   *
   * @param step  - The step to transition.
   * @param event - The event to apply.
   */
  private applyTransition(step: WorkflowStep, event: StepEvent): void {
    step.status = this.stateMachine.transition(step.status, event);
  }

  /**
   * Helper to construct a typed event with common fields populated.
   */
  private event<T extends WorkflowEvent>(
    run: WorkflowRun,
    partial: Omit<T, 'timestamp' | 'runId'>,
  ): T {
    return {
      ...partial,
      timestamp: new Date().toISOString(),
      runId: run.id,
    } as T;
  }
}
