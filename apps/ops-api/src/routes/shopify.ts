/**
 * Shopify Routes — End-to-end Shopify pipeline.
 *
 * GET   /api/shopify/orders           List orders (optional filters via query params)
 * GET   /api/shopify/orders/:id       Get a specific order by ID
 * GET   /api/shopify/products         List products in the store catalog
 * GET   /api/shopify/customers        List/search customers
 * POST  /api/shopify/process          Run an order event through the full pipeline:
 *                                       process order → classify intent → policy → CORD safety → approve → execute → receipt
 *
 * All endpoints require SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN env vars.
 */

import { ShopifyConnector } from '@ai-operations/ops-connectors';
import { IntentClassifier } from '@ai-operations/ops-core';
import { RuleEngine } from '@ai-operations/ops-policy';
import {
  DEFAULT_POLICY,
  createTask,
  createApproval,
  verifyReceiptChain,
} from '@ai-operations/shared-types';
import type { TaskSource, CordDecision } from '@ai-operations/shared-types';
import { ReceiptBuilder } from '@ai-operations/codebot-adapter';
import { evaluateAction } from '../middleware/cord-gate';
import { requestApproval } from './approvals';
import { pathToRoute, sendJson, sendError } from '../server';
import type { Route } from '../server';

// ── Singletons ────────────────────────────────────────────────────────────────

const classifier = new IntentClassifier();
const ruleEngine = new RuleEngine(DEFAULT_POLICY);
const HMAC_KEY = process.env.CORD_HMAC_KEY || 'ai-ops-dev-key';

/**
 * Create a Shopify connector with credentials from environment variables.
 * Returns null if credentials are not configured.
 */
function getShopifyConnector(): ShopifyConnector | null {
  const storeUrl = process.env.SHOPIFY_STORE_URL || '';
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN || '';

  if (!storeUrl || !accessToken) return null;

  return new ShopifyConnector({
    credentials: { storeUrl, accessToken },
  });
}

// ── Route Handlers ──────────────────────────────────────────────────────────

/**
 * GET /api/shopify/orders — List orders.
 * Query: ?status=open&limit=50&since_id=...&created_at_min=...
 */
