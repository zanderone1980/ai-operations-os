# Enterprise Deployment Guide

AI Operations OS is designed for teams that need autonomous workflow orchestration with auditability, safety enforcement, and human oversight.

---

## Deployment Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Single-node** | API + Worker + SQLite on one machine | Solo founders, small teams, dev/staging |
| **Distributed** | API and Worker as separate processes, PostgreSQL | Teams needing horizontal scale |
| **Air-gapped** | No outbound network; all LLM inference local (Ollama) | Regulated industries, on-prem |

### Single-node (default)

```bash
npm run build
node apps/ops-api/dist/server.js    # API on :3100
node apps/ops-worker/dist/index.js  # Background worker
```

SQLite database lives at `~/.ai-ops/data.db` (configurable via `OPS_DB_PATH`).

### Distributed

Set `OPS_DB_PATH` to a PostgreSQL connection string (PostgreSQL adapter coming in v0.2). Run API and Worker on separate machines or containers. Both connect to the same database.

### Air-gapped

```bash
OPS_LLM_PROVIDER=ollama \
OPS_LLM_MODEL=llama3.2 \
OPS_OFFLINE=true \
node apps/ops-api/dist/server.js
```

No telemetry. No outbound calls. CORD engine runs fully offline.

---

## Authentication and Authorization

### API Authentication

The API server supports bearer token auth:

```bash
curl -H "Authorization: Bearer $OPS_API_KEY" http://localhost:3100/api/tasks
```

Set `OPS_API_KEY` to enforce authentication. In dev mode (no key set), all requests are allowed.

### OAuth2 for Connectors

Connector credentials are managed via the OAuth2 flow:

| Connector | Auth Method | Scopes Required |
|-----------|-------------|-----------------|
| Gmail | OAuth2 (Google) | `gmail.readonly`, `gmail.send`, `gmail.modify` |
| Calendar | OAuth2 (Google) | `calendar.readonly`, `calendar.events` |
| X (Twitter) | Bearer token (API v2) | `tweet.read`, `tweet.write`, `dm.read`, `dm.write` |

Credentials stored at `~/.ai-ops/credentials.json` with `0o600` permissions.

### RBAC (Roadmap — v0.3)

Planned role model:

| Role | Permissions |
|------|-------------|
| **Admin** | Full access, policy configuration, connector management |
| **Operator** | View tasks, approve/deny actions, view audit trail |
| **Viewer** | Read-only dashboard access |
| **Connector** | Webhook-only access (for inbound events) |

---

## Audit and Compliance

### Audit Trail

Every action produces a cryptographically signed receipt:

```typescript
interface ActionReceipt {
  id: string;              // UUID v4
  actionId: string;        // References the executed action
  policyVersion: string;   // Policy version at time of execution
  cordDecision: string;    // ALLOW | CONTAIN | CHALLENGE | BLOCK
  cordScore: number;       // 0–99 risk score
  input: Record<...>;      // Sanitized input (secrets redacted)
  output?: Record<...>;    // Execution result summary
  timestamp: string;       // ISO 8601
  hash: string;            // SHA-256 content hash
  signature: string;       // HMAC-SHA256 signature
  prevHash: string;        // Previous receipt hash (chain integrity)
}
```

Receipts are hash-chained — each receipt's `prevHash` points to the previous receipt's `hash`. Tampering with any receipt breaks the chain.

### Retention

- Default: SQLite database at `~/.ai-ops/data.db`
- Export: `GET /api/receipts?format=jsonl` for compliance archival
- Chain verification: `verifyReceiptChain()` from `@ai-operations/shared-types`

### Compliance Mapping

| Requirement | How AI Ops OS Addresses It |
|-------------|---------------------------|
| **SOC 2 CC6.1** (Logical access) | Bearer token auth, planned RBAC |
| **SOC 2 CC7.2** (System monitoring) | Real-time SSE dashboard, audit trail |
| **SOC 2 CC8.1** (Change management) | Policy versioning, signed receipts |
| **GDPR Art. 22** (Automated decisions) | Human-in-the-loop approval gate for write operations |
| **ISO 27001 A.12.4** (Logging) | Hash-chained, tamper-evident audit log |

---

## Policy Configuration

Policies control what runs autonomously vs. what requires human approval:

```typescript
interface PolicyConfig {
  version: string;
  defaultAutonomy: 'auto' | 'approve' | 'deny';
  rules: PolicyRule[];
  timeWindows: TimeWindow[];   // Business hours enforcement
  amountLimits: AmountLimit[]; // Financial thresholds
}
```

Example policy:

```json
{
  "version": "1.0",
  "defaultAutonomy": "approve",
  "rules": [
    { "connector": "*", "operation": "read", "autonomy": "auto" },
    { "connector": "*", "operation": "list", "autonomy": "auto" },
    { "connector": "gmail", "operation": "send", "autonomy": "approve" },
    { "connector": "gmail", "operation": "reply", "autonomy": "approve" },
    { "connector": "x-twitter", "operation": "post", "autonomy": "approve" },
    { "connector": "*", "operation": "delete", "autonomy": "deny" }
  ]
}
```

All read operations are autonomous. All writes require approval. Deletes are blocked entirely.

---

## Upgrade Policy

| Channel | Cadence | Breaking Changes |
|---------|---------|-----------------|
| **Patch** (0.1.x) | As needed | Never |
| **Minor** (0.x.0) | Monthly | Rare, with migration notes |
| **Major** (x.0.0) | Quarterly | Possible, with migration guide |

All releases include changelogs. Breaking changes are documented with before/after examples.

---

## Support

| Tier | Response Time | Channel |
|------|---------------|---------|
| **Community** | Best effort | GitHub Issues |
| **Priority** | 48 hours | alex@zanderpinkdesign.com |
| **Enterprise** | SLA-backed | Contact for pricing |

---

## Contact

- **Email**: alex@zanderpinkdesign.com
- **GitHub**: [@zanderone1980](https://github.com/zanderone1980)
- **X**: [@alexpinkone](https://x.com/alexpinkone)
