import { BaseConnector } from './base';

/**
 * Central registry for managing connector instances.
 *
 * The registry provides a single place to register, retrieve, and inspect
 * all available connectors. It also supports running health checks across
 * every registered connector at once.
 */
export class ConnectorRegistry {
  /** Internal map of connector name to connector instance */
  private connectors: Map<string, BaseConnector> = new Map();

  /**
   * Register a connector instance in the registry.
   *
   * If a connector with the same name already exists, it will be replaced.
   *
   * @param connector - The connector instance to register
   */
  register(connector: BaseConnector): void {
    this.connectors.set(connector.name, connector);
  }

  /**
   * Retrieve a registered connector by name.
   *
   * @param name - The name of the connector to look up
   * @returns The connector instance, or `undefined` if not found
   */
  get(name: string): BaseConnector | undefined {
    return this.connectors.get(name);
  }

  /**
   * List all registered connectors.
   *
   * @returns An array of all registered connector instances
   */
  list(): BaseConnector[] {
    return Array.from(this.connectors.values());
  }

  /**
   * Run health checks on all registered connectors concurrently.
   *
   * @returns A map of connector name to health check result (`true` = healthy)
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const entries = Array.from(this.connectors.entries());

    const checks = await Promise.allSettled(
      entries.map(async ([name, connector]) => {
        try {
          const healthy = await connector.healthCheck();
          return { name, healthy };
        } catch {
          return { name, healthy: false };
        }
      }),
    );

    for (const check of checks) {
      if (check.status === 'fulfilled') {
        results.set(check.value.name, check.value.healthy);
      } else {
        // This branch should not be reached given the inner try/catch,
        // but we handle it defensively.
        results.set('unknown', false);
      }
    }

    return results;
  }
}
