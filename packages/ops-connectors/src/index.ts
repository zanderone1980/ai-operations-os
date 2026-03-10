/**
 * @ai-operations/ops-connectors
 *
 * Connector framework and stub implementations for the AI Operations OS.
 * Provides a BaseConnector abstract class, a ConnectorRegistry for managing
 * connector instances, and stub connectors for Gmail, Google Calendar,
 * X (Twitter), and Shopify.
 */

// Base class and types
export { BaseConnector } from './base';
export type { ConnectorConfig, ConnectorResult } from './base';

// Connector implementations
export { GmailConnector } from './gmail';
export { CalendarConnector } from './calendar';
export { XTwitterConnector } from './x-twitter';
export { ShopifyConnector } from './shopify';

// Registry
export { ConnectorRegistry } from './registry';

// Resilient fetch (retry + rate limiting)
export { resilientFetch, RateLimiter } from './resilient-fetch';
export type { ResilientFetchOptions, FetchAttemptResult, RateLimiterOptions } from './resilient-fetch';
