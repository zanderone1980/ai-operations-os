/**
 * CodeBotExecutor — Runs a CodeBot agent for complex multi-tool tasks.
 *
 * Provides an async generator interface that yields execution events
 * as the CodeBot agent progresses through a prompt. Events include
 * progress updates, tool calls, results, and errors.
 *
 * When codebot-ai is installed, delegates to the real agent runtime.
 * When codebot-ai is unavailable, produces a realistic simulation
 * with plausible timing, tool calls, and progress events so that
 * downstream consumers (UIs, loggers, receipt builders) can exercise
 * the full event contract without requiring the real dependency.
 */

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

/** Event types emitted during CodeBot execution. */
export type ExecutionEventType = 'progress' | 'tool_call' | 'result' | 'error';

/** An event emitted during CodeBot agent execution. */
export interface ExecutionEvent {
  /** The type of execution event. */
  type: ExecutionEventType;

  /** Human-readable message describing the event. */
  message: string;

  /** Optional structured metadata attached to this event. */
  metadata?: Record<string, unknown>;
}

/** Options for configuring a CodeBot execution run. */
export interface ExecutorOptions {
  /** Root directory of the project for file system operations. */
  projectRoot?: string;

  /** Maximum time in ms before the run is forcibly aborted. Defaults to 120 000 (2 min). */
  timeoutMs?: number;

