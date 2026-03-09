import { randomUUID } from 'node:crypto';

/**
 * CodeBotAdapter — Maps workflow steps to CodeBot tool calls.
 *
 * Provides an abstraction over codebot-ai for executing workflow steps
 * as CodeBot tool invocations. If codebot-ai is not installed (it is an
 * optional dependency), the adapter degrades gracefully and returns
 * realistic simulated results so the system can operate in simulation
 * mode with plausible timing, outputs, and metadata.
 */

import type { WorkflowStep } from '@ai-ops/shared-types';

// ---------------------------------------------------------------------------
// Graceful codebot-ai import
// ---------------------------------------------------------------------------

let codebot: any = null;
try {
  codebot = require('codebot-ai');
} catch {
  /* codebot-ai not installed — simulation mode will be used */
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of executing a single workflow step through CodeBot. */
export interface StepResult {
  /** Whether the step executed successfully. */
  success: boolean;

  /** Output data from the step execution. */
  output: Record<string, unknown>;

  /** Duration of the execution in milliseconds. */
  durationMs: number;

  /** Error message if the step failed. */
  error?: string;

  /** Whether this result came from simulation (codebot-ai not available). */
  simulated: boolean;
}

/**
 * Mapping from connector operations to CodeBot tool names.
 * CodeBot uses its own tool naming conventions.
 */
const OPERATION_TO_TOOL: Record<string, string> = {
  send: 'messaging.send',
  reply: 'messaging.reply',
  forward: 'messaging.forward',
  read: 'data.read',
  list: 'data.list',
  search: 'data.search',
  get: 'data.get',
  create_event: 'calendar.create',
  update_event: 'calendar.update',
  cancel_event: 'calendar.cancel',
  post: 'social.publish',
  tweet: 'social.publish',
  delete: 'resource.delete',
  remove: 'resource.remove',
  archive: 'resource.archive',
  refund: 'commerce.refund',
  charge: 'commerce.charge',
  transfer: 'finance.transfer',
};

// ---------------------------------------------------------------------------
// Simulation helpers
// ---------------------------------------------------------------------------

/** Wait for the given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a plausible simulated output for a given connector + operation.
 *
 * Returns a record that mimics what a real connector would return so that
 * downstream receipt builders, loggers, and UIs see realistic data shapes.
 */
function generateSimulatedOutput(
  step: WorkflowStep,
  toolName: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    simulated: true,
    tool: toolName,
    connector: step.connector,
    operation: step.operation,
    timestamp: new Date().toISOString(),
  };

  const op = step.operation;

  // Messaging operations
  if (op === 'send' || op === 'reply' || op === 'forward') {
    return {
      ...base,
      messageId: `sim-msg-${randomUUID().slice(0, 8)}`,
      status: 'sent',
      to: step.input.to ?? step.input.recipient ?? 'unknown@example.com',
      threadId: step.input.threadId ?? null,
    };
  }

  // Read / get operations
  if (op === 'read' || op === 'get') {
    return {
      ...base,
      found: true,
      itemCount: 1,
      data: step.input.id
        ? { id: step.input.id, content: '[simulated content]' }
        : { content: '[simulated content]' },
    };
  }

  // List / search operations
  if (op === 'list' || op === 'search') {
    const count = Math.floor(Math.random() * 8) + 1;
    return {
      ...base,
      totalResults: count,
      items: Array.from({ length: Math.min(count, 3) }, (_, i) => ({
        id: `sim-item-${i + 1}`,
        title: `Simulated result ${i + 1}`,
      })),
      hasMore: count > 3,
    };
  }

  // Calendar operations
  if (op === 'create_event' || op === 'update_event') {
    return {
      ...base,
      eventId: `sim-evt-${randomUUID().slice(0, 8)}`,
      status: op === 'create_event' ? 'created' : 'updated',
      title: (step.input.title as string) ?? (step.input.subject as string) ?? 'Simulated Event',
      start: step.input.start ?? new Date().toISOString(),
    };
  }

  if (op === 'cancel_event') {
    return {
      ...base,
      eventId: (step.input.eventId as string) ?? `sim-evt-${randomUUID().slice(0, 8)}`,
      status: 'cancelled',
    };
  }

  // Social / publish operations
  if (op === 'post' || op === 'tweet') {
    return {
      ...base,
      postId: `sim-post-${randomUUID().slice(0, 8)}`,
      status: 'published',
      url: `https://${step.connector}.example.com/post/sim-${Date.now()}`,
    };
  }

  // Destructive operations
  if (op === 'delete' || op === 'remove' || op === 'archive') {
    return {
      ...base,
      targetId: (step.input.id as string) ?? 'unknown',
      status: op === 'archive' ? 'archived' : 'deleted',
    };
  }

  // Financial operations
  if (op === 'refund' || op === 'charge' || op === 'transfer') {
    return {
      ...base,
      transactionId: `sim-txn-${randomUUID().slice(0, 8)}`,
      status: 'processed',
      amount: step.input.amount ?? 0,
      currency: step.input.currency ?? 'USD',
    };
  }

  // Fallback — generic simulated output
  return {
    ...base,
    status: 'completed',
    message: `Simulated execution of ${step.connector}.${step.operation}`,
  };
}

/**
 * Compute a realistic simulated execution delay based on operation type.
 * More "expensive" operations (searches, network calls) take longer.
 */
