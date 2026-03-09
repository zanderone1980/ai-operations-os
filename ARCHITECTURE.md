# Architecture

## System Overview

AI Operations OS is an autonomous business workflow orchestration system that receives inbound events (email, calendar, social, commerce), classifies intent using heuristic/LLM analysis, evaluates owner-defined policy rules, scores each proposed action through a CORD safety gate, executes approved actions via CodeBot tool calls, and produces cryptographically signed, hash-chained audit receipts. Every action passes through six sequential layers -- ingestion, understanding, governance, safety, action, and audit -- with no shortcuts or exceptions. The system is built as a TypeScript monorepo with npm workspaces and Turborepo, targeting Node.js 18+.

---

## Architecture Diagram

```
                            AI Operations OS — Pipeline Flow

  INBOUND EVENT         INTENT             POLICY             CORD              CODEBOT           RECEIPT
  ============       CLASSIFIER         EVALUATION         SAFETY GATE        EXECUTION         =========

   Gmail ----+
   Calendar --+       +-----------+     +--------------+    +------------+    +------------+    +----------+
   X (social)-+------>|  Classify  |---->|  Policy Rules |---->|  CORD Gate |---->|  CodeBot   |---->|  Signed  |
   Shopify ---+       |  Intent    |     |  (ops-policy) |    |  Evaluate  |    |  Execute   |    |  Receipt |
   Manual ----+       |           |     |               |    |            |    |            |    |  (chain) |
                      |  reply    |     |  autonomous?  |    |  ALLOW     |    |  tool call |    |          |
                      |  schedule |     |  approval?    |    |  CONTAIN   |    |  via       |    |  SHA-256 |
                      |  post     |     |  block?       |    |  CHALLENGE |    |  codebot-ai|    |  HMAC    |
                      |  fulfill  |     |               |    |  BLOCK     |    |            |    |  chained |
                      |  escalate |     |               |    |            |    |            |    |          |
                      +-----------+     +--------------+    +------------+    +------------+    +----------+

    Layer 1            Layer 2          Layer 3            Layer 4          Layer 5          Layer 6
    Ingestion          Understanding    Governance         Safety           Action           Audit


  +-------+     +--------+     +--------+     +--------+     +--------+     +---------+
  | ops-  |     | ops-   |     | ops-   |     | cord-  |     |codebot-|     | shared- |
  |connect|---->| core   |---->| policy |---->| adapter|---->| adapter|---->| types   |
  | ors   |     |        |     |        |     |        |     |        |     |(receipt)|
  +-------+     +--------+     +--------+     +--------+     +--------+     +---------+
       |                                                                         |
       |                     +------------+                                      |
       +-------------------->| ops-storage|<-------------------------------------+
                             +------------+

  Apps:  ops-api (HTTP server)  |  ops-worker (background jobs)  |  ops-web (dashboard)
```

---

## Package Map

The monorepo contains 10 packages: 3 applications and 7 libraries.

