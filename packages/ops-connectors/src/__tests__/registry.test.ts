import { ConnectorRegistry } from '../registry';
import { BaseConnector, ConnectorConfig, ConnectorResult } from '../base';

// ---------------------------------------------------------------------------
// Mock connector class
// ---------------------------------------------------------------------------

class MockConnector extends BaseConnector {
  private _healthy: boolean;
  private _ops: string[];

  constructor(name: string, healthy = true, ops: string[] = ['op1']) {
    super({ name, enabled: true } as ConnectorConfig);
    this._healthy = healthy;
    this._ops = ops;
  }

  get supportedOperations(): string[] {
    return this._ops;
  }

  async execute(
    operation: string,
    _input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    if (!this._ops.includes(operation)) {
      return { success: false, error: `Unsupported: ${operation}` };
    }
    return { success: true, data: { operation } };
  }

  async healthCheck(): Promise<boolean> {
    return this._healthy;
  }
}

class ThrowingConnector extends BaseConnector {
  constructor(name: string) {
    super({ name, enabled: true } as ConnectorConfig);
  }

  get supportedOperations(): string[] {
    return [];
  }

  async execute(): Promise<ConnectorResult> {
    throw new Error('boom');
  }

  async healthCheck(): Promise<boolean> {
    throw new Error('health boom');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectorRegistry', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry();
  });

  // ── register / get ────────────────────────────────────────────────────

  it('should register and retrieve a connector by name', () => {
    const c = new MockConnector('gmail');
    registry.register(c);
    expect(registry.get('gmail')).toBe(c);
  });

  it('should return undefined for an unregistered connector', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should replace a connector if registered with the same name', () => {
    const c1 = new MockConnector('gmail', true);
    const c2 = new MockConnector('gmail', false);
    registry.register(c1);
    registry.register(c2);
    expect(registry.get('gmail')).toBe(c2);
  });

  // ── list ──────────────────────────────────────────────────────────────

  it('should list all registered connectors', () => {
    registry.register(new MockConnector('a'));
    registry.register(new MockConnector('b'));
    registry.register(new MockConnector('c'));
    const list = registry.list();
    expect(list).toHaveLength(3);
    const names = list.map((c) => c.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toContain('c');
  });

  it('should return empty array when no connectors registered', () => {
    expect(registry.list()).toEqual([]);
  });

  // ── healthCheckAll ────────────────────────────────────────────────────

  it('should return all healthy results', async () => {
    registry.register(new MockConnector('gmail', true));
    registry.register(new MockConnector('calendar', true));

    const results = await registry.healthCheckAll();

    expect(results.get('gmail')).toBe(true);
    expect(results.get('calendar')).toBe(true);
    expect(results.size).toBe(2);
  });

  it('should return mixed healthy/unhealthy results', async () => {
    registry.register(new MockConnector('gmail', true));
    registry.register(new MockConnector('shopify', false));

    const results = await registry.healthCheckAll();

    expect(results.get('gmail')).toBe(true);
    expect(results.get('shopify')).toBe(false);
  });

  it('should mark a connector as unhealthy if healthCheck throws', async () => {
    registry.register(new MockConnector('gmail', true));
    registry.register(new ThrowingConnector('bad'));

    const results = await registry.healthCheckAll();

    expect(results.get('gmail')).toBe(true);
    expect(results.get('bad')).toBe(false);
  });

  it('should return empty map when no connectors registered', async () => {
    const results = await registry.healthCheckAll();
    expect(results.size).toBe(0);
  });

  it('should handle a single registered connector', async () => {
    registry.register(new MockConnector('solo', true));
    const results = await registry.healthCheckAll();
    expect(results.size).toBe(1);
    expect(results.get('solo')).toBe(true);
  });

  // ── BaseConnector via MockConnector ───────────────────────────────────

  it('should correctly report supportsOperation', () => {
    const c = new MockConnector('test', true, ['read', 'write']);
    expect(c.supportsOperation('read')).toBe(true);
    expect(c.supportsOperation('delete')).toBe(false);
  });

  it('should correctly report isEnabled', () => {
    const c = new MockConnector('test');
    expect(c.isEnabled()).toBe(true);
  });
});
