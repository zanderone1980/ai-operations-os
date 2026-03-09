import { createAction } from '../action';

describe('createAction', () => {
  it('creates an action with all required fields', () => {
    const action = createAction(
      'run-1',
      'step-1',
      'gmail',
      'send',
      { to: 'user@example.com', body: 'Hello' },
    );

    expect(action.runId).toBe('run-1');
    expect(action.stepId).toBe('step-1');
    expect(action.connector).toBe('gmail');
    expect(action.operation).toBe('send');
    expect(action.input).toEqual({ to: 'user@example.com', body: 'Hello' });
  });

  it('sets default status to pending', () => {
    const action = createAction('run-1', 'step-1', 'gmail', 'send', {});
    expect(action.status).toBe('pending');
  });

  it('generates a unique UUID for id', () => {
    const a1 = createAction('run-1', 'step-1', 'gmail', 'send', {});
    const a2 = createAction('run-1', 'step-1', 'gmail', 'send', {});
    expect(a1.id).not.toBe(a2.id);
    expect(a1.id.length).toBeGreaterThan(0);
  });

  it('does not set optional fields by default', () => {
    const action = createAction('run-1', 'step-1', 'calendar', 'create_event', {});
    expect(action.output).toBeUndefined();
    expect(action.executedAt).toBeUndefined();
    expect(action.durationMs).toBeUndefined();
    expect(action.error).toBeUndefined();
  });

  it('preserves complex input data', () => {
    const input = {
      recipients: ['a@b.com', 'c@d.com'],
      subject: 'Test',
      nested: { key: 'value', num: 42 },
    };
    const action = createAction('run-1', 'step-1', 'gmail', 'send', input);
    expect(action.input).toEqual(input);
  });
});