| Package | Path | Purpose | Key Exports | Dependencies |
|---------|------|---------|-------------|--------------|
| **shared-types** | `packages/shared-types` | Core data models and type definitions | `Task`, `WorkflowRun`, `WorkflowStep`, `Action`, `Approval`, `ActionReceipt`, `PolicyRule`, `CordDecision`, `createTask`, `computeReceiptHash`, `signReceipt`, `verifyReceiptChain`, `GENESIS_HASH` | None (leaf package) |
| **ops-core** | `packages/ops-core` | Workflow engine, state machine, intent classifier | `WorkflowEngine`, `StateMachine`, `IntentClassifier`, `TaskStore` (in-memory), `ConnectorRegistry`, `SafetyGate` | `shared-types` |
| **ops-policy** | `packages/ops-policy` | Business rules, autonomy levels, escalation, budgets | `RuleEngine`, `AutonomyManager`, `EscalationManager`, `BudgetTracker` | `shared-types` |
| **ops-connectors** | `packages/ops-connectors` | Connector framework and service integrations | `BaseConnector`, `ConnectorRegistry`, `GmailConnector`, `CalendarConnector`, `XTwitterConnector`, `ShopifyConnector` | `shared-types` |
| **cord-adapter** | `packages/cord-adapter` | Bridge to cord-engine for safety evaluation | `CordSafetyGate`, `PolicySimulator`, `ForensicEngine` | `shared-types`, `cord-engine` (optional) |
| **codebot-adapter** | `packages/codebot-adapter` | Bridge to codebot-ai for tool execution | `CodeBotAdapter`, `CodeBotExecutor`, `ReceiptBuilder` | `shared-types`, `codebot-ai` (optional) |
| **ops-storage** | `packages/ops-storage` | SQLite persistence layer | `Database`, `TaskStore`, `WorkflowStore`, `ApprovalStore`, `createStores()` | `shared-types`, `better-sqlite3` |
| **ops-api** | `apps/ops-api` | REST/SSE API server (Node.js built-in http) | `server`, `stores`, route modules | `shared-types`, `ops-storage`, `ops-worker` |
| **ops-worker** | `apps/ops-worker` | Background job processor and pipeline orchestrator | `runPipeline`, `defaultBuildWorkflow`, `JobQueue`, `Scheduler` | `shared-types` |
| **ops-web** | `apps/ops-web` | Web dashboard (React) | UI components | `shared-types` |

---

## Data Flow

Step-by-step walkthrough of an email arriving and flowing through the full pipeline:

### 1. Ingestion (Layer 1 -- ops-connectors)

A Gmail push notification hits `POST /api/webhooks/gmail`. The webhook handler extracts `subject`, `snippet`, and `messageId` from the payload, then calls `createTask()` to produce a `Task` with `source: 'email'`, `status: 'pending'`, and `intent: 'unknown'`.

### 2. Intent Classification (Layer 2 -- ops-core)

The pipeline reads `task.title + task.body` and passes it to `IntentClassifier`. The classifier uses keyword heuristics (e.g., "reply" or "respond" maps to `intent: 'reply'`; "meeting" maps to `intent: 'schedule'`). The task's `intent` field is updated and `status` becomes `'planned'`.

### 3. Workflow Building

Based on the classified intent, `defaultBuildWorkflow()` maps the task to a named workflow type and ordered steps. For `intent: 'reply'`, the workflow is `'email-reply'` with two steps: `gmail.read` (fetch the original message) and `gmail.reply` (draft a response).

### 4. Policy Evaluation (Layer 3 -- ops-policy)

Each step is evaluated by the `RuleEngine`. Rules are sorted by priority (highest first); the first match wins. The engine returns an `EvaluationResult` with `autonomy` (`'auto'`, `'approve'`, or `'deny'`) and `risk` level. Read-only operations like `gmail.read` get `autonomy: 'auto'`. Write operations like `gmail.reply` get `autonomy: 'approve'`.

If `autonomy === 'deny'`, the step is blocked and the workflow fails immediately.

### 5. Safety Gate (Layer 4 -- cord-adapter)

Each step passes through `CordSafetyGate.evaluateAction()`. The adapter maps the connector operation to a CORD tool type (e.g., `reply` maps to `communication`) and calls cord-engine to produce a `SafetyResult` with a `decision` (ALLOW / CONTAIN / CHALLENGE / BLOCK) and numeric `score` (0-99).

- **ALLOW** (score 0-19): Proceed automatically.
- **CONTAIN** (score 20-49): Proceed but with constraints.
- **CHALLENGE** (score 50-79): Pause and request human approval.
- **BLOCK** (score 80+): Reject the action entirely.

If cord-engine is not installed, the gate degrades to ALLOW-all mode.

### 6. Approval Gate (conditional)

If the CORD decision is `CHALLENGE` or the policy requires `'approve'`, the pipeline creates an `Approval` object with the action preview, risk level, and reason. The approval is persisted to SQLite and broadcast via SSE to connected dashboard clients. The pipeline pauses until the user submits a decision (`approved`, `denied`, or `modified`) through `POST /api/approvals/:id/decide`.

### 7. Execution (Layer 5 -- codebot-adapter)

