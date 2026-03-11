/**
 * Input Validation Middleware — Unit Tests
 */

import {
  validateBody,
  taskCreateSchema,
  approvalDecisionSchema,
  workflowCreateSchema,
  pipelineSimulateSchema,
  sparkChatSchema,
  webhookGenericSchema,
  connectorExecuteSchema,
} from '../middleware/validate';
import type { ValidationSchema } from '../middleware/validate';

// ── Basic Validation ─────────────────────────────────────────────────────────

describe('validateBody', () => {
  const testSchema: ValidationSchema = {
    name: { type: 'string', required: true, maxLength: 50 },
    age: { type: 'number', required: false },
    active: { type: 'boolean', required: false },
    role: { type: 'string', required: true, enum: ['admin', 'user', 'guest'] },
    meta: { type: 'object', required: false },
  };

  const validate = validateBody(testSchema);

  test('valid body passes validation', () => {
    const result = validate({ name: 'Alice', role: 'admin' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe('Alice');
    }
  });

  test('valid body with all optional fields passes', () => {
    const result = validate({
      name: 'Bob',
      age: 30,
      active: true,
      role: 'user',
      meta: { foo: 'bar' },
    });
    expect(result.ok).toBe(true);
  });

  test('missing required field returns error', () => {
    const result = validate({ role: 'admin' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*name/i);
    }
  });

  test('missing second required field returns error', () => {
    const result = validate({ name: 'Alice' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*role/i);
    }
  });

  test('empty string for required field returns error', () => {
    const result = validate({ name: '', role: 'admin' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*name/i);
    }
  });

  test('wrong type returns error', () => {
    const result = validate({ name: 123, role: 'admin' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be of type string.*got number/i);
    }
  });

  test('wrong type for number field returns error', () => {
    const result = validate({ name: 'Alice', role: 'admin', age: 'not-a-number' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be of type number.*got string/i);
    }
  });

  test('wrong type for boolean field returns error', () => {
    const result = validate({ name: 'Alice', role: 'admin', active: 'yes' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be of type boolean.*got string/i);
    }
  });

  test('array for object field returns error', () => {
    const result = validate({ name: 'Alice', role: 'admin', meta: [1, 2, 3] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be of type object.*got array/i);
    }
  });

  test('exceeds maxLength returns error', () => {
    const result = validate({ name: 'A'.repeat(51), role: 'admin' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exceeds maximum length of 50/i);
    }
  });

  test('string at exact maxLength passes', () => {
    const result = validate({ name: 'A'.repeat(50), role: 'admin' });
    expect(result.ok).toBe(true);
  });

  test('invalid enum value returns error', () => {
    const result = validate({ name: 'Alice', role: 'superadmin' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be one of.*admin.*user.*guest/i);
      expect(result.error).toMatch(/got 'superadmin'/i);
    }
  });

  test('valid enum value passes', () => {
    const result = validate({ name: 'Alice', role: 'guest' });
    expect(result.ok).toBe(true);
  });

  test('null body returns error', () => {
    const result = validate(null as any);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be a json object/i);
    }
  });

  test('optional fields can be omitted', () => {
    const result = validate({ name: 'Alice', role: 'user' });
    expect(result.ok).toBe(true);
  });
});

// ── Schema-Specific Tests ────────────────────────────────────────────────────