async function listOrders(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const shopify = getShopifyConnector();
  if (!shopify) {
    sendError(res, 401, 'Shopify not connected. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN environment variables.');
    return;
  }

  const result = await shopify.execute('list_orders', {
    status: query.status || 'open',
    limit: parseInt(query.limit || '50', 10),
    since_id: query.since_id,
    created_at_min: query.created_at_min,
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to list orders');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * GET /api/shopify/orders/:id — Get a specific order.
 */
async function getOrder(ctx: any): Promise<void> {
  const { res, params } = ctx;

  const shopify = getShopifyConnector();
  if (!shopify) {
    sendError(res, 401, 'Shopify not connected. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN environment variables.');
    return;
  }

  const result = await shopify.execute('get_order', { orderId: params.id });
  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to get order');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * GET /api/shopify/products — List products.
 * Query: ?limit=50&collection_id=...&status=...
 */
async function listProducts(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const shopify = getShopifyConnector();
  if (!shopify) {
    sendError(res, 401, 'Shopify not connected. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN environment variables.');
    return;
  }

  const result = await shopify.execute('list_products', {
    limit: parseInt(query.limit || '50', 10),
    collection_id: query.collection_id,
    status: query.status,
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to list products');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * GET /api/shopify/customers — List/search customers.
 * Query: ?query=...&limit=50
 */
async function listCustomers(ctx: any): Promise<void> {
  const { res, query } = ctx;

  const shopify = getShopifyConnector();
  if (!shopify) {
    sendError(res, 401, 'Shopify not connected. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN environment variables.');
    return;
  }

  const result = await shopify.execute('list_customers', {
    query: query.query || '',
    limit: parseInt(query.limit || '50', 10),
  });

  if (!result.success) {
    sendError(res, 502, result.error || 'Failed to list customers');
    return;
  }

  sendJson(res, 200, result.data);
}

/**
 * POST /api/shopify/process — Full pipeline for a Shopify order event.
 *
 * Body: { orderId: string, autoApprove?: boolean }
 *
 * Pipeline: fetch order → classify intent → policy → CORD safety → approve → execute → receipt chain
 *
 * Returns the complete pipeline result with receipt chain:
 * {
 *   task, intent, policy, safety, approval,
 *   execution, receipts, receiptChainValid
 * }
 */
async function processOrder(ctx: any): Promise<void> {
  const { res, body } = ctx;
  const orderId = body.orderId as string;
  const autoApprove = body.autoApprove === true;

  if (!orderId) {
    sendError(res, 400, 'Missing required field: orderId');
    return;
  }

  const shopify = getShopifyConnector();
  if (!shopify) {
    sendError(res, 401, 'Shopify not connected. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN environment variables.');
    return;
  }

  const receiptBuilder = new ReceiptBuilder();
  const policyVersion = DEFAULT_POLICY.version;

  // ── Step 1: Fetch the order ───────────────────────────────────────
  const readResult = await shopify.execute('get_order', { orderId });
  if (!readResult.success) {
    sendError(res, 502, readResult.error || 'Failed to fetch order');
    return;
  }

  const order = readResult.data!;
  const orderNumber = (order.order_number as string) || '';
  const email = (order.email as string) || '';
  const totalPrice = (order.total_price as string) || '';
  const fulfillmentStatus = (order.fulfillment_status as string) || '';
  const financialStatus = (order.financial_status as string) || '';
  const customerName = order.customer
    ? `${(order.customer as any).first_name || ''} ${(order.customer as any).last_name || ''}`.trim()
    : '';

  // Receipt for read operation
  const readSafety = evaluateAction('shopify', 'get_order', { orderId });
  receiptBuilder.addStep({
    actionId: `get-order-${orderId}`,
    policyVersion,
    cordDecision: readSafety.decision as CordDecision,
    cordScore: readSafety.score,
    cordReasons: readSafety.reasons,
    input: { orderId },
    output: { orderNumber, email, totalPrice, fulfillmentStatus },
  });

  // ── Step 2: Classify intent ──────────────────────────────────────
  const intentText = `Order ${orderNumber} from ${customerName || email} total ${totalPrice} status ${fulfillmentStatus} ${financialStatus}`;
  const classification = classifier.classifyDetailed(intentText);

  const task = createTask({
    source: 'shopify' as TaskSource,
    title: `Order #${orderNumber || orderId}`,
    body: intentText,
    sourceId: String(orderId),
    intent: classification.intent,
    metadata: {
      orderId,
      orderNumber,
      email,
      totalPrice,
      fulfillmentStatus,
      financialStatus,
      customerName,
      classificationConfidence: classification.confidence,
      classificationKeywords: classification.matchedKeywords,
    },
  });

  // ── Step 3: Evaluate policy ──────────────────────────────────────
  // Determine the connector operation based on intent
  const operation = classification.intent === 'fulfill' ? 'fulfill_order'
    : classification.intent === 'refund' ? 'refund'
    : 'get_order';
  const policyResult = ruleEngine.evaluate('shopify', operation, { source: 'shopify' });

  // ── Step 4: Evaluate CORD safety ─────────────────────────────────
  const actionInput = {
    orderId,
    orderNumber,
    totalPrice,
    operation,
  };
  const actionSafety = evaluateAction('shopify', operation, actionInput);

  const needsApproval = actionSafety.decision === 'CHALLENGE'
    || policyResult.autonomy === 'approve';
  const isBlocked = actionSafety.decision === 'BLOCK'
    || policyResult.autonomy === 'deny';

  // ── Step 5: Approval gate ────────────────────────────────────────
  let approvalResult: { needed: boolean; decision?: string; approvalId?: string } = {
    needed: needsApproval,
  };

  if (isBlocked) {
    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: {
        decision: actionSafety.decision,
        score: actionSafety.score,
        reasons: actionSafety.reasons,
      },
      blocked: true,
      reason: policyResult.autonomy === 'deny'
        ? `Policy denied: ${policyResult.reason}`
        : `CORD blocked: ${actionSafety.reasons.join(', ')}`,
      receipts: receiptBuilder.finalize(HMAC_KEY),
    });
    return;
  }

  if (needsApproval && !autoApprove) {
    const approval = requestApproval(
      `${operation}-${orderId}`,
      task.id,
      policyResult.risk as 'low' | 'medium' | 'high' | 'critical',
      needsApproval && actionSafety.decision === 'CHALLENGE'
        ? `CORD challenge (score: ${actionSafety.score})`
        : `Policy requires approval: ${policyResult.reason}`,
      `${operation} for Order #${orderNumber || orderId} (${totalPrice})`,
    );

    approvalResult = {
      needed: true,
      decision: 'pending',
      approvalId: approval.id,
    };

    sendJson(res, 200, {
      task,
      intent: classification,
      policy: policyResult,
      safety: {
        decision: actionSafety.decision,
        score: actionSafety.score,
        reasons: actionSafety.reasons,
      },
      approval: approvalResult,
      message: 'Approval required. Decide at POST /api/approvals/:id/decide',
      receipts: receiptBuilder.finalize(HMAC_KEY),
    });
    return;
  }

  // ── Step 6: Execute action (auto-approved or explicitly approved) ──
  let execution: { success: boolean; data?: Record<string, unknown>; error?: string; simulated?: boolean };

  if (classification.intent === 'fulfill') {
    const fulfillResult = await shopify.execute('fulfill_order', { orderId });
    execution = {
      success: fulfillResult.success,
      data: fulfillResult.data,
      error: fulfillResult.error,
    };

    receiptBuilder.addStep({
      actionId: `fulfill-${orderId}`,
      policyVersion,
      cordDecision: actionSafety.decision as CordDecision,
      cordScore: actionSafety.score,
      cordReasons: actionSafety.reasons,
      input: { orderId },
      output: fulfillResult.data || {},
    });
  } else if (classification.intent === 'refund') {
    const refundResult = await shopify.execute('refund', { orderId });
    execution = {
      success: refundResult.success,
      data: refundResult.data,
      error: refundResult.error,
    };

    receiptBuilder.addStep({
      actionId: `refund-${orderId}`,
      policyVersion,
      cordDecision: actionSafety.decision as CordDecision,
      cordScore: actionSafety.score,
      cordReasons: actionSafety.reasons,
      input: { orderId },
      output: refundResult.data || {},
    });
  } else {
    execution = {
      success: true,
      data: { action: 'classified', intent: classification.intent },
      simulated: true,
    };
  }

  // ── Step 7: Build receipt chain ──────────────────────────────────
  const receipts = receiptBuilder.finalize(HMAC_KEY);
  const chainValid = verifyReceiptChain(receipts, HMAC_KEY);

  sendJson(res, 200, {
    task,
    intent: classification,
    policy: policyResult,
    safety: {
      decision: actionSafety.decision,
      score: actionSafety.score,
      reasons: actionSafety.reasons,
    },
    approval: approvalResult,
    execution,
    receipts,
    receiptChainValid: chainValid.valid,
  });
}

// ── Export routes ────────────────────────────────────────────────────────────

export const shopifyRoutes: Route[] = [
  pathToRoute('GET', '/api/shopify/orders', listOrders),
  pathToRoute('GET', '/api/shopify/orders/:id', getOrder),
  pathToRoute('GET', '/api/shopify/products', listProducts),
  pathToRoute('GET', '/api/shopify/customers', listCustomers),
  pathToRoute('POST', '/api/shopify/process', processOrder),
];
