/**
 * Configuration for a connector instance.
 */
export interface ConnectorConfig {
  /** Unique name identifying this connector */
  name: string;
  /** Whether this connector is active and available for use */
  enabled: boolean;
  /** Optional key-value map of API credentials (tokens, keys, secrets) */
  credentials?: Record<string, string>;
}

/**
 * Standardized result returned by all connector operations.
 */
export interface ConnectorResult {
  /** Whether the operation completed successfully */
  success: boolean;
  /** Arbitrary data payload returned on success */
  data?: Record<string, unknown>;
  /** Human-readable error message on failure */
  error?: string;
}

/**
 * Abstract base class for all connectors in the AI Operations OS.
 *
 * Subclasses must implement `supportedOperations`, `execute`, and `healthCheck`
 * to provide integration with a specific external service.
 */
export abstract class BaseConnector {
  /** The display name of this connector */
  readonly name: string;

  /** Internal configuration for this connector */
  protected config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    this.name = config.name;
    this.config = config;
  }

  /**
   * Returns the list of operation identifiers this connector can handle.
   */
  abstract get supportedOperations(): string[];

  /**
   * Execute a named operation with the given input parameters.
   *
   * @param operation - The operation identifier (must be in `supportedOperations`)
   * @param input - Key-value input parameters for the operation
   * @returns A promise resolving to a `ConnectorResult`
   */
  abstract execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<ConnectorResult>;

  /**
   * Perform a health check to verify the connector can reach its backing service.
   *
   * @returns A promise resolving to `true` if healthy, `false` otherwise
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Check whether this connector supports a given operation.
   *
   * @param operation - The operation identifier to check
   * @returns `true` if the operation is supported
   */
  supportsOperation(operation: string): boolean {
    return this.supportedOperations.includes(operation);
  }

  /**
   * Check whether this connector is currently enabled.
   *
   * @returns `true` if the connector is enabled in its configuration
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
