# @ai-operations/ops-core

> Workflow engine, state machine, and intent classification for AI Operations OS.

Part of [AI Operations OS](https://github.com/zanderone1980/ai-operations-os) — autonomous business workflow orchestration with safety enforcement.

## Install

```
npm install @ai-operations/ops-core
```

## Quick Start

```ts
import { WorkflowEngine, IntentClassifier } from '@ai-operations/ops-core';

const classifier = new IntentClassifier();
const intent = classifier.classify('Please reply to John about the meeting');
// => 'reply'

const engine = new WorkflowEngine(connectorRegistry, safetyGate);
for await (const event of engine.execute(workflowRun)) {
  console.log(event.type, event);
}
```

## API

### `WorkflowEngine`

Sequential step executor with safety gates. Drives a WorkflowRun through its steps, yielding typed events via an AsyncGenerator.

```ts
constructor(connectors: ConnectorRegistry, safetyGate: SafetyGate)
async *execute(run: WorkflowRun): AsyncGenerator<WorkflowEvent>
pause(): void
resume(): void
```

**Event types:** `step_start | step_complete | step_blocked | step_failed | run_complete | run_failed`

### `StateMachine`

Enforces valid workflow step state transitions with O(1) lookup.

```ts
const sm = new StateMachine();
sm.transition('pending', 'start');           // => 'running'
sm.canTransition('running', 'complete');     // => true
sm.validEvents('blocked');                   // => ['approve']
```

**Step events:** `start | complete | fail | block | approve | pause | resume`

### `IntentClassifier`

Keyword-based heuristic intent classification. Fast, deterministic first pass.

```ts
const classifier = new IntentClassifier();
const result = classifier.classifyDetailed('Please reply to John');
// => { intent: 'reply', confidence: 'low', matchedKeywords: ['reply'] }
```

### `LLMIntentClassifier`

LLM-backed classification with heuristic fallback. Supports Anthropic, OpenAI, and Ollama providers via environment variables.

```ts
const llm = new LLMIntentClassifier();
const intent = await llm.classify('Can you handle the refund for order #123?');
// => 'refund' (via LLM when heuristic confidence is low)
```

**Environment variables:** `OPS_LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_URL`

### `TaskStore`

In-memory + JSON file task persistence with filtering.

### Interfaces

- `Connector` — `{ name: string; execute(operation, input): Promise<Record<string, unknown>> }`
- `ConnectorRegistry` — `{ get(name): Connector | undefined }`
- `SafetyGate` — `(step, run) => Promise<SafetyGateResult>`
- `SafetyGateResult` — `{ decision: CordDecision; score: number; reason: string }`

## Related Packages

- [`@ai-operations/shared-types`](../shared-types) — Task, WorkflowRun, and other core types
- [`@ai-operations/ops-connectors`](../ops-connectors) — Connector implementations (Gmail, Calendar, X, Shopify)
- [`@ai-operations/cord-adapter`](../cord-adapter) — CORD safety gate integration
- [`@ai-operations/ops-policy`](../ops-policy) — Policy rules and autonomy management

## License

MIT