  /** If true, simulation mode is used even when codebot-ai is installed. */
  forceSimulation?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Derive a short summary of the prompt (first sentence or first 120 chars). */
function promptSummary(prompt: string): string {
  const firstSentence = prompt.split(/[.\n]/)[0]?.trim() ?? prompt;
  return firstSentence.length > 120
    ? firstSentence.substring(0, 117) + '...'
    : firstSentence;
}

/**
 * Infer plausible simulated tool calls from the prompt text.
 *
 * Parses the prompt for keywords that suggest which tools the agent
 * would invoke (file reads, searches, writes, tests, etc.) and returns
 * an ordered list of simulated tool invocation descriptions.
 */
function inferSimulatedToolCalls(
  prompt: string,
  projectRoot: string,
): Array<{ tool: string; description: string; delayMs: number }> {
  const lower = prompt.toLowerCase();
  const calls: Array<{ tool: string; description: string; delayMs: number }> = [];

  // Phase 1 — Reconnaissance: the agent typically reads relevant files first
  if (lower.includes('refactor') || lower.includes('rewrite') || lower.includes('update')) {
    calls.push({
      tool: 'file.search',
      description: `file.search({ pattern: "src/**/*.ts", cwd: "${projectRoot}" })`,
      delayMs: 80,
    });
    calls.push({
      tool: 'file.read',
      description: `file.read({ path: "${projectRoot}/src/index.ts" })`,
      delayMs: 40,
    });
  }

  if (lower.includes('test') || lower.includes('spec')) {
    calls.push({
      tool: 'file.search',
      description: `file.search({ pattern: "**/*.test.ts", cwd: "${projectRoot}" })`,
      delayMs: 60,
    });
  }

  if (lower.includes('bug') || lower.includes('fix') || lower.includes('error')) {
    calls.push({
      tool: 'file.search',
      description: `file.search({ pattern: "src/**/*", cwd: "${projectRoot}" })`,
      delayMs: 70,
    });
    calls.push({
      tool: 'file.read',
      description: `file.read({ path: "${projectRoot}/src/index.ts" })`,
      delayMs: 35,
    });
  }

  if (lower.includes('send') || lower.includes('email') || lower.includes('message')) {
    calls.push({
      tool: 'messaging.send',
      description: 'messaging.send({ draft: true })',
      delayMs: 90,
    });
  }

  if (lower.includes('deploy') || lower.includes('publish')) {
    calls.push({
      tool: 'shell.exec',
      description: 'shell.exec({ command: "npm run build" })',
      delayMs: 150,
    });
  }

  // Phase 2 — Action: if nothing matched, produce a generic analysis flow
  if (calls.length === 0) {
    calls.push(
      {
        tool: 'file.search',
        description: `file.search({ pattern: "**/*", cwd: "${projectRoot}" })`,
        delayMs: 60,
      },
      {
        tool: 'file.read',
        description: `file.read({ path: "${projectRoot}/package.json" })`,
        delayMs: 30,
      },
      {
        tool: 'agent.analyze',
        description: `agent.analyze({ prompt: "${promptSummary(prompt)}" })`,
        delayMs: 100,
      },
    );
  }

  return calls;
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
        '[CodeBotExecutor] codebot-ai is not installed. Runs will use simulation mode.',
      );
    }
  }

  /**
   * Run a CodeBot agent for the given prompt.
   *
   * Yields ExecutionEvent objects as the agent progresses. The generator
   * completes when the agent finishes or encounters a fatal error.
   *
   * When codebot-ai is installed (and `forceSimulation` is not set),
   * execution is delegated to the real CodeBot agent runtime. Otherwise
   * a realistic simulation is produced with plausible tool calls,
   * timing delays, and structured metadata.
   *
   * @param prompt  - The task prompt for the CodeBot agent.
   * @param options - Optional configuration for the run.
   * @yields ExecutionEvent objects describing agent progress.
   */
  async *run(
    prompt: string,
    options?: ExecutorOptions,
  ): AsyncGenerator<ExecutionEvent> {
    const projectRoot = options?.projectRoot ?? process.cwd();
    const useSimulation = options?.forceSimulation || !this.codebotAvailable;

    yield {
      type: 'progress',
      message: `Starting CodeBot agent (project: ${projectRoot})`,
      metadata: {
        projectRoot,
        mode: useSimulation ? 'simulation' : 'live',
        codebotAvailable: this.codebotAvailable,
      },
    };

    if (useSimulation) {
      yield* this.simulatedRun(prompt, projectRoot);
      return;
    }

    // ----- Real codebot-ai execution path -----
    yield* this.realRun(prompt, projectRoot, options?.timeoutMs);
  }

  /**
   * Check whether codebot-ai is available.
   *
   * @returns True if codebot-ai was successfully loaded.
   */
  isAvailable(): boolean {
    return this.codebotAvailable;
  }

  // -------------------------------------------------------------------------
  // Real execution (codebot-ai installed)
  // -------------------------------------------------------------------------

  /**
   * Execute a prompt through the real codebot-ai agent runtime and yield
   * events as they arrive from the agent stream.
   */
  private async *realRun(
    prompt: string,
    projectRoot: string,
    timeoutMs?: number,
  ): AsyncGenerator<ExecutionEvent> {
    const timeout = timeoutMs ?? 120_000;

    try {
      yield {
        type: 'progress',
        message: `Initializing CodeBot agent with prompt: "${promptSummary(prompt)}"`,
        metadata: { timeoutMs: timeout },
      };

      const agent = codebot.createAgent({
        prompt,
        projectRoot,
        ...(timeout ? { timeoutMs: timeout } : {}),
      });

      for await (const event of agent.stream()) {
        if (event.type === 'tool_use') {
          yield {
            type: 'tool_call',
            message: `Tool call: ${event.tool}(${JSON.stringify(event.input).substring(0, 200)})`,
            metadata: { tool: event.tool, input: event.input },
          };
        } else if (event.type === 'text') {
          yield {
            type: 'progress',
            message: event.text,
          };
        } else if (event.type === 'result') {
          yield {
            type: 'result',
            message:
              typeof event.output === 'string'
                ? event.output
                : JSON.stringify(event.output),
            metadata: { output: event.output },
          };
        } else if (event.type === 'error') {
          yield {
            type: 'error',
            message: event.message ?? 'Unknown CodeBot error',
            metadata: { code: event.code },
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
        metadata: {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          stack: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  // -------------------------------------------------------------------------
  // Simulated execution (codebot-ai not installed)
  // -------------------------------------------------------------------------

  /**
   * Produce a realistic simulated execution when codebot-ai is not installed.
   *
   * The simulation:
   * 1. Parses the prompt to infer likely tool calls.
   * 2. Yields progress events with realistic inter-step delays.
   * 3. Yields tool_call events with plausible parameters.
   * 4. Yields a final result summarising what the agent "would have done".
   *
   * All simulated events carry `metadata.simulated: true` so consumers
   * can distinguish them from real execution.
   */
  private async *simulatedRun(
    prompt: string,
    projectRoot: string,
  ): AsyncGenerator<ExecutionEvent> {
    const summary = promptSummary(prompt);

    yield {
      type: 'progress',
      message: `[Simulation] Analyzing prompt: "${summary}"`,
      metadata: { simulated: true, phase: 'analysis' },
    };

    await delay(50);

    // Infer which tools would be called based on the prompt
    const toolCalls = inferSimulatedToolCalls(prompt, projectRoot);

    yield {
      type: 'progress',
      message: `[Simulation] Planning ${toolCalls.length} tool invocation(s)`,
      metadata: { simulated: true, phase: 'planning', toolCount: toolCalls.length },
    };

    await delay(30);

    // Emit each simulated tool call
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];

      yield {
        type: 'progress',
        message: `[Simulation] Step ${i + 1}/${toolCalls.length}: invoking ${call.tool}`,
        metadata: { simulated: true, phase: 'execution', stepIndex: i },
      };

      await delay(call.delayMs);

      yield {
        type: 'tool_call',
        message: `[Simulation] ${call.description}`,
        metadata: {
          simulated: true,
          tool: call.tool,
          stepIndex: i,
        },
      };

      await delay(20);
    }

    yield {
      type: 'progress',
      message: '[Simulation] Synthesizing results',
      metadata: { simulated: true, phase: 'synthesis' },
    };

    await delay(40);

    yield {
      type: 'result',
      message:
        `[Simulation] CodeBot agent completed (simulation mode). ` +
        `Executed ${toolCalls.length} simulated tool call(s) for prompt: "${summary}". ` +
        `Install codebot-ai for real execution.`,
      metadata: {
        simulated: true,
        phase: 'done',
        toolCallCount: toolCalls.length,
        prompt: summary,
      },
    };
  }
}
