# @ai-ops/ops-storage

> SQLite persistence layer for tasks, workflows, approvals, and users in AI Operations OS.

Part of [AI Operations OS](https://github.com/zanderone1980/ai-operations-os) — autonomous business workflow orchestration with safety enforcement.

## Install

```
npm install @ai-ops/ops-storage
```

Requires `better-sqlite3` as a peer dependency.

## Quick Start

```ts
import { createStores } from '@ai-ops/ops-storage';
import { createTask } from '@ai-ops/shared-types';

const { tasks, workflows, approvals, users, db } = createStores();

const task = createTask({ source: 'email', title: 'Reply to John' });
tasks.save(task);

const found = tasks.get(task.id);
const pending = tasks.list({ status: 'pending', limit: 20 });
```

## API

### `createStores(dbPath?): Stores`

Convenience factory that creates a Database and all stores in one call. Defaults to `~/.ai-ops/data.db`.

```ts
interface Stores {
  tasks: TaskStore;
  workflows: WorkflowStore;
  approvals: ApprovalStore;
  users: UserStore;
  db: Database;
}
```

### `Database`

Opens/creates a SQLite database, creates all required tables on first run, and uses WAL mode for concurrency.

```ts
constructor(dbPath?: string)  // defaults to ~/.ai-ops/data.db
close(): void
```

### `TaskStore`

CRUD operations for Task records with filtering and pagination.

```ts
save(task: Task): void
get(id: string): Task | undefined
list(filter?: TaskFilter): Task[]
update(id: string, updates: Partial<Task>): Task | undefined
count(filter?: TaskFilter): number
delete(id: string): boolean
```

- `TaskFilter` — `{ status?, source?, intent?, priority?, limit?, offset? }`

### `WorkflowStore`

Persistence for WorkflowRun and WorkflowStep records.

- `WorkflowRunFilter` — `{ taskId?, state?, limit?, offset? }`

### `ApprovalStore`

Persistence for Approval records with filtering by risk level and decision.

- `ApprovalFilter` — Filter by decision status, risk level, task ID.

### `UserStore`

User account management with typed input/output.

- `User` / `CreateUserInput` — User record types for the users table.

## Related Packages

- [`@ai-ops/shared-types`](../shared-types) — Task, WorkflowRun, Approval types stored here
- [`@ai-ops/ops-core`](../ops-core) — Workflow engine that drives stored workflow runs
- [`@ai-ops/cord-adapter`](../cord-adapter) — ForensicEngine reads from these stores

## License

MIT