Once approved (or auto-allowed), `CodeBotAdapter.executeStep()` maps the connector operation to a CodeBot tool call (e.g., `gmail.reply` maps to `messaging.*`). The adapter invokes codebot-ai and returns a `StepResult` with `success`, `output`, `durationMs`, and a `mock` flag (true if codebot-ai is not installed).

### 8. Receipt Generation (Layer 6 -- shared-types)

After execution, `ReceiptBuilder` creates an `ActionReceipt` containing: the action ID, policy version, CORD decision and score, sanitized input/output, a SHA-256 content hash, an HMAC-SHA256 signature (using `CORD_HMAC_KEY`), and a `prevHash` linking to the previous receipt in the chain. The first receipt uses `prevHash: "genesis"`.

### 9. Completion

The workflow run's `state` is set to `'completed'`, the task's `status` becomes `'completed'`, and a `workflow_completed` event is emitted. All state transitions are persisted to SQLite.

---

## Key Interfaces

### Task

The universal work item. Every inbound event (email, calendar invite, social mention, order) becomes a Task. Fields include `id` (UUID v4), `source` (email/calendar/social/store/manual), `intent` (reply/schedule/post/fulfill/escalate/ignore/unknown), `priority`, `status` (pending/planned/running/awaiting_approval/completed/failed), and `metadata` for source-specific data.

### WorkflowRun

An execution container for a Task. Contains `taskId`, `workflowType` (e.g., `'email-reply'`), `state` (pending/running/paused/completed/failed), timestamps, and an ordered array of `WorkflowStep` objects. Each step holds `connector`, `operation`, `input`, `output`, `status`, `cordDecision`, `cordScore`, and `durationMs`.

### Action

A discrete executable operation within a workflow step. Tracks `connector`, `operation`, `input`, `output`, `status`, `executedAt`, and `durationMs`. Actions are the unit that receives CORD evaluation and produces receipts.

### Approval

A human-in-the-loop gate. Created when a step requires user consent. Fields include `actionId`, `taskId`, `risk` (low/medium/high/critical), `reason`, `preview` (human-readable summary of the proposed action), `decision` (approved/denied/modified), `decidedBy`, `decidedAt`, `modifications`, and `ttlMs` (expiry timeout, default 5 minutes).

### ActionReceipt

Signed proof of execution. Each receipt contains `actionId`, `policyVersion`, `cordDecision`, `cordScore`, `cordReasons`, sanitized `input`/`output`, `timestamp`, a SHA-256 `hash`, an HMAC-SHA256 `signature`, and `prevHash` (the hash of the preceding receipt in the chain). Receipts form a tamper-evident linked list; the chain is verified by recomputing each hash and validating each HMAC signature. The genesis hash is the string `"genesis"`.

---

## Connector System

### Existing Connectors

| Connector | File | Operations |
|-----------|------|------------|
| Gmail | `packages/ops-connectors/src/gmail.ts` | `read`, `list`, `search`, `reply`, `send`, `forward`, `draft` |
| Google Calendar | `packages/ops-connectors/src/calendar.ts` | `list_events`, `check_availability`, `create_event`, `update_event`, `cancel_event` |
| X (Twitter) | `packages/ops-connectors/src/x-twitter.ts` | `post`, `reply`, `schedule`, `delete` |
| Shopify | `packages/ops-connectors/src/shopify.ts` | `get_order`, `list_orders`, `fulfill_order`, `refund` |

### Adding a New Connector

1. Create a new file in `packages/ops-connectors/src/` (e.g., `slack.ts`).

2. Extend `BaseConnector` and implement the three required members:

