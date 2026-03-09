/**
 * API Routes — Integration Tests
 *
 * Starts the server on a random port, makes real HTTP requests,
 * and asserts response status codes and JSON bodies.
 */

import * as http from 'http';
import type { AddressInfo } from 'net';

let server: http.Server;
let baseUrl: string;

// We need to import the server after potentially setting env vars.
// The server.ts module has a side effect: it calls server.listen(PORT).
// Our strategy: import it, close the auto-started listener, then re-listen on port 0.

beforeAll(async () => {
  // Use an in-memory SQLite database for tests
  process.env.OPS_DB_PATH = ':memory:';
  // Prevent the server from binding to the default port
  process.env.OPS_PORT = '0';

  const mod = await import('../server');
  server = mod.server;

  // The server auto-started on port 0 (due to OPS_PORT=0).
  // We can read the assigned port directly.
  await new Promise<void>((resolve) => {
    // If the server is already listening, we can get the address.
    // But we need to wait for the 'listening' event if it hasn't fired yet.
    if (server.listening) {
      resolve();
    } else {
      server.on('listening', () => resolve());
    }
  });

  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  const url = `${baseUrl}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
}

// ── Health Check ─────────────────────────────────────────────────────────────

describe('Health Check', () => {
  test('GET /health returns 200 with status:ok', async () => {
    const { status, data } = await api('GET', '/health');
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('uptime');
  });

  test('GET /api/health returns 200 with status:ok', async () => {
    const { status, data } = await api('GET', '/api/health');
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
  });
});

// ── Task Routes ──────────────────────────────────────────────────────────────

describe('Task Routes', () => {
  let createdTaskId: string;

  test('POST /api/tasks creates a task and returns 201', async () => {
    const { status, data } = await api('POST', '/api/tasks', {
      source: 'email',
      title: 'Test task from integration test',
      body: 'This is the body of the test task',
      intent: 'reply',
      priority: 'high',
    });
    expect(status).toBe(201);
    expect(data).toHaveProperty('id');
    expect(data.source).toBe('email');
    expect(data.title).toBe('Test task from integration test');
    expect(data.intent).toBe('reply');
    expect(data.priority).toBe('high');
    expect(data.status).toBe('pending');
    createdTaskId = data.id;
  });

  test('POST /api/tasks with missing fields returns 400', async () => {
    const { status, data } = await api('POST', '/api/tasks', {
      // missing source and title
      body: 'No source or title',
    });
    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/missing required fields/i);
  });

  test('GET /api/tasks returns task list', async () => {
    const { status, data } = await api('GET', '/api/tasks');
    expect(status).toBe(200);
    expect(data).toHaveProperty('tasks');
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks.length).toBeGreaterThanOrEqual(1);
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('limit');
    expect(data).toHaveProperty('offset');
  });

  test('GET /api/tasks/:id returns a specific task', async () => {
    const { status, data } = await api('GET', `/api/tasks/${createdTaskId}`);
    expect(status).toBe(200);
    expect(data.id).toBe(createdTaskId);
    expect(data.title).toBe('Test task from integration test');
  });

  test('GET /api/tasks/:id with bad ID returns 404', async () => {
    const { status, data } = await api('GET', '/api/tasks/nonexistent-id-12345');
    expect(status).toBe(404);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/not found/i);
  });

  test('PATCH /api/tasks/:id updates task fields', async () => {
    const { status, data } = await api('PATCH', `/api/tasks/${createdTaskId}`, {
      title: 'Updated task title',
      priority: 'urgent',
      status: 'running',
    });
    expect(status).toBe(200);
    expect(data.title).toBe('Updated task title');
    expect(data.priority).toBe('urgent');
    expect(data.status).toBe('running');
  });

  test('DELETE /api/tasks/:id soft-deletes the task', async () => {
    // Create a fresh task to delete
    const createRes = await api('POST', '/api/tasks', {
      source: 'manual',
      title: 'Task to delete',
    });
    const taskId = createRes.data.id;

    const { status, data } = await api('DELETE', `/api/tasks/${taskId}`);
    expect(status).toBe(200);
    expect(data.deleted).toBe(true);
    expect(data.id).toBe(taskId);

    // Verify the task is now in 'failed' status (soft delete)
    const getRes = await api('GET', `/api/tasks/${taskId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.status).toBe('failed');
  });
});

// ── Approval Routes ──────────────────────────────────────────────────────────

