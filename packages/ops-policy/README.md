# @ai-ops/ops-policy

> Business rules, autonomy levels, escalation paths, and budget tracking for AI Operations OS.

Part of [AI Operations OS](https://github.com/zanderone1980/ai-operations-os) — autonomous business workflow orchestration with safety enforcement.

## Install

```
npm install @ai-ops/ops-policy
```

## Quick Start

```ts
import { AutonomyManager, BudgetTracker } from '@ai-ops/ops-policy';
import { DEFAULT_POLICY } from '@ai-ops/shared-types';

const manager = new AutonomyManager(DEFAULT_POLICY);
const decision = manager.canExecute('gmail', 'send', { source: 'email' });

if (decision.allowed && !decision.requiresApproval) {
  // Safe to execute autonomously
  manager.recordAction();
}
```

## API

### `RuleEngine`

Evaluates policy rules against connector operations. Rules are checked in priority order (highest first); the first matching rule wins.

```ts
constructor(config: PolicyConfig)
evaluate(connector: string, operation: string, context?: EvaluationContext): EvaluationResult
```

- `EvaluationContext` — `{ source?: string; intent?: string; amount?: number }`
- `EvaluationResult` — `{ autonomy: AutonomyLevel; risk: RiskLevel; matchedRule?: PolicyRule; reason: string }`

### `AutonomyManager`

Wraps RuleEngine with rate limiting (hourly action counts, daily spend limits). Provides the primary `canExecute` interface for the orchestration layer.

```ts
constructor(config: PolicyConfig)
canExecute(connector: string, operation: string, context?: EvaluationContext): AutonomyDecision
recordAction(amount?: number): void
resetCounters(): void
getDailySpend(): number
getHourlyActionCount(): number
```

- `AutonomyDecision` — `{ allowed: boolean; requiresApproval: boolean; reason: string }`

### `EscalationManager`

Tracks denial counts per task and determines when and to whom issues should be escalated. Prevents tasks from being silently stuck in denial loops.

```ts
constructor(config?: EscalationConfig)
shouldEscalate(taskId: string, denialCount: number): boolean
getEscalationTarget(taskId: string): EscalationTarget | undefined
recordDenial(taskId: string): void
recordEscalation(taskId: string, target: EscalationTarget): void
clearState(taskId: string): void
```

- `EscalationTarget` — `{ role: string; channel: string; urgency: 'low' | 'normal' | 'high' | 'critical' }`

### `BudgetTracker`

Fine-grained spending management with global daily limits and per-connector breakdowns. Auto-resets at midnight.

```ts
constructor(dailyLimit?: number, connectorLimits?: Record<string, number>)
canSpend(amount: number, connector: string): { allowed: boolean; reason: string }
recordSpend(amount: number, connector: string): void
getDailyTotal(): number
getConnectorTotal(connector: string): number
getBreakdown(): Record<string, number>
getRemainingBudget(): number
setConnectorLimit(connector: string, limit: number): void
```

## Related Packages

- [`@ai-ops/shared-types`](../shared-types) — PolicyConfig, PolicyRule, AutonomyLevel types
- [`@ai-ops/ops-core`](../ops-core) — Workflow engine that checks policy before execution
- [`@ai-ops/cord-adapter`](../cord-adapter) — CORD safety evaluation layer

## License

MIT