```typescript
import { BaseConnector, ConnectorConfig, ConnectorResult } from './base';

export class SlackConnector extends BaseConnector {
  constructor(config: ConnectorConfig) {
    super({ ...config, name: 'slack' });
  }

  get supportedOperations(): string[] {
    return ['send_message', 'list_channels', 'react'];
  }

  async execute(operation: string, input: Record<string, unknown>): Promise<ConnectorResult> {
    // Implement each operation
    switch (operation) {
      case 'send_message': return this.sendMessage(input);
      // ...
      default: return { success: false, error: `Unsupported: ${operation}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    // Verify API connectivity
    return true;
  }
}
```

3. Export the connector from `packages/ops-connectors/src/index.ts`.

4. Register it in the `ConnectorRegistry` at startup.

5. Add operation-to-CORD-tool mappings in `packages/cord-adapter/src/adapter.ts` (the `CONNECTOR_TO_CORD_TOOL` map) so the safety gate knows how to score each operation.

6. Add operation-to-CodeBot-tool mappings in `packages/codebot-adapter/src/adapter.ts` so the executor can dispatch tool calls.

7. Add policy rules in your `PolicyConfig` for the new connector's operations.

8. Optionally, add a webhook route in `apps/ops-api/src/routes/webhooks.ts` for inbound events and a job handler in `apps/ops-worker/src/handlers/`.

---

## Safety Architecture

### CORD Integration

CORD (Constrained Operational Risk Decisions) is the safety scoring engine. The `cord-adapter` package wraps cord-engine behind a `CordSafetyGate` class.

**Operation-to-CORD-tool mapping:**

| Operation Category | CORD Tool Type | Risk Profile |
|--------------------|---------------|--------------|
| `send`, `reply`, `forward` | `communication` | Outbound messaging risk |
| `post`, `tweet` | `publication` | Public content risk |
| `delete`, `remove`, `archive` | `destructive` | Data loss risk |
| `create_event`, `update_event`, `cancel_event` | `scheduling` | Calendar disruption risk |
| `refund`, `charge`, `transfer` | `financial` | Monetary risk |
| `read`, `list`, `search`, `get` | `readonly` | Minimal risk |

**Decision thresholds:**

| Decision | Score Range | Behavior |
|----------|------------|----------|
| ALLOW | 0-19 | Auto-execute |
| CONTAIN | 20-49 | Execute with constraints |
| CHALLENGE | 50-79 | Require human approval |
| BLOCK | 80-99 | Reject (hardBlock if financial/destructive) |

**Graceful degradation:** If cord-engine is not installed (it is an optional dependency), `CordSafetyGate` returns `ALLOW` with `score: 0` for all operations, allowing the system to run in permissive mode.

### Policy Evaluation

The `RuleEngine` in `ops-policy` evaluates operations against owner-defined `PolicyRule` objects. Rules are sorted by priority (highest first); the first matching rule wins. Each rule specifies a `connector` pattern, `operation` pattern, and an `autonomy` level (`'auto'`, `'approve'`, or `'deny'`). If no rules match, the policy's `defaultAutonomy` is used.

Supporting components:
- **AutonomyManager** -- Resolves the final autonomy decision by combining policy rules with CORD scores.
- **EscalationManager** -- Routes escalations to configured targets based on risk thresholds.
- **BudgetTracker** -- Tracks spending against per-connector or global budgets for financial operations.

### Approval Flow

1. Pipeline determines approval is needed (CORD `CHALLENGE` or policy `autonomy: 'approve'`).
2. An `Approval` object is created with a preview of the proposed action, risk level, and reason.
3. The approval is persisted to SQLite via `ApprovalStore.save()`.
4. The approval is broadcast to connected SSE clients via `GET /api/approvals/stream`.
5. The pipeline polls `ApprovalStore` every 500ms, waiting up to 5 minutes (configurable `ttlMs`).
6. A user submits a decision via `POST /api/approvals/:id/decide` with `{ decision: 'approved' | 'denied' | 'modified' }`.
7. If `approved`, execution proceeds. If `denied`, the workflow fails. If `modified`, the user-supplied modifications are applied before execution.

### Forensic Engine

The `ForensicEngine` in `cord-adapter` provides timeline inspection for post-incident analysis. It reconstructs a chronological timeline of all safety evaluations and decisions for a given session or task.

### Policy Simulator

The `PolicySimulator` in `cord-adapter` supports dry-run analysis. Given a set of projected actions, it evaluates each through the CORD gate without executing, producing a `SimulationReport` showing what would happen.

---

## Storage Layer

### Overview

The `ops-storage` package provides SQLite persistence using `better-sqlite3`. The default database path is `~/.ai-ops/data.db`. WAL mode is enabled for better concurrency, and foreign keys are enforced.

### Schema

```
+-------------------+       +--------------------+       +--------------------+
|      tasks        |       |   workflow_runs     |       |   workflow_steps   |
+-------------------+       +--------------------+       +--------------------+
| id          (PK)  |<------| task_id        (FK) |       | id           (PK)  |
| source            |       | id           (PK)   |<------| run_id        (FK) |
| source_id         |       | workflow_type       |       | connector          |
| intent            |       | state               |       | operation          |
| title             |       | started_at          |       | input        (JSON)|
| body              |       | ended_at            |       | output       (JSON)|
| priority          |       | error               |       | status             |
| status            |       +--------------------+       | cord_decision      |
| owner             |                                     | cord_score         |
| due_at            |                                     | error              |
| created_at        |       +--------------------+       | duration_ms        |
| updated_at        |       |      actions        |       | step_order         |
| metadata   (JSON) |       +--------------------+       +--------------------+
+-------------------+       | id           (PK)   |
                            | run_id        (FK)  |
                            | step_id       (FK)  |       +--------------------+
                            | connector           |       |     approvals      |
                            | operation           |       +--------------------+
                            | input        (JSON) |       | id           (PK)  |
                            | output       (JSON) |       | action_id          |
                            | status              |       | task_id            |
                            | executed_at         |       | risk               |
                            | duration_ms         |       | reason             |
                            | error               |       | preview            |
                            +--------------------+       | requested_at       |
                                                          | decision           |
                            +--------------------+       | decided_by         |
                            |      receipts       |       | decided_at         |
                            +--------------------+       | modifications(JSON)|
                            | id           (PK)   |       | ttl_ms             |
                            | action_id     (FK)  |       +--------------------+
                            | policy_version      |
                            | cord_decision       |
                            | cord_score          |
                            | cord_reasons (JSON) |
                            | input        (JSON) |
                            | output       (JSON) |
                            | timestamp           |
                            | hash                |
                            | signature           |
                            | prev_hash           |
                            +--------------------+
