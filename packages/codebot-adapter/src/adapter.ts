/**
 * CodeBotAdapter — Maps workflow steps to CodeBot tool calls.
 *
 * Provides an abstraction over codebot-ai for executing workflow steps
 * as CodeBot tool invocations. If codebot-ai is not installed (it is an
 * optional dependency), the adapter degrades gracefully and returns mock
 * results so the system can still operate in simulation mode.
 */

import type { WorkflowStep } from '@ai-ops/shared-types';

// ---------------------------------------------------------------------------
// Graceful codebot-ai import
// ---------------------------------------------------------------------------

let codebot: any = null;
try {
  codebot = require('codebot-ai');
} catch {
  /* codebot-ai not installed */
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

  /** Whether this result came from a mock (codebot-ai not available). */
  mock: boolean;
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
// CodeBotAdapter
// ---------------------------------------------------------------------------

/**
 * CodeBotAdapter bridges workflow steps from the AI Operations OS to
 * CodeBot tool calls. Each WorkflowStep is mapped to a CodeBot tool
 * invocation based on its connector and operation.
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
 * console.log(result.success); // true (mock)
 * ```
 */
export class CodeBotAdapter {
  /** Whether codebot-ai is available for real execution. */
  private readonly codebotAvailable: boolean;

  constructor() {
    this.codebotAvailable = codebot !== null;
    if (!this.codebotAvailable) {
      console.warn(
        '[CodeBotAdapter] codebot-ai is not installed. Steps will return mock results.',
      );
    }
  }

  /**
   * Execute a workflow step by mapping it to a CodeBot tool call.
   *
   * @param step - The workflow step to execute.
   * @returns A promise resolving to the StepResult.
   *
   * @remarks
   * STUB: Currently logs intent and returns a mock result. When codebot-ai
   * is installed, this will delegate to the real CodeBot tool execution engine.
   */
  async executeStep(step: WorkflowStep): Promise<StepResult> {
    const toolName = this.mapStepToTool(step);
    const startTime = Date.now();

    console.log(
      `[CodeBotAdapter] Executing step ${step.id}: ${step.connector}.${step.operation} -> ${toolName}`,
    );

    if (!this.codebotAvailable) {
      return this.mockExecution(step, toolName, startTime);
    }

    try {
      const result = await codebot.executeTool(toolName, {
        connector: step.connector,
        operation: step.operation,
        ...step.input,
      });

      return {
        success: true,
        output: typeof result === 'object' && result !== null ? result : { result },
        durationMs: Date.now() - startTime,
        mock: false,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: {},
        durationMs: Date.now() - startTime,
        error: `CodeBot execution failed: ${message}`,
        mock: false,
      };
    }
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
   * Produce a mock execution result when codebot-ai is not installed.
   *
   * @param step      - The workflow step being executed.
   * @param toolName  - The resolved CodeBot tool name.
   * @param startTime - Timestamp when execution started.
   * @returns A mock StepResult.
   */
  private mockExecution(
    step: WorkflowStep,
    toolName: string,
    startTime: number,
  ): StepResult {
    console.log(
      `[CodeBotAdapter] Mock execution for tool '${toolName}' ` +
        `(connector=${step.connector}, operation=${step.operation})`,
    );

    return {
      success: true,
      output: {
        _mock: true,
        tool: toolName,
        connector: step.connector,
        operation: step.operation,
        message: `Mock result for ${step.connector}.${step.operation}`,
      },
      durationMs: Date.now() - startTime,
      mock: true,
    };
  }
}
