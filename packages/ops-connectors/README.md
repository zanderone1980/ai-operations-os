# @ai-ops/ops-connectors

> Connector framework with Gmail, Calendar, X/Twitter, and Shopify integrations for AI Operations OS.

Part of [AI Operations OS](https://github.com/zanderone1980/ai-operations-os) — autonomous business workflow orchestration with safety enforcement.

## Install

```
npm install @ai-ops/ops-connectors
```

## Quick Start

```ts
import { ConnectorRegistry, GmailConnector, resilientFetch, RateLimiter } from '@ai-ops/ops-connectors';

const registry = new ConnectorRegistry();
registry.register(new GmailConnector({ name: 'gmail', enabled: true, credentials: { token: '...' } }));

const gmail = registry.get('gmail');
const result = await gmail.execute('send', { to: 'user@example.com', body: 'Hello!' });
```

## API

### `BaseConnector` (abstract)

Abstract base class for all connectors. Subclasses implement `supportedOperations`, `execute`, and `healthCheck`.

```ts
abstract get supportedOperations(): string[]
abstract execute(operation: string, input: Record<string, unknown>): Promise<ConnectorResult>
abstract healthCheck(): Promise<boolean>
supportsOperation(operation: string): boolean
isEnabled(): boolean
```

- `ConnectorConfig` — `{ name: string; enabled: boolean; credentials?: Record<string, string> }`
- `ConnectorResult` — `{ success: boolean; data?: Record<string, unknown>; error?: string }`

### Connector Implementations

| Connector | Class | Operations |
|-----------|-------|-----------|
| Gmail | `GmailConnector` | send, read, list, search |
| Google Calendar | `CalendarConnector` | create_event, update_event, cancel_event, list |
| X / Twitter | `XTwitterConnector` | post, delete, search |
| Shopify | `ShopifyConnector` | fulfill, refund, list, get |

### `ConnectorRegistry`

Central registry for managing connector instances with bulk health checks.

```ts
register(connector: BaseConnector): void
get(name: string): BaseConnector | undefined
list(): BaseConnector[]
healthCheckAll(): Promise<Map<string, boolean>>
```

### `resilientFetch(url, init?, options?): Promise<FetchAttemptResult>`

Retry-aware HTTP client with exponential backoff, 429 Retry-After support, request timeouts, and jitter.

```ts
const { response, attempts, totalDurationMs } = await resilientFetch(
  'https://api.example.com/data',
  { method: 'GET', headers: { Authorization: 'Bearer token' } },
  { maxRetries: 3, timeoutMs: 10000 },
);
```

- `ResilientFetchOptions` — `{ maxRetries?, initialDelayMs?, maxDelayMs?, timeoutMs?, retryableStatuses? }`

### `RateLimiter`

Sliding-window rate limiter for per-connector request throttling.

```ts
const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60000 });
if (limiter.canProceed()) {
  limiter.record();
  await fetch(...);
}
await limiter.waitAndRecord(); // Block until a slot opens
```

## Related Packages

- [`@ai-ops/shared-types`](../shared-types) — Core types consumed by connectors
- [`@ai-ops/ops-core`](../ops-core) — WorkflowEngine that executes connector operations
- [`@ai-ops/cord-adapter`](../cord-adapter) — Safety gate evaluated before connector execution

## License

MIT