```

**Tables:** 6 total -- `tasks`, `workflow_runs`, `workflow_steps`, `actions`, `approvals`, `receipts`.

**Indexes:** Optimized for common queries on `status`, `source`, `intent`, `updated_at`, `task_id`, `run_id`, `decision`, and `risk`.

**Store classes:** `TaskStore`, `WorkflowStore`, and `ApprovalStore` provide typed CRUD with `list`/`get`/`save`/`update`/`delete` methods. The `createStores(dbPath?)` factory creates all three stores from a single database connection.

---

## API Endpoints

The API server runs on port 3100 (configurable via `OPS_PORT`) using Node.js built-in `http` module with zero external dependencies.

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (also `/api/health`) |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List tasks (filters: `status`, `source`, `intent`, `priority`, `limit`, `offset`) |
| GET | `/api/tasks/:id` | Get a single task |
| POST | `/api/tasks` | Create a task (requires `source`, `title`) |
| PATCH | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Soft-delete a task (marks as `failed`) |

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workflows` | Trigger a workflow run (requires `taskId`, `workflowType`, optional `steps`) |
| GET | `/api/workflows` | List workflow runs (filters: `taskId`, `state`, `limit`, `offset`) |
| GET | `/api/workflows/:id` | Get a specific workflow run with its steps |
| POST | `/api/workflows/:id/pause` | Pause a running workflow |
| POST | `/api/workflows/:id/resume` | Resume a paused workflow |

### Approvals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/approvals` | List approvals (filters: `status` = pending/all/decided, `risk`) |
| GET | `/api/approvals/:id` | Get a specific approval |
| POST | `/api/approvals/:id/decide` | Submit decision (`{ decision: 'approved'|'denied'|'modified' }`) |
| GET | `/api/approvals/stream` | SSE stream of new approval requests |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhooks/gmail` | Gmail push notification |
| POST | `/api/webhooks/calendar` | Google Calendar push notification |
| POST | `/api/webhooks/shopify` | Shopify webhook |
| POST | `/api/webhooks/stripe` | Stripe webhook |
| POST | `/api/webhooks/generic` | Generic webhook for custom integrations |

### Pipeline

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/pipeline/run` | Trigger full pipeline with SSE event stream |
| POST | `/api/pipeline/simulate` | Dry-run pipeline simulation (no execution) |

