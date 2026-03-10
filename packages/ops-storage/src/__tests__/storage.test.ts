import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../database';
import { TaskStore } from '../task-store';
import { ApprovalStore } from '../approval-store';
import { WorkflowStore } from '../workflow-store';
import { createStores } from '../index';
import type { Task } from '@ai-operations/shared-types';
import type { Approval, WorkflowRun, WorkflowStep } from '@ai-operations/shared-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

/** Create a temp directory for each test suite run. */
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ops-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a fresh DB path for each test. */
let dbCounter = 0;
function freshDbPath(): string {
  dbCounter++;
  return path.join(tmpDir, `test-${dbCounter}.db`);
}

/** Create a minimal valid Task. */
function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'email',
    intent: 'reply',
    title: 'Test task',
    priority: 'normal',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

/** Create a minimal valid Approval. */
function makeApproval(overrides: Partial<Approval> = {}): Approval {
  const now = new Date().toISOString();
  return {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actionId: 'action-1',
    taskId: 'task-1',
    risk: 'medium',
    reason: 'Needs human review',
    preview: 'Send email to user@example.com',
    requestedAt: now,
    ...overrides,
  };
}

/** Create a minimal valid WorkflowStep. */
function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    connector: 'gmail',
    operation: 'send',
    input: { to: 'user@example.com' },
    status: 'pending',
    ...overrides,
  };
}

/** Create a minimal valid WorkflowRun. */
function makeWorkflowRun(
  taskId: string,
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    workflowType: 'email-reply',
    steps: [makeStep()],
    state: 'queued',
    startedAt: now,
    ...overrides,
  };
}

// ── Database initialization ──────────────────────────────────────────────────

describe('Database', () => {
  it('creates a SQLite database file at the specified path', () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
    db.close();
  });

  it('creates the tasks table', () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);

    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.name).toBe('tasks');
    db.close();
  });

  it('creates the workflow_runs table', () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);

    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_runs'")
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.name).toBe('workflow_runs');
    db.close();
  });

  it('creates the workflow_steps table', () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);

    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_steps'")
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    db.close();
  });

  it('creates the approvals table', () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);

    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='approvals'")
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    db.close();
  });

  it('creates the receipts table', () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);

    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='receipts'")
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    db.close();
  });

  it('creates the actions table', () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);

    const row = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='actions'")
      .get() as { name: string } | undefined;

    expect(row).toBeDefined();
    db.close();
  });

  it('enables WAL journal mode', () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);

    const row = db.db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(row[0].journal_mode).toBe('wal');
    db.close();
  });
});

// ── createStores ─────────────────────────────────────────────────────────────

describe('createStores', () => {
  it('returns an object with tasks, workflows, approvals, and db', () => {
    const dbPath = freshDbPath();
    const stores = createStores(dbPath);

    expect(stores.tasks).toBeInstanceOf(TaskStore);
    expect(stores.workflows).toBeInstanceOf(WorkflowStore);
    expect(stores.approvals).toBeInstanceOf(ApprovalStore);
    expect(stores.db).toBeInstanceOf(Database);

    stores.db.close();
  });
});

// ── TaskStore ────────────────────────────────────────────────────────────────

