# @ai-operations/codebot-adapter

> CodeBot execution bridge and hash-chained receipt builder for AI Operations OS.

Part of [AI Operations OS](https://github.com/zanderone1980/ai-operations-os) — autonomous business workflow orchestration with safety enforcement.

## Install

```
npm install @ai-operations/codebot-adapter
```

`codebot-ai` is an optional dependency. When not installed, `CodeBotAdapter` and `CodeBotExecutor` produce realistic simulated results with plausible timing and outputs.

## Quick Start

```ts
import { CodeBotAdapter, ReceiptBuilder } from '@ai-operations/codebot-adapter';
import { verifyReceiptChain } from '@ai-operations/shared-types';

const adapter = new CodeBotAdapter();
const result = await adapter.executeStep(workflowStep);

const builder = new ReceiptBuilder();
builder.addStep({ actionId: 'act-001', policyVersion: '1.0.0', cordDecision: 'ALLOW', cordScore: 12, cordReasons: ['Low risk'], input: { query: 'inbox' } });
const receipts = builder.finalize('signing-key');

const { valid } = verifyReceiptChain(receipts, 'signing-key');
```

## API

### `CodeBotAdapter`

Maps workflow steps to CodeBot tool calls. Falls back to simulation mode with realistic outputs when codebot-ai is not installed.

```ts
constructor()
async executeStep(step: WorkflowStep): Promise<StepResult>
async executeSteps(steps: WorkflowStep[], haltOnError?: boolean): Promise<StepResult[]>
isAvailable(): boolean
```

- `StepResult` — `{ success: boolean; output: Record<string, unknown>; durationMs: number; error?: string; simulated: boolean }`

Operations are mapped to CodeBot tools (e.g., `send` -> `messaging.send`, `refund` -> `commerce.refund`, `post` -> `social.publish`).

### `CodeBotExecutor`

Runs a CodeBot agent session for complex multi-tool tasks. Yields `ExecutionEvent` objects via an async generator for real-time progress streaming.

```ts
constructor()
async *run(prompt: string, options?: ExecutorOptions): AsyncGenerator<ExecutionEvent>
isAvailable(): boolean
```

```ts
const executor = new CodeBotExecutor();
for await (const event of executor.run('Refactor the utils module')) {
  console.log(`[${event.type}] ${event.message}`);
}
```

- `ExecutionEvent` — `{ type: ExecutionEventType; message: string; metadata?: Record<string, unknown> }`
- `ExecutionEventType` — `'progress' | 'tool_call' | 'result' | 'error'`
- `ExecutorOptions` — `{ projectRoot?, timeoutMs?, forceSimulation? }`

### `ReceiptBuilder`

Builds hash-chained ActionReceipt objects during workflow execution. Each receipt is SHA-256 hashed and HMAC-SHA256 signed, chaining from the previous receipt (or `GENESIS_HASH` for the first).

```ts
constructor()
addStep(step: ReceiptStepData): void
finalize(key: string): ActionReceipt[]
get stepCount(): number
reset(): void
```

- `ReceiptStepData` — `{ actionId, policyVersion, cordDecision, cordScore, cordReasons, input, output? }`

## Related Packages

- [`@ai-operations/shared-types`](../shared-types) — ActionReceipt, verifyReceiptChain, GENESIS_HASH
- [`@ai-operations/ops-core`](../ops-core) — WorkflowEngine that drives step execution
- [`@ai-operations/cord-adapter`](../cord-adapter) — CORD safety evaluation before CodeBot runs

## License

MIT
