# @ai-ops/cord-adapter

> CORD safety gate, policy simulation, and forensic timeline analysis for AI Operations OS.

Part of [AI Operations OS](https://github.com/zanderone1980/ai-operations-os) — autonomous business workflow orchestration with safety enforcement.

## Install

```
npm install @ai-ops/cord-adapter
```

`cord-engine` is an optional dependency. When not installed, `CordSafetyGate` defaults to ALLOW for all evaluations so the system can operate in permissive mode.

## Quick Start

```ts
import { CordSafetyGate, PolicySimulator } from '@ai-ops/cord-adapter';

const gate = new CordSafetyGate();
const result = gate.evaluateAction('gmail', 'send', { to: 'user@example.com', subject: 'Hi' });

if (result.decision === 'BLOCK') {
  console.error('Action blocked:', result.reasons);
}
```

## API

### `CordSafetyGate`

Wraps cord-engine to evaluate proposed connector actions against safety policies before execution. Gracefully degrades to ALLOW when cord-engine is not installed.

```ts
constructor()
evaluateAction(connector: string, operation: string, input: Record<string, unknown>): SafetyResult
isAvailable(): boolean
```

- `SafetyResult` — `{ decision: CordDecision; score: number; reasons: string[]; hardBlock: boolean }`
- `CordDecision` — `'ALLOW' | 'CONTAIN' | 'CHALLENGE' | 'BLOCK'`

Operations are mapped to CORD tool categories: `communication`, `publication`, `destructive`, `scheduling`, `financial`, `readonly`.

### `PolicySimulator`

Dry-run safety evaluation for projected actions. Runs a batch of actions through CordSafetyGate without executing them.

```ts
constructor(gate?: CordSafetyGate)
simulate(actions: ProjectedAction[]): SimulationReport
```

```ts
const sim = new PolicySimulator();
const report = sim.simulate([
  { connector: 'gmail', operation: 'send', input: { to: 'a@b.com' } },
  { connector: 'shopify', operation: 'refund', input: { amount: 200 } },
]);
console.log(report.summary);     // { ALLOW: 1, CONTAIN: 1 }
console.log(report.allAllowed);   // false
console.log(report.hasHardBlock); // false
```

- `SimulationReport` — `{ entries, summary, maxScore, hasHardBlock, allAllowed }`

### `ForensicEngine`

Session-level forensic timeline analysis. Loads a task's full execution history from storage and builds a chronological, color-coded timeline for audit and debugging.

```ts
constructor(stores?: Stores)
async loadSession(sessionId: string): Promise<void>
buildTimeline(): ForensicTimeline
renderTimeline(): void   // Colored CLI output
getTimeline(): ForensicTimeline | null
```

- `TimelineEvent` — `{ timestamp, category, label, detail?, connector?, operation?, cordDecision?, cordScore? }`
- Event categories: `action | decision | approval | error | system`

## Related Packages

- [`@ai-ops/shared-types`](../shared-types) — CordDecision, ActionReceipt types
- [`@ai-ops/ops-core`](../ops-core) — WorkflowEngine uses CordSafetyGate as its SafetyGate
- [`@ai-ops/ops-storage`](../ops-storage) — ForensicEngine reads session data from stores
- [`@ai-ops/ops-policy`](../ops-policy) — Policy rules complementing CORD evaluation

## License

MIT