describe('Approval Routes', () => {
  test('GET /api/approvals returns empty list initially', async () => {
    const { status, data } = await api('GET', '/api/approvals');
    expect(status).toBe(200);
    expect(data).toHaveProperty('approvals');
    expect(Array.isArray(data.approvals)).toBe(true);
    expect(data).toHaveProperty('pending');
    expect(data).toHaveProperty('total');
  });

  test('POST /api/approvals/:id/decide with approved works', async () => {
    // First, create an approval via the internal API
    const { requestApproval } = await import('../routes/approvals');
    const approval = requestApproval(
      'test-action-1',
      'test-task-1',
      'medium',
      'Test approval reason',
      'Preview of test action',
    );

    const { status, data } = await api('POST', `/api/approvals/${approval.id}/decide`, {
      decision: 'approved',
      decidedBy: 'test-user',
    });
    expect(status).toBe(200);
    expect(data.decision).toBe('approved');
    expect(data.decidedBy).toBe('test-user');
    expect(data).toHaveProperty('decidedAt');
  });

  test('POST /api/approvals/:id/decide with invalid decision returns 400', async () => {
    // Create another approval
    const { requestApproval } = await import('../routes/approvals');
    const approval = requestApproval(
      'test-action-2',
      'test-task-2',
      'low',
      'Another test',
      'Preview',
    );

    const { status, data } = await api('POST', `/api/approvals/${approval.id}/decide`, {
      decision: 'maybe',
    });
    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/invalid decision/i);
  });

  test('POST /api/approvals/:id/decide on nonexistent approval returns 404', async () => {
    const { status, data } = await api('POST', '/api/approvals/nonexistent-approval/decide', {
      decision: 'approved',
    });
    expect(status).toBe(404);
    expect(data.error).toMatch(/not found/i);
  });

  test('POST /api/approvals/:id/decide on already decided returns 400', async () => {
    // Create and decide an approval
    const { requestApproval } = await import('../routes/approvals');
    const approval = requestApproval(
      'test-action-3',
      'test-task-3',
      'high',
      'Already decided test',
      'Preview',
    );

    // Decide it first
    await api('POST', `/api/approvals/${approval.id}/decide`, {
      decision: 'denied',
    });

    // Try to decide again
    const { status, data } = await api('POST', `/api/approvals/${approval.id}/decide`, {
      decision: 'approved',
    });
    expect(status).toBe(400);
    expect(data.error).toMatch(/already decided/i);
  });
});

// ── Pipeline Routes ──────────────────────────────────────────────────────────

describe('Pipeline Routes', () => {
  test('POST /api/pipeline/simulate returns simulation result', async () => {
    const { status, data } = await api('POST', '/api/pipeline/simulate', {
      source: 'manual',
      title: 'Schedule a meeting with team',
    });
    expect(status).toBe(200);
    expect(data.simulation).toBe(true);
    expect(data.source).toBe('manual');
    expect(data).toHaveProperty('intent');
    expect(data).toHaveProperty('steps');
    expect(data).toHaveProperty('summary');
    expect(data.summary).toHaveProperty('totalSteps');
  });

  test('POST /api/pipeline/simulate with missing source returns 400', async () => {
    const { status, data } = await api('POST', '/api/pipeline/simulate', {
      title: 'No source provided',
    });
    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/missing.*source/i);
  });

  test('POST /api/pipeline/simulate with email source returns reply intent', async () => {
    const { status, data } = await api('POST', '/api/pipeline/simulate', {
      source: 'email',
      title: 'Please reply to this email about the project update',
    });
    expect(status).toBe(200);
    expect(data.simulation).toBe(true);
    expect(data.intent).toBe('reply');
    expect(data.workflowType).toBe('reply-workflow');
    expect(data.steps.length).toBeGreaterThanOrEqual(1);
    // Reply workflow should include gmail connector steps
    const connectors = data.steps.map((s: any) => s.connector);
    expect(connectors).toContain('gmail');
  });

  test('POST /api/pipeline/simulate detects schedule intent', async () => {
    const { status, data } = await api('POST', '/api/pipeline/simulate', {
      source: 'calendar',
      title: 'Schedule a meeting for Thursday',
    });
    expect(status).toBe(200);
    expect(data.intent).toBe('schedule');
    expect(data.workflowType).toBe('schedule-workflow');
  });
});

// ── Gmail Routes ─────────────────────────────────────────────────────────────

