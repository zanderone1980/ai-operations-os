/**
 * Pipeline — End-to-end workflow orchestration.
 *
 * Wires together: Webhook → Task → Intent → Policy → Workflow → Safety Gate → Approval → Execute
 *
 * This is the core brain of AI Operations OS. When an event arrives (email,
 * calendar invite, social mention, order), the pipeline:
 *
 * 1. Creates a Task from the raw event
 * 2. Classifies intent (reply, schedule, post, fulfill, etc.)
 * 3. Evaluates policy rules to determine autonomy level
 * 4. Builds a workflow with ordered steps
 * 5. Runs each step through the CORD safety gate
 * 6. If CHALLENGE → creates an Approval request and waits
 * 7. If ALLOW → executes through the connector
 * 8. Records receipts for audit trail
 */

import type {
  Task, TaskSource, TaskIntent,
  WorkflowRun, WorkflowStep,
  Approval, CordDecision,
  Prediction, LearningEpisode,
} from '@ai-ops/shared-types';
import { createTask, createWorkflowRun, createStep, createApproval } from '@ai-ops/shared-types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineEvent {
  type:
    | 'task_created'
    | 'intent_classified'
    | 'policy_evaluated'
    | 'workflow_started'
    | 'step_evaluating'
    | 'step_allowed'
    | 'step_blocked'
    | 'step_approval_needed'
    | 'step_approved'
    | 'step_denied'
    | 'step_executing'
    | 'step_completed'
    | 'step_failed'
    | 'spark_prediction'
    | 'spark_learned'
    | 'workflow_completed'
    | 'workflow_failed';
  task?: Task;
  run?: WorkflowRun;
  step?: WorkflowStep;
  approval?: Approval;
  prediction?: Prediction;
  episode?: LearningEpisode;
  message: string;
  timestamp: string;
}

export interface PipelineConfig {
  /** Classify intent from text (sync or async) */
  classifyIntent: (text: string) => TaskIntent | Promise<TaskIntent>;

  /** Evaluate policy for a connector + operation */
  evaluatePolicy: (connector: string, operation: string, context?: Record<string, unknown>) => {
    autonomy: 'auto' | 'approve' | 'deny';
    risk: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
  };

  /** Evaluate CORD safety gate */
  evaluateSafety: (connector: string, operation: string, input: Record<string, unknown>) => {
    decision: CordDecision;
    score: number;
    reasons: string[];
  };

  /** Execute a connector operation */
  executeConnector: (connector: string, operation: string, input: Record<string, unknown>) => Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }>;

  /** Request approval from user (returns true if approved) */
  requestApproval: (approval: Approval) => Promise<'approved' | 'denied' | 'modified'>;

  /** Build workflow steps for a given task */
  buildWorkflow: (task: Task) => { workflowType: string; steps: Array<{ connector: string; operation: string; input: Record<string, unknown> }> };

  /** Optional SPARK hooks for predict/measure/learn cycle */
  spark?: {
    beforeStep?: (stepId: string, runId: string, connector: string, operation: string) => any;
    afterStep?: (step: WorkflowStep, runId: string, wasApproved?: boolean) => any;
  };
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Run the full pipeline for a raw incoming event.
 * Yields events at each stage for UI/logging.
 */
