/**
 * CodeBotExecutor — Runs a CodeBot agent for complex multi-tool tasks.
 *
 * Provides an async generator interface that yields execution events
 * as the CodeBot agent progresses through a prompt. Events include
 * progress updates, tool calls, results, and errors.
 *
 * NOTE: This is a stub implementation. Real CodeBot agent execution
 * will be connected when codebot-ai is integrated.
 */

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

/** Event types emitted during CodeBot execution. */
export type ExecutionEventType = 'progress' | 'tool_call' | 'result' | 'error';

/** An event emitted during CodeBot agent execution. */
export interface ExecutionEvent {
  /** The type of execution event. */
  type: ExecutionEventType;

  /** Human-readable message describing the event. */
  message: string;
}

/** Options for configuring a CodeBot execution run. */
export interface ExecutorOptions {
  /** Root directory of the project for file system operations. */
  projectRoot?: string;
}

// ---------------------------------------------------------------------------
// CodeBotExecutor
// ---------------------------------------------------------------------------

/**
 * CodeBotExecutor runs a CodeBot agent session for complex tasks that
 * require multiple tool invocations. It yields ExecutionEvents via an
 * async generator so callers can stream progress in real time.
 *
 * @example
 * ```ts
 * const executor = new CodeBotExecutor();
 * for await (const event of executor.run('Refactor the utils module')) {
 *   console.log(`[${event.type}] ${event.message}`);
 * }
 * ```
 */
export class CodeBotExecutor {
  /** Whether codebot-ai is available for real execution. */
  private readonly codebotAvailable: boolean;

  constructor() {
    this.codebotAvailable = codebot !== null;
    if (!this.codebotAvailable) {
      console.warn(
        '[CodeBotExecutor] codebot-ai is not installed. Runs will yield mock events.',
      );
    }
  }

  /**
   * Run a CodeBot agent for the given prompt.
   *
   * Yields ExecutionEvent objects as the agent progresses. The generator
   * completes when the agent finishes or encounters a fatal error.
   *
   * @param prompt  - The task prompt for the CodeBot agent.
   * @param options - Optional configuration for the run.
   * @yields ExecutionEvent objects describing agent progress.
   *
   * @remarks
   * STUB: Currently yields a sequence of mock events to demonstrate
   * the async generator interface. Real CodeBot agent execution will
   * be wired up when codebot-ai is integrated.
   */
  async *run(
    prompt: string,
    options?: ExecutorOptions,
  ): AsyncGenerator<ExecutionEvent> {
    const projectRoot = options?.projectRoot ?? process.cwd();

    yield {
      type: 'progress',
      message: `Starting CodeBot agent (project: ${projectRoot})`,
    };

    if (!this.codebotAvailable) {
      yield* this.mockRun(prompt, projectRoot);
      return;
    }

    // Real codebot-ai execution path
    try {
      yield {
        type: 'progress',
        message: `Initializing CodeBot agent with prompt: "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`,
      };

      const agent = codebot.createAgent({
        prompt,
        projectRoot,
      });

      for await (const event of agent.stream()) {
        if (event.type === 'tool_use') {
          yield {
            type: 'tool_call',
            message: `Tool call: ${event.tool}(${JSON.stringify(event.input).substring(0, 100)})`,
          };
        } else if (event.type === 'text') {
          yield {
            type: 'progress',
            message: event.text,
          };
        } else if (event.type === 'result') {
          yield {
            type: 'result',
            message: typeof event.output === 'string' ? event.output : JSON.stringify(event.output),
          };
        } else if (event.type === 'error') {
          yield {
            type: 'error',
            message: event.message ?? 'Unknown CodeBot error',
          };
        }
      }

      yield {
        type: 'result',
        message: 'CodeBot agent completed successfully.',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      yield {
        type: 'error',
        message: `CodeBot agent failed: ${message}`,
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
   * Produce mock execution events when codebot-ai is not installed.
   *
   * @param prompt      - The task prompt.
   * @param projectRoot - The project root directory.
   * @yields Mock ExecutionEvent objects.
   */
  private async *mockRun(
    prompt: string,
    projectRoot: string,
  ): AsyncGenerator<ExecutionEvent> {
    yield {
      type: 'progress',
      message: `[Mock] Analyzing prompt: "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`,
    };

    yield {
      type: 'tool_call',
      message: `[Mock] Tool call: file.read(${projectRoot}/src/index.ts)`,
    };

    yield {
      type: 'progress',
      message: '[Mock] Processing task...',
    };

    yield {
      type: 'result',
      message: '[Mock] CodeBot agent completed (mock mode — codebot-ai not installed).',
    };
  }
}