describe('Gmail Routes', () => {
  test('GET /api/gmail/inbox without OAuth returns 401', async () => {
    const { status, data } = await api('GET', '/api/gmail/inbox');
    expect(status).toBe(401);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/not connected/i);
  });

  test('POST /api/gmail/process without messageId returns 400', async () => {
    const { status, data } = await api('POST', '/api/gmail/process', {});
    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/missing.*messageId/i);
  });

  test('GET /api/gmail/message/:id without OAuth returns 401', async () => {
    const { status, data } = await api('GET', '/api/gmail/message/some-id');
    expect(status).toBe(401);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/not connected/i);
  });
});

// ── CORS ─────────────────────────────────────────────────────────────────────

describe('CORS', () => {
  test('OPTIONS request returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/GET/);
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
    expect(res.headers.get('access-control-allow-methods')).toMatch(/PATCH/);
    expect(res.headers.get('access-control-allow-methods')).toMatch(/DELETE/);
    expect(res.headers.get('access-control-allow-headers')).toMatch(/Content-Type/);
  });

  test('JSON responses include Access-Control-Allow-Origin header', async () => {
    const { headers } = await api('GET', '/api/health');
    expect(headers['access-control-allow-origin']).toBe('*');
  });
});

// ── 404 ──────────────────────────────────────────────────────────────────────

describe('404 Not Found', () => {
  test('GET /api/nonexistent returns 404', async () => {
    const { status, data } = await api('GET', '/api/nonexistent');
    expect(status).toBe(404);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/not found/i);
  });

  test('POST /api/nonexistent returns 404', async () => {
    const { status, data } = await api('POST', '/api/nonexistent', { foo: 'bar' });
    expect(status).toBe(404);
    expect(data).toHaveProperty('error');
  });
});

// ── Workflow Routes ──────────────────────────────────────────────────────────

describe('Workflow Routes', () => {
  let workflowRunId: string;

  test('POST /api/workflows creates a workflow run and returns 201', async () => {
    // Create a task first so we have a valid taskId
    const taskRes = await api('POST', '/api/tasks', {
      source: 'email',
      title: 'Task for workflow test',
    });
    const taskId = taskRes.data.id;

    const { status, data } = await api('POST', '/api/workflows', {
      taskId,
      workflowType: 'reply-workflow',
      steps: [
        { connector: 'gmail', operation: 'read', input: {} },
        { connector: 'gmail', operation: 'reply', input: {} },
      ],
    });
    expect(status).toBe(201);
    expect(data).toHaveProperty('id');
    expect(data.taskId).toBe(taskId);
    expect(data.workflowType).toBe('reply-workflow');
    workflowRunId = data.id;
  });

  test('POST /api/workflows with missing fields returns 400', async () => {
    const { status, data } = await api('POST', '/api/workflows', {
      // missing taskId and workflowType
    });
    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/missing required fields/i);
  });

  test('GET /api/workflows returns workflow run list', async () => {
    const { status, data } = await api('GET', '/api/workflows');
    expect(status).toBe(200);
    expect(data).toHaveProperty('runs');
    expect(Array.isArray(data.runs)).toBe(true);
    expect(data.runs.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /api/workflows/:id returns a specific workflow run', async () => {
    const { status, data } = await api('GET', `/api/workflows/${workflowRunId}`);
    expect(status).toBe(200);
    expect(data.id).toBe(workflowRunId);
    expect(data.workflowType).toBe('reply-workflow');
  });

  test('GET /api/workflows/:id with bad ID returns 404', async () => {
    const { status, data } = await api('GET', '/api/workflows/nonexistent-run-id');
    expect(status).toBe(404);
    expect(data.error).toMatch(/not found/i);
  });
});

// ── Webhook Routes ───────────────────────────────────────────────────────────

describe('Webhook Routes', () => {
  test('POST /api/webhooks/generic creates a task from webhook', async () => {
    const { status, data } = await api('POST', '/api/webhooks/generic', {
      title: 'Webhook test event',
      source: 'manual',
      body: 'Event body content',
    });
    expect(status).toBe(200);
    expect(data.received).toBe(true);
    expect(data).toHaveProperty('taskId');
  });

  test('POST /api/webhooks/gmail creates a task from Gmail notification', async () => {
    const { status, data } = await api('POST', '/api/webhooks/gmail', {
      subject: 'New important email',
      snippet: 'Hey, please review...',
      messageId: 'msg-123',
    });
    expect(status).toBe(200);
    expect(data.received).toBe(true);
    expect(data).toHaveProperty('taskId');
  });
});
