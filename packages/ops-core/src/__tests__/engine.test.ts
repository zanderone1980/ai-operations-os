import { WorkflowEngine } from '../engine';
import type { Connector, ConnectorRegistry, SafetyGate, SafetyGateResult, WorkflowEvent } from '../engine';
import { createWorkflowRun, createStep } from '@ai-operations/shared-types';
import type { WorkflowRun } from '@ai-operations/shared-types';

// Helper to collect all events from an async generator
async function collectEvents(gen: AsyncGenerator<WorkflowEvent>): Promise<WorkflowEvent[]> {
  const events: WorkflowEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// Mock connector that records calls and returns configurable output
function mockConnector(name: string, output: Record<string, unknown> = { ok: true }): Connector {
  return {
    name,
    execute: jest.fn().mockResolvedValue(output),
  };
}

// Mock connector that throws
function failingConnector(name: string, errorMsg: string): Connector {
  return {
    name,
    execute: jest.fn().mockRejectedValue(new Error(errorMsg)),
  };
}

// Simple registry from a list of connectors
function createRegistry(...connectors: Connector[]): ConnectorRegistry {
  const map = new Map(connectors.map((c) => [c.name, c]));
  return { get: (name: string) => map.get(name) };
}

// Default safety gate that allows everything
const allowAllGate: SafetyGate = async () => ({
  decision: 'ALLOW',
  score: 0,
  reason: 'Test: allow all',
});

// Safety gate that blocks everything
const blockAllGate: SafetyGate = async () => ({
  decision: 'BLOCK',
  score: 90,
  reason: 'Test: blocked by safety gate',
});

describe('WorkflowEngine', () => {
  describe('successful execution', () => {
    it('executes a single-step workflow and emits step_start, step_complete, run_complete', async () => {
      const connector = mockConnector('gmail', { messageId: 'msg-1' });
      const registry = createRegistry(connector);
      const engine = new WorkflowEngine(registry, allowAllGate);

      const run = createWorkflowRun('task-1', 'email-reply', [
        createStep('gmail', 'send', { body: 'hello' }),
      ]);

      const events = await collectEvents(engine.execute(run));

      const types = events.map((e) => e.type);
      expect(types).toEqual(['step_start', 'step_complete', 'run_complete']);

      expect(run.state).toBe('completed');
      expect(run.endedAt).toBeDefined();
      expect(run.steps[0].status).toBe('completed');
    });

    it('executes a multi-step workflow in order', async () => {
      const gmail = mockConnector('gmail', { messageId: 'msg-1' });
      const calendar = mockConnector('calendar', { eventId: 'evt-1' });
      const registry = createRegistry(gmail, calendar);
      const engine = new WorkflowEngine(registry, allowAllGate);

      const run = createWorkflowRun('task-1', 'email-and-calendar', [
        createStep('gmail', 'read', {}),
        createStep('calendar', 'create_event', { title: 'Meeting' }),
      ]);

      const events = await collectEvents(engine.execute(run));

      const types = events.map((e) => e.type);
      expect(types).toEqual([
        'step_start', 'step_complete',
        'step_start', 'step_complete',
        'run_complete',
      ]);

      expect(run.state).toBe('completed');
      expect(run.steps[0].status).toBe('completed');
      expect(run.steps[1].status).toBe('completed');
    });

    it('records output and duration on completed steps', async () => {
      const connector = mockConnector('gmail', { sent: true });
      const registry = createRegistry(connector);
      const engine = new WorkflowEngine(registry, allowAllGate);

      const run = createWorkflowRun('task-1', 'wf', [
        createStep('gmail', 'send', {}),
      ]);

      await collectEvents(engine.execute(run));

      expect(run.steps[0].output).toEqual({ sent: true });
      expect(run.steps[0].durationMs).toBeDefined();
      expect(typeof run.steps[0].durationMs).toBe('number');
    });
  });

  describe('safety gate blocking', () => {
    it('blocks a step and stops execution when safety gate returns BLOCK', async () => {
      const connector = mockConnector('gmail');
      const registry = createRegistry(connector);
      const engine = new WorkflowEngine(registry, blockAllGate);

      const run = createWorkflowRun('task-1', 'wf', [
        createStep('gmail', 'send', {}),
      ]);

      const events = await collectEvents(engine.execute(run));

      const types = events.map((e) => e.type);
      expect(types).toEqual(['step_blocked']);

      expect(run.steps[0].status).toBe('blocked');
      expect(run.steps[0].cordDecision).toBe('BLOCK');
      expect(connector.execute).not.toHaveBeenCalled();
    });

    it('blocks a step when safety gate returns CHALLENGE', async () => {
      const challengeGate: SafetyGate = async () => ({
        decision: 'CHALLENGE',
        score: 70,
        reason: 'Needs human review',
      });

      const connector = mockConnector('gmail');
      const registry = createRegistry(connector);
      const engine = new WorkflowEngine(registry, challengeGate);

      const run = createWorkflowRun('task-1', 'wf', [
        createStep('gmail', 'send', {}),
      ]);

      const events = await collectEvents(engine.execute(run));
      expect(events[0].type).toBe('step_blocked');
      expect(run.steps[0].status).toBe('blocked');
      expect(run.steps[0].cordDecision).toBe('CHALLENGE');
    });

    it('records cord score on blocked steps', async () => {
      const connector = mockConnector('gmail');
      const registry = createRegistry(connector);
      const engine = new WorkflowEngine(registry, blockAllGate);

      const run = createWorkflowRun('task-1', 'wf', [
        createStep('gmail', 'send', {}),
      ]);

      await collectEvents(engine.execute(run));

      expect(run.steps[0].cordScore).toBe(90);
    });
  });

  describe('connector failures', () => {
    it('fails the run when a connector throws', async () => {
      const connector = failingConnector('gmail', 'SMTP connection refused');
      const registry = createRegistry(connector);
      const engine = new WorkflowEngine(registry, allowAllGate);

      const run = createWorkflowRun('task-1', 'wf', [
        createStep('gmail', 'send', {}),
      ]);

      const events = await collectEvents(engine.execute(run));
      const types = events.map((e) => e.type);
      expect(types).toEqual(['step_start', 'step_failed', 'run_failed']);

      expect(run.state).toBe('failed');
      expect(run.error).toBe('SMTP connection refused');
      expect(run.steps[0].status).toBe('failed');
      expect(run.steps[0].error).toBe('SMTP connection refused');
    });

    it('fails the run when a connector is not found in the registry', async () => {
      const registry = createRegistry(); // empty registry
      const engine = new WorkflowEngine(registry, allowAllGate);

      const run = createWorkflowRun('task-1', 'wf', [
        createStep('nonexistent', 'send', {}),
      ]);

      const events = await collectEvents(engine.execute(run));
      const types = events.map((e) => e.type);
      expect(types).toEqual(['step_failed', 'run_failed']);

      expect(run.state).toBe('failed');
      expect(run.error).toContain('nonexistent');
      expect(run.error).toContain('not found');
    });

    it('stops at the first failed step in a multi-step workflow', async () => {
      const gmail = failingConnector('gmail', 'Auth failed');
      const calendar = mockConnector('calendar');
      const registry = createRegistry(gmail, calendar);
      const engine = new WorkflowEngine(registry, allowAllGate);

      const run = createWorkflowRun('task-1', 'wf', [
        createStep('gmail', 'send', {}),
        createStep('calendar', 'create_event', {}),
      ]);

      const events = await collectEvents(engine.execute(run));
      // Only the first step should have been attempted
      expect(calendar.execute).not.toHaveBeenCalled();
      expect(run.steps[1].status).toBe('pending');
    });
  });

  describe('event metadata', () => {
    it('includes runId and timestamp in every event', async () => {
      const connector = mockConnector('gmail');
      const registry = createRegistry(connector);
      const engine = new WorkflowEngine(registry, allowAllGate);

      const run = createWorkflowRun('task-1', 'wf', [
        createStep('gmail', 'send', {}),
      ]);

      const events = await collectEvents(engine.execute(run));

      for (const event of events) {
        expect(event.runId).toBe(run.id);
        expect(event.timestamp).toBeDefined();
        expect(() => new Date(event.timestamp)).not.toThrow();
      }
    });
  });
});
