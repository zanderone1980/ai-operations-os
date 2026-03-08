/**
 * Executor — Workflow step executor.
 *
 * Takes a WorkflowRun, iterates through steps, evaluates each through
 * the CORD safety gate, runs through connectors, and manages approvals.
 */

import type { WorkflowRun, WorkflowStep, CordDecision } from '@ai-ops/shared-types';

export interface ExecutorOptions {
  /** Callback to evaluate safety before execution */
  safetyGate?: (connector: string, operation: string, input: Record<string, unknown>) => {
    allowed: boolean;
    decision: CordDecision;
    score: number;
    reasons: string[];
    requiresApproval: boolean;
  };

  /** Callback to execute a connector operation */
  executeConnector?: (connector: string, operation: string, input: Record<string, unknown>) => Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }>;

  /** Callback to request human approval */
  requestApproval?: (step: WorkflowStep, reason: string) => Promise<boolean>;
}

export interface ExecutorEvent {
  type: 'step_start' | 'step_complete' | 'step_blocked' | 'step_failed' |
        'approval_requested' | 'approval_granted' | 'approval_denied' |
        'run_complete' | 'run_failed';
  step?: WorkflowStep;
  run?: WorkflowRun;
  message?: string;
  cordDecision?: CordDecision;
  cordScore?: number;
}

/**
 * Execute a workflow run step by step.
 */
export class WorkflowExecutor {
  private options: ExecutorOptions;

  constructor(options: ExecutorOptions = {}) {
    this.options = options;
  }

  /**
   * Execute a workflow run. Yields events for each step.
   */
  async *execute(run: WorkflowRun): AsyncGenerator<ExecutorEvent> {
    run.state = 'running';

    for (const step of run.steps) {
      // Skip already completed steps (for resume)
      if (step.status === 'completed') continue;

      step.status = 'running';
      yield { type: 'step_start', step, run };

      const startTime = Date.now();

      // ── Safety gate ──────────────────────────────────────────────
      if (this.options.safetyGate) {
        const gate = this.options.safetyGate(step.connector, step.operation, step.input);
        step.cordDecision = gate.decision;
        step.cordScore = gate.score;

        if (!gate.allowed) {
          step.status = 'blocked';
          step.error = `Blocked by CORD: ${gate.reasons.join(', ')}`;
          yield {
            type: 'step_blocked',
            step,
            run,
            cordDecision: gate.decision,
            cordScore: gate.score,
            message: step.error,
          };

          // Fail the entire run on block
          run.state = 'failed';
          run.error = `Step blocked: ${step.connector}.${step.operation}`;
          run.endedAt = new Date().toISOString();
          yield { type: 'run_failed', run, message: run.error };
          return;
        }

        // ── Approval gate ────────────────────────────────────────
        if (gate.requiresApproval) {
          yield {
            type: 'approval_requested',
            step,
            message: `${step.connector}.${step.operation} requires approval (score: ${gate.score})`,
          };

          if (this.options.requestApproval) {
            const approved = await this.options.requestApproval(
              step,
              `CORD decision: ${gate.decision} (score: ${gate.score})`,
            );

            if (!approved) {
              step.status = 'blocked';
              step.error = 'Denied by user';
              yield { type: 'approval_denied', step, message: 'User denied approval' };

              run.state = 'failed';
              run.error = 'User denied approval';
              run.endedAt = new Date().toISOString();
              yield { type: 'run_failed', run, message: run.error };
              return;
            }

            step.status = 'approved';
            yield { type: 'approval_granted', step, message: 'User approved' };
          }
        }
      }

      // ── Execute connector ──────────────────────────────────────
      try {
        if (this.options.executeConnector) {
          const result = await this.options.executeConnector(
            step.connector,
            step.operation,
            step.input,
          );

          step.output = result.data;
          step.durationMs = Date.now() - startTime;

          if (!result.success) {
            step.status = 'failed';
            step.error = result.error || 'Connector returned failure';
            yield { type: 'step_failed', step, run, message: step.error };

            run.state = 'failed';
            run.error = `Step failed: ${step.connector}.${step.operation} — ${step.error}`;
            run.endedAt = new Date().toISOString();
            yield { type: 'run_failed', run, message: run.error };
            return;
          }
        }

        step.status = 'completed';
        step.durationMs = Date.now() - startTime;
        yield { type: 'step_complete', step, run };
      } catch (err) {
        step.status = 'failed';
        step.error = err instanceof Error ? err.message : String(err);
        step.durationMs = Date.now() - startTime;
        yield { type: 'step_failed', step, run, message: step.error };

        run.state = 'failed';
        run.error = `Step threw: ${step.error}`;
        run.endedAt = new Date().toISOString();
        yield { type: 'run_failed', run, message: run.error };
        return;
      }
    }

    // All steps completed
    run.state = 'completed';
    run.endedAt = new Date().toISOString();
    yield { type: 'run_complete', run };
  }
}