describe('taskCreateSchema', () => {
  const validate = validateBody(taskCreateSchema);

  test('valid task creation body passes', () => {
    const result = validate({
      source: 'email',
      title: 'Handle customer inquiry',
      body: 'Please look into this issue.',
      intent: 'reply',
      priority: 'high',
    });
    expect(result.ok).toBe(true);
  });

  test('minimal valid body (required fields only) passes', () => {
    const result = validate({ source: 'manual', title: 'Quick task' });
    expect(result.ok).toBe(true);
  });

  test('invalid source enum rejected', () => {
    const result = validate({ source: 'sms', title: 'Test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be one of/i);
    }
  });

  test('title exceeding 500 chars rejected', () => {
    const result = validate({ source: 'email', title: 'X'.repeat(501) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exceeds maximum length of 500/i);
    }
  });

  test('body exceeding 50000 chars rejected', () => {
    const result = validate({ source: 'email', title: 'OK', body: 'Y'.repeat(50001) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exceeds maximum length of 50000/i);
    }
  });
});

describe('approvalDecisionSchema', () => {
  const validate = validateBody(approvalDecisionSchema);

  test('valid approval passes', () => {
    const result = validate({ decision: 'approved', decidedBy: 'admin-user' });
    expect(result.ok).toBe(true);
  });

  test('valid denial passes', () => {
    const result = validate({ decision: 'denied' });
    expect(result.ok).toBe(true);
  });

  test('missing decision rejected', () => {
    const result = validate({ decidedBy: 'someone' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*decision/i);
    }
  });

  test('invalid decision value rejected', () => {
    const result = validate({ decision: 'maybe' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be one of.*approved.*denied/i);
    }
  });
});

describe('workflowCreateSchema', () => {
  const validate = validateBody(workflowCreateSchema);

  test('valid workflow creation passes', () => {
    const result = validate({
      taskId: 'task-123',
      workflowType: 'reply-workflow',
      steps: { step1: 'read', step2: 'reply' },
    });
    expect(result.ok).toBe(true);
  });

  test('missing taskId rejected', () => {
    const result = validate({ workflowType: 'reply', steps: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*taskId/i);
    }
  });

  test('missing steps rejected', () => {
    const result = validate({ taskId: 'task-1', workflowType: 'reply' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*steps/i);
    }
  });
});

describe('pipelineSimulateSchema', () => {
  const validate = validateBody(pipelineSimulateSchema);

  test('valid simulation body passes', () => {
    const result = validate({ source: 'email', title: 'Test email pipeline' });
    expect(result.ok).toBe(true);
  });

  test('missing source rejected', () => {
    const result = validate({ title: 'No source' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*source/i);
    }
  });

  test('missing title rejected', () => {
    const result = validate({ source: 'manual' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*title/i);
    }
  });

  test('invalid source enum rejected', () => {
    const result = validate({ source: 'fax', title: 'Test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be one of/i);
    }
  });

  test('slack source accepted', () => {
    const result = validate({ source: 'slack', title: 'Slack pipeline' });
    expect(result.ok).toBe(true);
  });

  test('notion source accepted', () => {
    const result = validate({ source: 'notion', title: 'Notion pipeline' });
    expect(result.ok).toBe(true);
  });
});

// ── New Schemas ────────────────────────────────────────────────────────────

describe('sparkChatSchema', () => {
  const validate = validateBody(sparkChatSchema);

  test('valid chat message passes', () => {
    const result = validate({ message: 'What are the current weights?' });
    expect(result.ok).toBe(true);
  });

  test('valid chat with conversationId passes', () => {
    const result = validate({ message: 'Hello', conversationId: 'conv-123' });
    expect(result.ok).toBe(true);
  });

  test('missing message rejected', () => {
    const result = validate({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*message/i);
    }
  });

  test('non-string message rejected', () => {
    const result = validate({ message: 12345 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be of type string/i);
    }
  });

  test('message exceeding 10000 chars rejected', () => {
    const result = validate({ message: 'x'.repeat(10001) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exceeds maximum length of 10000/i);
    }
  });
});

describe('webhookGenericSchema', () => {
  const validate = validateBody(webhookGenericSchema);

  test('valid webhook body passes', () => {
    const result = validate({ title: 'External event', source: 'manual' });
    expect(result.ok).toBe(true);
  });

  test('valid with slack source passes', () => {
    const result = validate({ title: 'Slack event', source: 'slack' });
    expect(result.ok).toBe(true);
  });

  test('missing title rejected', () => {
    const result = validate({ source: 'email' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*title/i);
    }
  });

  test('invalid source enum rejected', () => {
    const result = validate({ title: 'Test', source: 'telegram' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be one of/i);
    }
  });
});

describe('connectorExecuteSchema', () => {
  const validate = validateBody(connectorExecuteSchema);

  test('valid execute body passes', () => {
    const result = validate({ operation: 'read', input: { id: '123' } });
    expect(result.ok).toBe(true);
  });

  test('operation only passes (input is optional)', () => {
    const result = validate({ operation: 'list' });
    expect(result.ok).toBe(true);
  });

  test('missing operation rejected', () => {
    const result = validate({ input: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing required field.*operation/i);
    }
  });
});

describe('taskCreateSchema — extended sources', () => {
  const validate = validateBody(taskCreateSchema);

  test('slack source accepted', () => {
    const result = validate({ source: 'slack', title: 'Slack task' });
    expect(result.ok).toBe(true);
  });

  test('notion source accepted', () => {
    const result = validate({ source: 'notion', title: 'Notion task' });
    expect(result.ok).toBe(true);
  });
});

describe('approvalDecisionSchema — modified decision', () => {
  const validate = validateBody(approvalDecisionSchema);

  test('modified decision accepted', () => {
    const result = validate({ decision: 'modified' });
    expect(result.ok).toBe(true);
  });
});