### OAuth

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/oauth/google/url` | Get Google OAuth2 authorization URL |
| GET | `/api/oauth/google/callback` | Handle OAuth callback with auth code |
| GET | `/api/oauth/status` | Check connector authentication status |
| POST | `/api/oauth/google/refresh` | Refresh expired Google access token |
| POST | `/api/oauth/x/token` | Save X/Twitter bearer token |

---

## Development Guide

### Prerequisites

- Node.js >= 18
- npm >= 10

### Setup

```bash
git clone https://github.com/zanderone1980/ai-operations-os.git
cd ai-operations-os
npm install
npm run build
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages (Turborepo) |
| `npm run dev` | Dev mode for all packages |
| `npm test` | Run all tests |
| `npm run lint` | Lint all packages |
| `npm run clean` | Clean build artifacts and node_modules |

### Running Individual Apps

```bash
# API server (port 3100)
npm run dev --workspace=apps/ops-api

# Worker (background jobs)
npm run dev --workspace=apps/ops-worker

# Web dashboard
npm run dev --workspace=apps/ops-web
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `GMAIL_CLIENT_ID` | For Gmail | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | For Gmail | Google OAuth client secret |
| `CALENDAR_API_KEY` | For Calendar | Google Calendar API key |
| `X_API_KEY` | For X | X API bearer token |
| `CORD_HMAC_KEY` | Yes | HMAC key for receipt signing |
| `POLICY_VERSION` | No | Policy version identifier (default: `v1`) |
| `OPS_PORT` | No | API server port (default: `3100`) |
| `OPS_HOST` | No | API server host (default: `0.0.0.0`) |

### Adding a New Feature

1. **New connector** -- See the Connector System section above. Extend `BaseConnector`, register it, add CORD mappings, add policy rules.

2. **New workflow type** -- Add a case to `defaultBuildWorkflow()` in `apps/ops-worker/src/pipeline.ts` mapping a `TaskIntent` to an ordered list of connector operations.

3. **New policy rule** -- Add a `PolicyRule` to your `PolicyConfig`. Rules match on `connector` and `operation` patterns and resolve to an autonomy level.

4. **New API route** -- Create a route file in `apps/ops-api/src/routes/`, use `pathToRoute(method, path, handler)` to define routes, and spread them into the `routes` array in `server.ts`.

5. **New background job** -- Create a handler function, register it with `queue.registerHandler('domain.action', handler)` in `apps/ops-worker/src/index.ts`. Optionally add a scheduled task via `scheduler.register()`.

6. **New storage table** -- Add the `CREATE TABLE` statement to `Database.createTables()` in `packages/ops-storage/src/database.ts`, then create a corresponding store class.

### Worker Architecture

The worker (`apps/ops-worker`) has two components:

- **JobQueue** -- Polls for jobs every 1 second and dispatches to registered handlers. 8 handlers are pre-registered across 4 domains: email (triage, reply), calendar (check, respond), social (post, reply), store (fulfill, support).

- **Scheduler** -- Manages recurring tasks. Pre-configured schedules include daily email digest (8:00 AM), daily calendar summary (7:30 AM), and hourly social engagement check. All are disabled by default until connectors are configured.

### Key Design Decisions

- **Zero external HTTP dependencies** -- The API server uses Node.js built-in `http` module. No Express, Fastify, or Koa.
- **Optional safety/execution engines** -- Both `cord-engine` and `codebot-ai` are optional dependencies. The system degrades gracefully to permissive/mock mode when they are not installed.
- **Hash-chained receipts** -- Every action produces a tamper-evident receipt. The chain can be independently verified by recomputing SHA-256 hashes and HMAC signatures.
- **SSE for real-time** -- Approval notifications and pipeline events use Server-Sent Events, avoiding WebSocket complexity.
- **SQLite for simplicity** -- Single-file database with WAL mode. No external database server required. The path defaults to `~/.ai-ops/data.db`.
