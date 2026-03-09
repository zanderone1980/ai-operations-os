import { createWorkflowRun, createStep } from '../workflow';

describe('createStep', () => {
  it('creates a step with connector, operation, and input', () => {
    const step = createStep('gmail', 'send', { to: 'user@example.com' });
    expect(step.connector).toBe('gmail');
    expect(step.operation).toBe('send');
    expect(step.input).toEqual({ to: 'user@example.com' });
  });

  it('defaults input to an empty object when not provided', () => {
    const step = createStep('calendar', 'list');
    expect(step.input).toEqual({});
  });
});

describe('createWorkflowRun', () => {
  it('creates a run with correct taskId and workflowType', () => {
    const steps = [createStep('gmail', 'read')];
    const run = createWorkflowRun('task-1', 'email-reply', steps);

    expect(run.taskId).toBe('task-1');
    expect(run.workflowType).toBe('email-reply');
  });

  it('generates a unique UUID for run id', () => {
    const steps = [createStep('gmail', 'read')];
    const r1 = createWorkflowRun('t-1', 'wf-1', steps);
    const r2 = createWorkflowRun('t-2', 'wf-2', steps);
    expect(r1.id).not.toBe(r2.id);
  });

  it('sets initial state to queued', () => {
    const run = createWorkflowRun('t-1', 'wf-1', [createStep('gmail', 'read')]);
    expect(run.state).toBe('queued');
  });

  it('sets startedAt to an ISO timestamp', () => {
    const before = new Date().toISOString();
    const run = createWorkflowRun('t-1', 'wf-1', [createStep('gmail', 'read')]);
    const after = new Date().toISOString();

    expect(run.startedAt >= before).toBe(true);
    expect(run.startedAt <= after).toBe(true);
  });

  it('assigns unique IDs and pending status to each step', () => {
    const steps = [
      createStep('gmail', 'read'),
      createStep('gmail', 'send', { body: 'reply' }),
    ];
    const run = createWorkflowRun('t-1', 'email-reply', steps);

    expect(run.steps).toHaveLength(2);
    expect(run.steps[0].id).toBeDefined();
    expect(run.steps[1].id).toBeDefined();
    expect(run.steps[0].id).not.toBe(run.steps[1].id);
    expect(run.steps[0].status).toBe('pending');
    expect(run.steps[1].status).toBe('pending');
  });

  it('preserves step connector, operation, and input', () => {
    const steps = [
      createStep('calendar', 'create_event', { title: 'Meeting', time: '10am' }),
    ];
    const run = createWorkflowRun('t-1', 'calendar-accept', steps);

    expect(run.steps[0].connector).toBe('calendar');
    expect(run.steps[0].operation).toBe('create_event');
    expect(run.steps[0].input).toEqual({ title: 'Meeting', time: '10am' });
  });

  it('handles an empty steps array', () => {
    const run = createWorkflowRun('t-1', 'empty-workflow', []);
    expect(run.steps).toHaveLength(0);
    expect(run.state).toBe('queued');
  });

  it('does not set endedAt or error by default', () => {
    const run = createWorkflowRun('t-1', 'wf-1', [createStep('gmail', 'read')]);
    expect(run.endedAt).toBeUndefined();
    expect(run.error).toBeUndefined();
  });
});
