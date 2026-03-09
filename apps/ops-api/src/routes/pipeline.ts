/**
 * Pipeline Routes — Trigger and stream the full end-to-end pipeline.
 *
 * POST   /api/pipeline/run       Trigger pipeline with SSE event stream
 * POST   /api/pipeline/simulate  Dry-run pipeline (no execution)
 *
 * The run endpoint wires together all real packages:
 * - IntentClassifier from ops-core
 * - RuleEngine from ops-policy
 * - CordSafetyGate via cord-gate middleware
 * - ConnectorRegistry from ops-connectors
 * - Approval flow via approvals routes
 */

import type { TaskSource, Approval } from '@ai-ops/shared-types';
import { DEFAULT_POLICY } from '@ai-ops/shared-types';
import { runPipeline as runPipelineFn, defaultBuildWorkflow } from '@ai-ops/ops-worker';
import { IntentClassifier } from '@ai-ops/ops-core';
import { RuleEngine } from '@ai-ops/ops-policy';
import { ConnectorRegistry, GmailConnector, CalendarConnector, XTwitterConnector, ShopifyConnector } from '@ai-ops/ops-connectors';
import { evaluateAction } from '../middleware/cord-gate';
import { requestApproval, waitForDecision } from './approvals';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';

// ── Singletons ────────────────────────────────────────────────────────────────

const classifier = new IntentClassifier();
const ruleEngine = new RuleEngine(DEFAULT_POLICY);
const registry = new ConnectorRegistry();

// Register available connectors (they self-disable if credentials are missing)
registry.register(new GmailConnector());
registry.register(new CalendarConnector());
registry.register(new XTwitterConnector());
registry.register(new ShopifyConnector());

/**
 * Trigger the full pipeline and stream events via SSE.
 *
 * Body: { source: 'email'|'calendar'|..., event: { subject, body, ... } }
 *
 * Returns an SSE stream of pipeline events.
 */
async function handleRunPipeline(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const source = body.source as TaskSource;
  const eventData = (body.event as Record<string, unknown>) || body;

  if (!source) {
    sendError(res, 400, 'Missing required field: source');
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  try {
    const pipeline = runPipelineFn(source, eventData, {
      classifyIntent: (text: string) => classifier.classify(text),

      evaluatePolicy: (connector: string, operation: string) => {
        const result = ruleEngine.evaluate(connector, operation, { source });
        return {
          autonomy: result.autonomy,
          risk: result.risk,
          reason: result.reason,
        };
      },

      evaluateSafety: (connector: string, operation: string, input: Record<string, unknown>) => {
        const gate = evaluateAction(connector, operation, input);
        return {
          decision: gate.decision,
          score: gate.score,
          reasons: gate.reasons,
        };
      },

      executeConnector: async (connector: string, operation: string, input: Record<string, unknown>) => {
        const conn = registry.get(connector);
        if (!conn) {
          return {
            success: false,
            error: `Connector '${connector}' not registered`,
          };
        }
        try {
          const result = await conn.execute(operation, input);
          return result;
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      requestApproval: async (approval: Approval) => {
        // Broadcast the approval request to SSE clients
        res.write(`data: ${JSON.stringify({
          type: 'approval_request',
          approvalId: approval.id,
          risk: approval.risk,
          reason: approval.reason,
          preview: approval.preview,
        })}\n\n`);

        // Store the approval and wait for a decision from the dashboard
        requestApproval(
          approval.actionId,
          approval.taskId,
          approval.risk,
          approval.reason,
          approval.preview,
        );
        const decided = await waitForDecision(approval.id);
        return (decided?.decision ?? 'approved') as 'approved' | 'denied' | 'modified';
      },

      buildWorkflow: defaultBuildWorkflow,
    });

    for await (const event of pipeline) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  res.end();
}

/**
 * Simulate the pipeline without executing (dry-run).
 */
async function simulatePipeline(ctx: any): Promise<void> {
  const { res, body } = ctx;

  const source = body.source as TaskSource;
  const title = (body.title as string) || (body.subject as string) || 'Untitled task';
  const bodyText = (body.body as string) || '';

  if (!source) {
    sendError(res, 400, 'Missing required field: source');
    return;
  }

  // Simulate intent classification
  const text = `${title} ${bodyText}`.toLowerCase();
  let intent = 'reply';
  if (text.includes('schedule') || text.includes('meeting')) intent = 'schedule';
  else if (text.includes('post') || text.includes('tweet')) intent = 'post';
  else if (text.includes('order') || text.includes('ship')) intent = 'fulfill';

  // Simulate workflow steps
  const workflowSteps: Array<{
    connector: string;
    operation: string;
    policyDecision: string;
    safetyDecision: string;
    requiresApproval: boolean;
  }> = [];

  const readOps = ['read', 'list', 'search', 'check_availability', 'get_order'];
  const intentStepMap: Record<string, Array<{ connector: string; operation: string }>> = {
    reply: [{ connector: 'gmail', operation: 'read' }, { connector: 'gmail', operation: 'reply' }],
    schedule: [{ connector: 'calendar', operation: 'check_availability' }, { connector: 'calendar', operation: 'create_event' }],
    post: [{ connector: 'x-twitter', operation: 'post' }],
    fulfill: [{ connector: 'shopify', operation: 'get_order' }, { connector: 'shopify', operation: 'fulfill_order' }],
  };

  const steps = intentStepMap[intent] || [{ connector: 'gmail', operation: 'read' }];
  for (const s of steps) {
    const isRead = readOps.includes(s.operation);
    workflowSteps.push({
      connector: s.connector,
      operation: s.operation,
      policyDecision: isRead ? 'auto' : 'approve',
      safetyDecision: 'ALLOW',
      requiresApproval: !isRead,
    });
  }

  sendJson(res, 200, {
    simulation: true,
    source,
    intent,
    workflowType: `${intent}-workflow`,
    steps: workflowSteps,
    summary: {
      totalSteps: workflowSteps.length,
      autoSteps: workflowSteps.filter((s) => !s.requiresApproval).length,
      approvalSteps: workflowSteps.filter((s) => s.requiresApproval).length,
      blockedSteps: 0,
    },
  });
}

// ── Export routes ────────────────────────────────────────────────────────────

export const pipelineRoutes: Route[] = [
  pathToRoute('POST', '/api/pipeline/run', handleRunPipeline),
  pathToRoute('POST', '/api/pipeline/simulate', simulatePipeline),
];
