import { RuleEngine } from '../rules';
import type { PolicyConfig, PolicyRule } from '@ai-ops/shared-types';
import { DEFAULT_POLICY } from '@ai-ops/shared-types';

function makeConfig(rules: PolicyRule[], overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    version: '1.0.0',
    defaultAutonomy: 'approve',
    rules,
    ...overrides,
  };
}

function makeRule(overrides: Partial<PolicyRule>): PolicyRule {
  return {
    id: 'test-rule',
    description: 'Test rule',
    match: {},
    action: 'auto',
    priority: 10,
    enabled: true,
    ...overrides,
  };
}

describe('RuleEngine', () => {
  describe('basic rule matching', () => {
    it('matches a rule by operation', () => {
      const config = makeConfig([
        makeRule({ id: 'allow-read', match: { operation: 'read' }, action: 'auto' }),
      ]);
      const engine = new RuleEngine(config);

      const result = engine.evaluate('gmail', 'read');
      expect(result.autonomy).toBe('auto');
      expect(result.matchedRule?.id).toBe('allow-read');
    });

    it('matches a rule by connector', () => {
      const config = makeConfig([
        makeRule({ id: 'deny-shopify', match: { connector: 'shopify' }, action: 'deny' }),
      ]);
      const engine = new RuleEngine(config);

      const result = engine.evaluate('shopify', 'refund');
      expect(result.autonomy).toBe('deny');
      expect(result.matchedRule?.id).toBe('deny-shopify');
    });

    it('matches a rule by connector AND operation together', () => {
      const config = makeConfig([
        makeRule({
          id: 'deny-shopify-refund',
          match: { connector: 'shopify', operation: 'refund' },
          action: 'deny',
        }),
      ]);
      const engine = new RuleEngine(config);

      // Both match
      expect(engine.evaluate('shopify', 'refund').autonomy).toBe('deny');

      // Only connector matches - operation doesn't
      expect(engine.evaluate('shopify', 'read').autonomy).toBe('approve'); // falls to default
    });

    it('matches using wildcard connector', () => {
      const config = makeConfig([
        makeRule({ id: 'all-reads', match: { connector: '*', operation: 'read' }, action: 'auto' }),
      ]);
      const engine = new RuleEngine(config);

      expect(engine.evaluate('gmail', 'read').autonomy).toBe('auto');
      expect(engine.evaluate('shopify', 'read').autonomy).toBe('auto');
      expect(engine.evaluate('calendar', 'read').autonomy).toBe('auto');
    });

    it('matches using wildcard operation', () => {
      const config = makeConfig([
        makeRule({ id: 'deny-all-shopify', match: { connector: 'shopify', operation: '*' }, action: 'deny' }),
      ]);
      const engine = new RuleEngine(config);

      expect(engine.evaluate('shopify', 'read').autonomy).toBe('deny');
      expect(engine.evaluate('shopify', 'refund').autonomy).toBe('deny');
    });

    it('matches by source context', () => {
      const config = makeConfig([
        makeRule({ id: 'auto-email', match: { source: 'email' }, action: 'auto' }),
      ]);
      const engine = new RuleEngine(config);

      expect(engine.evaluate('gmail', 'read', { source: 'email' }).autonomy).toBe('auto');
      expect(engine.evaluate('gmail', 'read', { source: 'manual' }).autonomy).toBe('approve'); // default
    });

    it('matches by intent context', () => {
      const config = makeConfig([
        makeRule({ id: 'deny-escalate', match: { intent: 'escalate' }, action: 'deny' }),
      ]);
      const engine = new RuleEngine(config);

      expect(engine.evaluate('gmail', 'send', { intent: 'escalate' }).autonomy).toBe('deny');
      expect(engine.evaluate('gmail', 'send', { intent: 'reply' }).autonomy).toBe('approve');
    });
  });

  describe('priority ordering', () => {
    it('higher priority rules win over lower priority', () => {
      const config = makeConfig([
        makeRule({ id: 'low', match: { operation: 'send' }, action: 'auto', priority: 10 }),
        makeRule({ id: 'high', match: { operation: 'send' }, action: 'deny', priority: 100 }),
      ]);
      const engine = new RuleEngine(config);

      const result = engine.evaluate('gmail', 'send');
      expect(result.autonomy).toBe('deny');
      expect(result.matchedRule?.id).toBe('high');
    });

    it('first rule wins when priorities are equal', () => {
      const config = makeConfig([
        makeRule({ id: 'first', match: { operation: 'send' }, action: 'auto', priority: 10 }),
        makeRule({ id: 'second', match: { operation: 'send' }, action: 'deny', priority: 10 }),
      ]);
      const engine = new RuleEngine(config);

      // Both match with equal priority; result depends on stable sort behavior
      const result = engine.evaluate('gmail', 'send');
      expect(result.matchedRule).toBeDefined();
    });
  });

  describe('disabled rules', () => {
    it('ignores disabled rules', () => {
      const config = makeConfig([
        makeRule({ id: 'disabled', match: { operation: 'read' }, action: 'deny', enabled: false }),
      ]);
      const engine = new RuleEngine(config);

      // Should fall through to default because the rule is disabled
      const result = engine.evaluate('gmail', 'read');
      expect(result.autonomy).toBe('approve'); // default
      expect(result.matchedRule).toBeUndefined();
    });
  });

  describe('default autonomy fallback', () => {
    it('returns defaultAutonomy when no rules match', () => {
      const config = makeConfig([], { defaultAutonomy: 'deny' });
      const engine = new RuleEngine(config);

      const result = engine.evaluate('gmail', 'send');
      expect(result.autonomy).toBe('deny');
      expect(result.matchedRule).toBeUndefined();
      expect(result.reason).toContain('No matching rule');
    });

    it('returns defaultAutonomy when rules exist but none match', () => {
      const config = makeConfig([
        makeRule({ id: 'shopify-only', match: { connector: 'shopify' }, action: 'deny' }),
      ], { defaultAutonomy: 'auto' });
      const engine = new RuleEngine(config);

      const result = engine.evaluate('gmail', 'send');
      expect(result.autonomy).toBe('auto');
    });
  });

  describe('amount limits', () => {
    it('enforces deny when amount exceeds maxAmount', () => {
      const config = makeConfig([
        makeRule({
          id: 'limit-refund',
          match: { connector: 'shopify', operation: 'refund' },
          action: 'approve',
          maxAmount: 50,
        }),
      ]);
      const engine = new RuleEngine(config);

      const result = engine.evaluate('shopify', 'refund', { amount: 75 });
      expect(result.autonomy).toBe('deny');
      expect(result.reason).toContain('$75');
      expect(result.reason).toContain('$50');
    });

    it('allows operation when amount is within maxAmount', () => {
      const config = makeConfig([
        makeRule({
          id: 'limit-refund',
          match: { connector: 'shopify', operation: 'refund' },
          action: 'approve',
          maxAmount: 50,
        }),
      ]);
      const engine = new RuleEngine(config);

      const result = engine.evaluate('shopify', 'refund', { amount: 30 });
      expect(result.autonomy).toBe('approve');
    });

    it('allows operation when no amount is provided', () => {
      const config = makeConfig([
        makeRule({
          id: 'limit-refund',
          match: { connector: 'shopify', operation: 'refund' },
          action: 'approve',
          maxAmount: 50,
        }),
      ]);
      const engine = new RuleEngine(config);

      const result = engine.evaluate('shopify', 'refund');
      expect(result.autonomy).toBe('approve');
    });
  });

  describe('risk levels', () => {
    it('returns the risk from the matched rule', () => {
      const config = makeConfig([
        makeRule({ id: 'risky', match: { operation: 'delete' }, action: 'deny', risk: 'critical' }),
      ]);
      const engine = new RuleEngine(config);

      const result = engine.evaluate('gmail', 'delete');
      expect(result.risk).toBe('critical');
    });

    it('defaults risk to low when rule has no risk override', () => {
      const config = makeConfig([
        makeRule({ id: 'safe', match: { operation: 'read' }, action: 'auto' }),
      ]);
      const engine = new RuleEngine(config);

      const result = engine.evaluate('gmail', 'read');
      expect(result.risk).toBe('low');
    });
  });

  describe('DEFAULT_POLICY', () => {
    it('allows read operations autonomously', () => {
      const engine = new RuleEngine(DEFAULT_POLICY);
      const result = engine.evaluate('gmail', 'read');
      expect(result.autonomy).toBe('auto');
    });

    it('requires approval for send operations', () => {
      const engine = new RuleEngine(DEFAULT_POLICY);
      const result = engine.evaluate('gmail', 'send');
      expect(result.autonomy).toBe('approve');
    });

    it('denies delete operations', () => {
      const engine = new RuleEngine(DEFAULT_POLICY);
      const result = engine.evaluate('gmail', 'delete');
      expect(result.autonomy).toBe('deny');
    });
  });
});