function simulatedDelayMs(operation: string): number {
  switch (operation) {
    case 'search':
    case 'list':
      return 60 + Math.floor(Math.random() * 80);
    case 'send':
    case 'reply':
    case 'forward':
    case 'post':
    case 'tweet':
      return 40 + Math.floor(Math.random() * 60);
    case 'charge':
    case 'refund':
    case 'transfer':
      return 80 + Math.floor(Math.random() * 120);
    default:
      return 20 + Math.floor(Math.random() * 40);
  }
}

// ---------------------------------------------------------------------------
// CodeBotAdapter
// ---------------------------------------------------------------------------

/**
 * CodeBotAdapter bridges workflow steps from the AI Operations OS to
 * CodeBot tool calls. Each WorkflowStep is mapped to a CodeBot tool
 * invocation based on its connector and operation.
 *
 * When codebot-ai is installed the adapter delegates directly to the
 * real tool execution engine. When it is not installed (optional dep),
 * the adapter produces realistic simulated results with plausible
 * outputs, timing, and metadata so the rest of the system can operate
 * end-to-end in simulation mode.
 *
 * @example
 * ```ts
 * const adapter = new CodeBotAdapter();
 * const result = await adapter.executeStep({
 *   id: 'step-1',
 *   connector: 'gmail',
 *   operation: 'send',
 *   input: { to: 'user@example.com', body: 'Hello' },
 *   status: 'pending',
 * });
 * console.log(result.success);    // true
 * console.log(result.simulated);  // true when codebot-ai is absent
 * ```
 */
export class CodeBotAdapter {
  /** Whether codebot-ai is available for real execution. */
  private readonly codebotAvailable: boolean;

  constructor() {
    this.codebotAvailable = codebot !== null;
    if (!this.codebotAvailable) {
      console.warn(
        '[CodeBotAdapter] codebot-ai is not installed. Steps will return simulated results.',
      );
    }
  }

  /**
   * Execute a workflow step by mapping it to a CodeBot tool call.
   *
   * When codebot-ai is available, calls the real tool execution engine.
   * When it is not, produces a realistic simulated StepResult with
   * plausible output data, timing delay, and metadata.
   *
   * @param step - The workflow step to execute.
   * @returns A promise resolving to the StepResult.
   */
  async executeStep(step: WorkflowStep): Promise<StepResult> {
    const toolName = this.mapStepToTool(step);
    const startTime = Date.now();

    console.log(
      `[CodeBotAdapter] Executing step ${step.id}: ${step.connector}.${step.operation} -> ${toolName}`,
    );

    if (!this.codebotAvailable) {
      return this.simulateExecution(step, toolName, startTime);
    }

    // ----- Real codebot-ai execution path -----
    try {
      const result = await codebot.executeTool(toolName, {
        connector: step.connector,
        operation: step.operation,
        ...step.input,
      });

      return {
        success: true,
        output:
          typeof result === 'object' && result !== null ? result : { result },
        durationMs: Date.now() - startTime,
        simulated: false,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: {},
        durationMs: Date.now() - startTime,
        error: `CodeBot execution failed: ${message}`,
        simulated: false,
      };
    }
  }

  /**
   * Execute multiple workflow steps in sequence, returning all results.
   *
   * Stops early if a step fails and `haltOnError` is true (the default).
   *
   * @param steps       - Ordered list of workflow steps.
   * @param haltOnError - If true (default), stop on first failure.
   * @returns An array of StepResults, one per executed step.
   */
  async executeSteps(
    steps: WorkflowStep[],
    haltOnError = true,
  ): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const step of steps) {
      const result = await this.executeStep(step);
      results.push(result);
      if (!result.success && haltOnError) {
        break;
      }
    }
    return results;
  }

  /**
   * Check whether codebot-ai is available.
   *
   * @returns True if codebot-ai was successfully loaded.
   */
  isAvailable(): boolean {
    return this.codebotAvailable;
  }

  /**
   * Map a workflow step to its corresponding CodeBot tool name.
   *
   * @param step - The workflow step to map.
   * @returns The CodeBot tool name string.
   */
  private mapStepToTool(step: WorkflowStep): string {
    const mapped = OPERATION_TO_TOOL[step.operation];
    if (mapped) {
      return mapped;
    }
    // Fallback: use connector.operation as the tool name
    return `${step.connector}.${step.operation}`;
  }

  /**
   * Produce a realistic simulated execution result when codebot-ai is
   * not installed.
   *
   * The simulation:
   * 1. Applies a realistic delay based on operation type.
   * 2. Generates plausible output data matching the connector/operation.
   * 3. Marks the result with `simulated: true`.
   *
   * @param step      - The workflow step being executed.
   * @param toolName  - The resolved CodeBot tool name.
   * @param startTime - Timestamp when execution started.
   * @returns A simulated StepResult.
   */
  private async simulateExecution(
    step: WorkflowStep,
    toolName: string,
    startTime: number,
  ): Promise<StepResult> {
    console.log(
      `[CodeBotAdapter] Simulating tool '${toolName}' ` +
        `(connector=${step.connector}, operation=${step.operation})`,
    );

    // Introduce realistic latency
    await delay(simulatedDelayMs(step.operation));

    const output = generateSimulatedOutput(step, toolName);

    return {
      success: true,
      output,
      durationMs: Date.now() - startTime,
      simulated: true,
    };
  }
}
