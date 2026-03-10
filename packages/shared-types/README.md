# @ai-operations/shared-types

> Core data models, JSON schemas, and receipt cryptography for AI Operations OS.

Part of [AI Operations OS](https://github.com/zanderone1980/ai-operations-os) — autonomous business workflow orchestration with safety enforcement.

## Install

```
npm install @ai-operations/shared-types
```

## Quick Start

```ts
import { createTask, createWorkflowRun, createStep, verifyReceiptChain } from '@ai-operations/shared-types';

const task = createTask({ source: 'email', title: 'Reply to John' });
const run = createWorkflowRun(task.id, 'email-reply', [
  createStep('gmail', 'send', { to: 'john@example.com', body: 'On it!' }),
]);
```

## API

### Types

#### `Task`
The universal work item. Every email, calendar event, social mention, store order, or manual request becomes a Task.

- `TaskSource` — `'email' | 'calendar' | 'social' | 'store' | 'manual'`
- `TaskIntent` — `'reply' | 'schedule' | 'post' | 'fulfill' | 'refund' | 'escalate' | 'ignore' | 'unknown'`
- `TaskPriority` — `'urgent' | 'high' | 'normal' | 'low'`
- `TaskStatus` — `'pending' | 'planned' | 'running' | 'awaiting_approval' | 'completed' | 'failed'`

#### `WorkflowRun` / `WorkflowStep`
Execution tracking for multi-step automations. A Task triggers a WorkflowRun with ordered steps.

#### `ActionReceipt`
Cryptographically signed proof of execution. Receipts are hash-chained (SHA-256 + HMAC-SHA256) for tamper detection.

#### `Approval`
Human-in-the-loop gate with risk level, preview, decision, and optional TTL.

#### `PolicyRule` / `PolicyConfig`
Business rule definitions with autonomy levels (`'auto' | 'approve' | 'deny'`).

### Factory Functions

#### `createTask(partial): Task`
Create a new Task with sensible defaults. Requires `source` and `title`.

#### `createWorkflowRun(taskId, workflowType, steps): WorkflowRun`
Create a new WorkflowRun with ordered steps in `'queued'` state.

#### `createStep(connector, operation, input?): WorkflowStep`
Create a single workflow step definition for use with `createWorkflowRun`.

### Receipt Cryptography

```ts
import { computeReceiptHash, signReceipt, verifyReceipt, verifyReceiptChain, GENESIS_HASH } from '@ai-operations/shared-types';

const hash = computeReceiptHash(receiptData);       // SHA-256 content hash
const sig  = signReceipt(hash, 'hmac-key');          // HMAC-SHA256 signature
const ok   = verifyReceipt(receipt, 'hmac-key');     // Verify single receipt
const chain = verifyReceiptChain(receipts, 'hmac-key'); // { valid, brokenAt?, reason? }
```

### JSON Schemas

JSON Schema draft-07 definitions for runtime validation and OpenAPI generation:

```ts
import { TaskSchema, ApprovalSchema, ActionReceiptSchema, WorkflowRunSchema, SCHEMAS } from '@ai-operations/shared-types';

// SCHEMAS is a registry: { Task, Approval, ActionReceipt, WorkflowStep, WorkflowRun }
```

## Related Packages

- [`@ai-operations/ops-core`](../ops-core) — Workflow engine consuming these types
- [`@ai-operations/ops-storage`](../ops-storage) — SQLite persistence for tasks, workflows, approvals
- [`@ai-operations/ops-policy`](../ops-policy) — Policy rules built on PolicyConfig
- [`@ai-operations/codebot-adapter`](../codebot-adapter) — Receipt building and chain verification

## License

MIT