export async function* runPipeline(
  source: TaskSource,
  eventData: Record<string, unknown>,
  config: PipelineConfig,
): AsyncGenerator<PipelineEvent> {
  const now = () => new Date().toISOString();

  // ── 1. Create Task ───────────────────────────────────────────────
  const task = createTask({
    source,
    title: (eventData.subject as string) || (eventData.title as string) || `${source} event`,
    body: (eventData.body as string) || (eventData.snippet as string) || undefined,
    sourceId: (eventData.messageId as string) || (eventData.id as string)?.toString() || undefined,
    metadata: eventData,
  });

  yield { type: 'task_created', task, message: `Task created: ${task.title}`, timestamp: now() };

  // ── 2. Classify Intent ───────────────────────────────────────────
  const intentText = `${task.title} ${task.body || ''}`;
  task.intent = await config.classifyIntent(intentText);
  task.status = 'planned';

  yield {
    type: 'intent_classified',
    task,
    message: `Intent: ${task.intent}`,
    timestamp: now(),
  };

  // ── 3. Build Workflow ────────────────────────────────────────────
  const { workflowType, steps } = config.buildWorkflow(task);
  const run = createWorkflowRun(
    task.id,
    workflowType,
    steps.map((s) => createStep(s.connector, s.operation, s.input)),
  );

  task.status = 'running';
  run.state = 'running';

  yield {
    type: 'workflow_started',
    task,
    run,
    message: `Workflow "${workflowType}" started with ${run.steps.length} steps`,
    timestamp: now(),
  };

  // ── 4. Execute Steps ─────────────────────────────────────────────
  for (const step of run.steps) {
    step.status = 'running';

    yield {
      type: 'step_evaluating',
      task,
      run,
      step,
      message: `Evaluating: ${step.connector}.${step.operation}`,
      timestamp: now(),
    };

    // ── SPARK: beforeStep hook ───────────────────────────────────
    let sparkPrediction: any;
    if (config.spark?.beforeStep) {
      sparkPrediction = config.spark.beforeStep(step.id, run.id, step.connector, step.operation);
      if (sparkPrediction) {
        yield {
          type: 'spark_prediction',
          task, run, step,
          prediction: sparkPrediction,
          message: `SPARK prediction: score=${sparkPrediction.predictedScore} confidence=${sparkPrediction.confidence} category=${sparkPrediction.category}`,
          timestamp: now(),
        };
      }
    }

    // ── 4a. Policy check ─────────────────────────────────────────
    const policy = config.evaluatePolicy(step.connector, step.operation);

    if (policy.autonomy === 'deny') {
      step.status = 'blocked';
      step.error = `Policy denied: ${policy.reason}`;
      run.state = 'failed';
      run.error = step.error;
      run.endedAt = now();
      task.status = 'failed';

      // ── SPARK: afterStep hook (policy blocked) ──────────────────
      const sparkEpisodeBlocked = config.spark?.afterStep?.(step, run.id);
      if (sparkEpisodeBlocked) {
        yield {
          type: 'spark_learned',
          task, run, step,
          episode: sparkEpisodeBlocked,
          message: `SPARK learned: ${sparkEpisodeBlocked.adjustmentDirection} (${sparkEpisodeBlocked.reason})`,
          timestamp: now(),
        };
      }

      yield {
        type: 'step_blocked',
        task, run, step,
        message: `BLOCKED by policy: ${policy.reason}`,
        timestamp: now(),
      };
      yield { type: 'workflow_failed', task, run, message: run.error, timestamp: now() };
      return;
    }

    // ── 4b. CORD safety gate ─────────────────────────────────────
    const safety = config.evaluateSafety(step.connector, step.operation, step.input);
    step.cordDecision = safety.decision;
    step.cordScore = safety.score;

    if (safety.decision === 'BLOCK') {
      step.status = 'blocked';
      step.error = `CORD blocked: ${safety.reasons.join(', ')}`;
      run.state = 'failed';
      run.error = step.error;
      run.endedAt = now();
      task.status = 'failed';

      // ── SPARK: afterStep hook (CORD blocked) ────────────────────
      const sparkEpisodeCordBlocked = config.spark?.afterStep?.(step, run.id);
      if (sparkEpisodeCordBlocked) {
        yield {
          type: 'spark_learned',
          task, run, step,
          episode: sparkEpisodeCordBlocked,
          message: `SPARK learned: ${sparkEpisodeCordBlocked.adjustmentDirection} (${sparkEpisodeCordBlocked.reason})`,
          timestamp: now(),
        };
      }

      yield {
        type: 'step_blocked',
        task, run, step,
        message: `BLOCKED by CORD (score: ${safety.score}): ${safety.reasons.join(', ')}`,
        timestamp: now(),
      };
      yield { type: 'workflow_failed', task, run, message: run.error, timestamp: now() };
      return;
    }

    // ── 4c. Approval gate ────────────────────────────────────────
    const needsApproval = safety.decision === 'CHALLENGE' || policy.autonomy === 'approve';
    let wasApproved: boolean | undefined;

    if (needsApproval) {
      const preview = `${step.connector}.${step.operation}: ${JSON.stringify(step.input).slice(0, 200)}`;
      const reason = safety.decision === 'CHALLENGE'
        ? `CORD challenge (score: ${safety.score})`
        : `Policy requires approval: ${policy.reason}`;

      const approval = createApproval(
        step.id,
        task.id,
        policy.risk,
        reason,
        preview,
      );

      yield {
        type: 'step_approval_needed',
        task, run, step, approval,
        message: `Approval needed: ${reason}`,
        timestamp: now(),
      };

      // Wait for user decision
      const decision = await config.requestApproval(approval);

      if (decision === 'denied') {
        step.status = 'blocked';
        step.error = 'Denied by user';
        run.state = 'failed';
        run.error = 'User denied approval';
        run.endedAt = now();
        task.status = 'failed';
        wasApproved = false;

        // ── SPARK: afterStep hook (denied) ────────────────────────
        const sparkEpisodeDenied = config.spark?.afterStep?.(step, run.id, wasApproved);
        if (sparkEpisodeDenied) {
          yield {
            type: 'spark_learned',
            task, run, step,
            episode: sparkEpisodeDenied,
            message: `SPARK learned: ${sparkEpisodeDenied.adjustmentDirection} (${sparkEpisodeDenied.reason})`,
            timestamp: now(),
          };
        }

        yield { type: 'step_denied', task, run, step, approval, message: 'User denied', timestamp: now() };
        yield { type: 'workflow_failed', task, run, message: run.error, timestamp: now() };
        return;
      }

      wasApproved = true;
      step.status = 'approved';
      yield { type: 'step_approved', task, run, step, approval, message: 'User approved', timestamp: now() };
    } else {
      yield {
        type: 'step_allowed',
        task, run, step,
        message: `Auto-allowed: ${step.connector}.${step.operation} (score: ${safety.score})`,
        timestamp: now(),
      };
    }

    // ── 4d. Execute ──────────────────────────────────────────────
    yield {
      type: 'step_executing',
      task, run, step,
      message: `Executing: ${step.connector}.${step.operation}`,
      timestamp: now(),
    };

    const startTime = Date.now();
    const result = await config.executeConnector(step.connector, step.operation, step.input);
    step.durationMs = Date.now() - startTime;

    if (!result.success) {
      step.status = 'failed';
      step.error = result.error || 'Connector returned failure';
      run.state = 'failed';
      run.error = `Step failed: ${step.error}`;
      run.endedAt = now();
      task.status = 'failed';

      // ── SPARK: afterStep hook (failed) ──────────────────────────
      const sparkEpisodeFailed = config.spark?.afterStep?.(step, run.id, wasApproved);
      if (sparkEpisodeFailed) {
        yield {
          type: 'spark_learned',
          task, run, step,
          episode: sparkEpisodeFailed,
          message: `SPARK learned: ${sparkEpisodeFailed.adjustmentDirection} (${sparkEpisodeFailed.reason})`,
          timestamp: now(),
        };
      }

      yield { type: 'step_failed', task, run, step, message: step.error, timestamp: now() };
      yield { type: 'workflow_failed', task, run, message: run.error, timestamp: now() };
      return;
    }

    step.output = result.data;
    step.status = 'completed';

    // ── SPARK: afterStep hook (completed) ──────────────────────────
    const sparkEpisode = config.spark?.afterStep?.(step, run.id, wasApproved);
    if (sparkEpisode) {
      yield {
        type: 'spark_learned',
        task, run, step,
        episode: sparkEpisode,
        message: `SPARK learned: ${sparkEpisode.adjustmentDirection} (${sparkEpisode.reason})`,
        timestamp: now(),
      };
    }

    yield {
      type: 'step_completed',
      task, run, step,
      message: `Completed: ${step.connector}.${step.operation} (${step.durationMs}ms)`,
      timestamp: now(),
    };
  }

  // ── 5. Done ──────────────────────────────────────────────────────
  run.state = 'completed';
  run.endedAt = now();
  task.status = 'completed';

  yield {
    type: 'workflow_completed',
    task, run,
    message: `Workflow "${workflowType}" completed — all ${run.steps.length} steps succeeded`,
    timestamp: now(),
  };
}

