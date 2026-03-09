import { createTask } from '../task';
import type { Task } from '../task';

describe('createTask', () => {
  it('creates a task with required fields and sensible defaults', () => {
    const task = createTask({ source: 'email', title: 'Test task' });

    expect(task.source).toBe('email');
    expect(task.title).toBe('Test task');
    expect(task.id).toBeDefined();
    expect(typeof task.id).toBe('string');
    expect(task.id.length).toBeGreaterThan(0);
  });

  it('sets default status to pending', () => {
    const task = createTask({ source: 'manual', title: 'My task' });
    expect(task.status).toBe('pending');
  });

  it('sets default priority to normal', () => {
    const task = createTask({ source: 'store', title: 'Order task' });
    expect(task.priority).toBe('normal');
  });

  it('sets default intent to unknown', () => {
    const task = createTask({ source: 'social', title: 'Social mention' });
    expect(task.intent).toBe('unknown');
  });

  it('sets createdAt and updatedAt to ISO strings', () => {
    const before = new Date().toISOString();
    const task = createTask({ source: 'email', title: 'Timed task' });
    const after = new Date().toISOString();

    expect(task.createdAt).toBeDefined();
    expect(task.updatedAt).toBeDefined();
    expect(task.createdAt >= before).toBe(true);
    expect(task.createdAt <= after).toBe(true);
    expect(task.createdAt).toBe(task.updatedAt);
  });

  it('initializes metadata as an empty object by default', () => {
    const task = createTask({ source: 'email', title: 'Meta task' });
    expect(task.metadata).toEqual({});
  });

  it('allows overriding defaults via partial', () => {
    const task = createTask({
      source: 'store',
      title: 'Urgent order',
      priority: 'urgent',
      intent: 'fulfill',
      status: 'running',
      owner: 'alice',
      body: 'Process order #123',
      metadata: { orderId: '123' },
    });

    expect(task.priority).toBe('urgent');
    expect(task.intent).toBe('fulfill');
    expect(task.status).toBe('running');
    expect(task.owner).toBe('alice');
    expect(task.body).toBe('Process order #123');
    expect(task.metadata).toEqual({ orderId: '123' });
  });

  it('generates unique IDs for different tasks', () => {
    const task1 = createTask({ source: 'email', title: 'Task 1' });
    const task2 = createTask({ source: 'email', title: 'Task 2' });
    expect(task1.id).not.toBe(task2.id);
  });

  it('preserves optional fields when not provided', () => {
    const task = createTask({ source: 'calendar', title: 'Meeting' });
    expect(task.body).toBeUndefined();
    expect(task.owner).toBeUndefined();
    expect(task.dueAt).toBeUndefined();
    expect(task.sourceId).toBeUndefined();
  });

  it('allows setting dueAt and sourceId', () => {
    const task = createTask({
      source: 'email',
      title: 'Due task',
      dueAt: '2025-12-31T23:59:59.000Z',
      sourceId: 'msg-abc-123',
    });
    expect(task.dueAt).toBe('2025-12-31T23:59:59.000Z');
    expect(task.sourceId).toBe('msg-abc-123');
  });
});