describe('TaskStore', () => {
  let db: Database;
  let store: TaskStore;

  beforeEach(() => {
    db = new Database(freshDbPath());
    store = new TaskStore(db.db);
  });

  afterEach(() => {
    db.close();
  });

  it('save() and get() round-trip a task', () => {
    const task = makeTask({ id: 'task-save-get' });
    store.save(task);

    const retrieved = store.get('task-save-get');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('task-save-get');
    expect(retrieved!.source).toBe(task.source);
    expect(retrieved!.title).toBe(task.title);
    expect(retrieved!.intent).toBe(task.intent);
    expect(retrieved!.priority).toBe(task.priority);
    expect(retrieved!.status).toBe(task.status);
  });

  it('get() returns undefined for a non-existent ID', () => {
    const result = store.get('does-not-exist');
    expect(result).toBeUndefined();
  });

  it('save() preserves metadata as JSON', () => {
    const task = makeTask({
      id: 'task-meta',
      metadata: { orderId: '123', tags: ['vip', 'rush'] },
    });
    store.save(task);

    const retrieved = store.get('task-meta');
    expect(retrieved!.metadata).toEqual({ orderId: '123', tags: ['vip', 'rush'] });
  });

  it('save() preserves optional fields (body, owner, dueAt, sourceId)', () => {
    const task = makeTask({
      id: 'task-optional',
      body: 'Full body text',
      owner: 'alice',
      dueAt: '2026-01-01T00:00:00.000Z',
      sourceId: 'ext-123',
    });
    store.save(task);

    const retrieved = store.get('task-optional');
    expect(retrieved!.body).toBe('Full body text');
    expect(retrieved!.owner).toBe('alice');
    expect(retrieved!.dueAt).toBe('2026-01-01T00:00:00.000Z');
    expect(retrieved!.sourceId).toBe('ext-123');
  });

  it('list() returns all tasks when no filter is given', () => {
    store.save(makeTask({ id: 'task-list-1' }));
    store.save(makeTask({ id: 'task-list-2' }));
    store.save(makeTask({ id: 'task-list-3' }));

    const tasks = store.list();
    expect(tasks).toHaveLength(3);
  });

  it('list() filters by status', () => {
    store.save(makeTask({ id: 't1', status: 'pending' }));
    store.save(makeTask({ id: 't2', status: 'completed' }));
    store.save(makeTask({ id: 't3', status: 'pending' }));

    const pending = store.list({ status: 'pending' });
    expect(pending).toHaveLength(2);
    expect(pending.every((t) => t.status === 'pending')).toBe(true);
  });

  it('list() filters by source', () => {
    store.save(makeTask({ id: 't1', source: 'email' }));
    store.save(makeTask({ id: 't2', source: 'store' }));
    store.save(makeTask({ id: 't3', source: 'email' }));

    const emailTasks = store.list({ source: 'email' });
    expect(emailTasks).toHaveLength(2);
    expect(emailTasks.every((t) => t.source === 'email')).toBe(true);
  });

  it('list() filters by intent', () => {
    store.save(makeTask({ id: 't1', intent: 'reply' }));
    store.save(makeTask({ id: 't2', intent: 'schedule' }));
    store.save(makeTask({ id: 't3', intent: 'reply' }));

    const replyTasks = store.list({ intent: 'reply' });
    expect(replyTasks).toHaveLength(2);
    expect(replyTasks.every((t) => t.intent === 'reply')).toBe(true);
  });

  it('list() supports limit and offset for pagination', () => {
    for (let i = 0; i < 10; i++) {
      store.save(makeTask({ id: `t-page-${i}`, updatedAt: new Date(Date.now() + i).toISOString() }));
    }

    const page = store.list({ limit: 3, offset: 0 });
    expect(page).toHaveLength(3);

    const page2 = store.list({ limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    // Pages should not overlap
    expect(page.map((t) => t.id)).not.toEqual(page2.map((t) => t.id));
  });

  it('update() merges partial updates and sets updatedAt', () => {
    const oldTimestamp = '2020-01-01T00:00:00.000Z';
    const task = makeTask({
      id: 'task-update',
      status: 'pending',
      priority: 'normal',
      updatedAt: oldTimestamp,
    });
    store.save(task);

    const updated = store.update('task-update', { status: 'completed', priority: 'high' });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('completed');
    expect(updated!.priority).toBe('high');
    expect(updated!.title).toBe(task.title); // unchanged
    // updatedAt should be refreshed to a newer timestamp
    expect(updated!.updatedAt > oldTimestamp).toBe(true);
  });

  it('update() returns undefined for a non-existent ID', () => {
    const result = store.update('ghost', { status: 'completed' });
    expect(result).toBeUndefined();
  });

  it('count() returns total number of tasks', () => {
    store.save(makeTask({ id: 'c1' }));
    store.save(makeTask({ id: 'c2' }));
    store.save(makeTask({ id: 'c3' }));

    expect(store.count()).toBe(3);
  });

  it('count() respects filter', () => {
    store.save(makeTask({ id: 'c1', status: 'pending' }));
    store.save(makeTask({ id: 'c2', status: 'completed' }));
    store.save(makeTask({ id: 'c3', status: 'pending' }));

    expect(store.count({ status: 'pending' })).toBe(2);
    expect(store.count({ status: 'completed' })).toBe(1);
  });

  it('delete() removes a task and returns true', () => {
    store.save(makeTask({ id: 'task-del' }));
    expect(store.get('task-del')).toBeDefined();

    const deleted = store.delete('task-del');
    expect(deleted).toBe(true);
    expect(store.get('task-del')).toBeUndefined();
  });

  it('delete() returns false for a non-existent ID', () => {
    const deleted = store.delete('no-such-task');
    expect(deleted).toBe(false);
  });

  it('save() with same ID replaces existing task (upsert)', () => {
    store.save(makeTask({ id: 'task-upsert', title: 'Original' }));
    store.save(makeTask({ id: 'task-upsert', title: 'Updated' }));

    const task = store.get('task-upsert');
    expect(task!.title).toBe('Updated');
    expect(store.count()).toBe(1);
  });
});

// ── ApprovalStore ────────────────────────────────────────────────────────────

describe('ApprovalStore', () => {
  let db: Database;
  let store: ApprovalStore;

  beforeEach(() => {
    db = new Database(freshDbPath());
    store = new ApprovalStore(db.db);
  });

  afterEach(() => {
    db.close();
  });

  it('save() and get() round-trip an approval', () => {
    const approval = makeApproval({ id: 'apr-1' });
    store.save(approval);

    const retrieved = store.get('apr-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('apr-1');
    expect(retrieved!.risk).toBe('medium');
    expect(retrieved!.reason).toBe('Needs human review');
  });

  it('get() returns undefined for non-existent ID', () => {
    expect(store.get('nope')).toBeUndefined();
  });

  it('listPending() returns only undecided approvals', () => {
    store.save(makeApproval({ id: 'pending-1' }));
    store.save(makeApproval({ id: 'pending-2' }));
    store.save(makeApproval({ id: 'decided-1', decision: 'approved' }));

    const pending = store.listPending();
    expect(pending).toHaveLength(2);
    expect(pending.every((a) => a.decision === undefined || a.decision === null)).toBe(true);
  });

  it('countPending() returns count of undecided approvals', () => {
    store.save(makeApproval({ id: 'p1' }));
    store.save(makeApproval({ id: 'p2' }));
    store.save(makeApproval({ id: 'd1', decision: 'denied' }));

    expect(store.countPending()).toBe(2);
  });

  it('decide() records a decision on an approval', () => {
    store.save(makeApproval({ id: 'apr-decide' }));

    store.decide('apr-decide', 'approved', 'admin');

    const decided = store.get('apr-decide');
    expect(decided).toBeDefined();
    expect(decided!.decision).toBe('approved');
    expect(decided!.decidedBy).toBe('admin');
    expect(decided!.decidedAt).toBeDefined();
  });

  it('decide() defaults decidedBy to "user"', () => {
    store.save(makeApproval({ id: 'apr-default' }));

    store.decide('apr-default', 'denied');

    const decided = store.get('apr-default');
    expect(decided!.decidedBy).toBe('user');
  });

  it('decide() with "modified" stores modifications', () => {
    store.save(makeApproval({ id: 'apr-mod' }));

    store.decide('apr-mod', 'modified', 'admin', { subject: 'Changed subject' });

    const decided = store.get('apr-mod');
    expect(decided!.decision).toBe('modified');
    expect(decided!.modifications).toEqual({ subject: 'Changed subject' });
  });

  it('decide() is a no-op for non-existent approval', () => {
    // Should not throw
    store.decide('ghost', 'approved', 'admin');
    expect(store.get('ghost')).toBeUndefined();
  });

  it('listAll() returns all approvals', () => {
    store.save(makeApproval({ id: 'a1' }));
    store.save(makeApproval({ id: 'a2', decision: 'approved' }));
    store.save(makeApproval({ id: 'a3' }));

    const all = store.listAll();
    expect(all).toHaveLength(3);
  });

  it('listAll() filters by risk', () => {
    store.save(makeApproval({ id: 'a1', risk: 'low' }));
    store.save(makeApproval({ id: 'a2', risk: 'high' }));
    store.save(makeApproval({ id: 'a3', risk: 'low' }));

    const lowRisk = store.listAll({ risk: 'low' });
    expect(lowRisk).toHaveLength(2);
  });

  it('save() preserves ttlMs field', () => {
    store.save(makeApproval({ id: 'apr-ttl', ttlMs: 30000 }));

    const retrieved = store.get('apr-ttl');
    expect(retrieved!.ttlMs).toBe(30000);
  });
});

// ── WorkflowStore ────────────────────────────────────────────────────────────

describe('WorkflowStore', () => {
  let db: Database;
  let taskStore: TaskStore;
  let store: WorkflowStore;

  beforeEach(() => {
    db = new Database(freshDbPath());
    taskStore = new TaskStore(db.db);
    store = new WorkflowStore(db.db);

    // Insert a parent task (foreign key constraint)
    taskStore.save(makeTask({ id: 'parent-task' }));
  });

  afterEach(() => {
    db.close();
  });

  it('saveRun() and getRun() round-trip a workflow run with steps', () => {
    const run = makeWorkflowRun('parent-task', { id: 'run-1' });
    store.saveRun(run);

    const retrieved = store.getRun('run-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('run-1');
    expect(retrieved!.taskId).toBe('parent-task');
    expect(retrieved!.workflowType).toBe('email-reply');
    expect(retrieved!.state).toBe('queued');
    expect(retrieved!.steps).toHaveLength(1);
  });

  it('getRun() returns undefined for non-existent ID', () => {
    expect(store.getRun('nope')).toBeUndefined();
  });

  it('saveRun() persists step details', () => {
    const step = makeStep({
      id: 'step-detail',
      connector: 'calendar',
      operation: 'create_event',
      input: { title: 'Meeting', time: '10:00' },
      status: 'completed',
      cordDecision: 'ALLOW',
      cordScore: 15,
      durationMs: 230,
    });
    const run = makeWorkflowRun('parent-task', { id: 'run-detail', steps: [step] });
    store.saveRun(run);

    const retrieved = store.getRun('run-detail');
    const s = retrieved!.steps[0];
    expect(s.connector).toBe('calendar');
    expect(s.operation).toBe('create_event');
    expect(s.input).toEqual({ title: 'Meeting', time: '10:00' });
    expect(s.status).toBe('completed');
    expect(s.cordDecision).toBe('ALLOW');
    expect(s.cordScore).toBe(15);
    expect(s.durationMs).toBe(230);
  });

  it('saveRun() preserves multiple steps in order', () => {
    const steps = [
      makeStep({ id: 'step-a', operation: 'read' }),
      makeStep({ id: 'step-b', operation: 'classify' }),
      makeStep({ id: 'step-c', operation: 'send' }),
    ];
    const run = makeWorkflowRun('parent-task', { id: 'run-ordered', steps });
    store.saveRun(run);

    const retrieved = store.getRun('run-ordered');
    expect(retrieved!.steps).toHaveLength(3);
    expect(retrieved!.steps[0].operation).toBe('read');
    expect(retrieved!.steps[1].operation).toBe('classify');
    expect(retrieved!.steps[2].operation).toBe('send');
  });

  it('listRuns() returns all runs', () => {
    store.saveRun(makeWorkflowRun('parent-task', { id: 'r1' }));
    store.saveRun(makeWorkflowRun('parent-task', { id: 'r2' }));

    const runs = store.listRuns();
    expect(runs).toHaveLength(2);
  });

  it('listRuns() filters by taskId', () => {
    taskStore.save(makeTask({ id: 'other-task' }));
    store.saveRun(makeWorkflowRun('parent-task', { id: 'r1' }));
    store.saveRun(makeWorkflowRun('other-task', { id: 'r2' }));

    const filtered = store.listRuns({ taskId: 'parent-task' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].taskId).toBe('parent-task');
  });

  it('listRuns() filters by state', () => {
    store.saveRun(makeWorkflowRun('parent-task', { id: 'r1', state: 'queued' }));
    store.saveRun(makeWorkflowRun('parent-task', { id: 'r2', state: 'completed' }));
    store.saveRun(makeWorkflowRun('parent-task', { id: 'r3', state: 'queued' }));

    const queued = store.listRuns({ state: 'queued' });
    expect(queued).toHaveLength(2);
  });

  it('updateRun() updates run state', () => {
    store.saveRun(makeWorkflowRun('parent-task', { id: 'run-upd', state: 'queued' }));

    store.updateRun('run-upd', { state: 'running' });

    const updated = store.getRun('run-upd');
    expect(updated!.state).toBe('running');
  });

  it('updateRun() preserves existing steps when none provided in update', () => {
    const steps = [makeStep({ id: 'keep-me' })];
    store.saveRun(makeWorkflowRun('parent-task', { id: 'run-keep', steps }));

    store.updateRun('run-keep', { state: 'completed' });

    const updated = store.getRun('run-keep');
    expect(updated!.steps).toHaveLength(1);
    expect(updated!.steps[0].id).toBe('keep-me');
  });

  it('saveStep() adds a new step to an existing run', () => {
    store.saveRun(makeWorkflowRun('parent-task', { id: 'run-addstep', steps: [] }));

    const newStep = makeStep({ id: 'added-step', operation: 'notify' });
    store.saveStep('run-addstep', newStep);

    const run = store.getRun('run-addstep');
    expect(run!.steps).toHaveLength(1);
    expect(run!.steps[0].id).toBe('added-step');
    expect(run!.steps[0].operation).toBe('notify');
  });

  it('saveStep() updates an existing step in a run', () => {
    const step = makeStep({ id: 'mutable-step', status: 'pending' });
    store.saveRun(makeWorkflowRun('parent-task', { id: 'run-updstep', steps: [step] }));

    store.saveStep('run-updstep', { ...step, status: 'completed', durationMs: 100 });

    const run = store.getRun('run-updstep');
    expect(run!.steps[0].status).toBe('completed');
    expect(run!.steps[0].durationMs).toBe(100);
  });

  it('saveRun() preserves endedAt and error fields', () => {
    const run = makeWorkflowRun('parent-task', {
      id: 'run-fields',
      state: 'failed',
      endedAt: '2026-01-01T12:00:00.000Z',
      error: 'Connection timeout',
    });
    store.saveRun(run);

    const retrieved = store.getRun('run-fields');
    expect(retrieved!.endedAt).toBe('2026-01-01T12:00:00.000Z');
    expect(retrieved!.error).toBe('Connection timeout');
  });
});