// ── Default Workflow Builder ─────────────────────────────────────────────────

/**
 * Default workflow builder — maps task intent to a standard workflow.
 */
export function defaultBuildWorkflow(task: Task): {
  workflowType: string;
  steps: Array<{ connector: string; operation: string; input: Record<string, unknown> }>;
} {
  switch (task.intent) {
    case 'reply':
      return {
        workflowType: 'email-reply',
        steps: [
          {
            connector: 'gmail',
            operation: 'read',
            input: { messageId: task.sourceId || '' },
          },
          {
            connector: 'gmail',
            operation: 'reply',
            input: {
              threadId: (task.metadata?.threadId as string) || '',
              body: '[AI-drafted reply — requires approval]',
            },
          },
        ],
      };

    case 'schedule':
      return {
        workflowType: 'calendar-respond',
        steps: [
          {
            connector: 'calendar',
            operation: 'check_availability',
            input: {
              startTime: (task.metadata?.startTime as string) || '',
              endTime: (task.metadata?.endTime as string) || '',
            },
          },
          {
            connector: 'calendar',
            operation: 'create_event',
            input: {
              summary: task.title,
              startTime: (task.metadata?.startTime as string) || '',
              endTime: (task.metadata?.endTime as string) || '',
            },
          },
        ],
      };

    case 'post':
      return {
        workflowType: 'social-post',
        steps: [
          {
            connector: 'x-twitter',
            operation: 'post',
            input: { content: task.body || task.title },
          },
        ],
      };

    case 'fulfill':
      return {
        workflowType: 'order-fulfill',
        steps: [
          {
            connector: 'shopify',
            operation: 'get_order',
            input: { orderId: task.sourceId || '' },
          },
          {
            connector: 'shopify',
            operation: 'fulfill_order',
            input: { orderId: task.sourceId || '' },
          },
        ],
      };

    default:
      return {
        workflowType: 'generic',
        steps: [
          {
            connector: 'gmail',
            operation: 'read',
            input: { messageId: task.sourceId || '' },
          },
        ],
      };
  }
}
