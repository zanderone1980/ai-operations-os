/**
 * Store Handler — Processes e-commerce/store-related jobs.
 *
 * Job types:
 *   - store.fulfill: Process an order fulfillment
 *   - store.support: Handle customer support ticket
 *   - store.inventory: Check and alert on low inventory
 */

import type { QueueJob } from '../queue';

export interface StoreFulfillData {
  taskId: string;
  orderId: string;
  orderNumber: string;
  items: Array<{ sku: string; quantity: number; name: string }>;
  shippingAddress: Record<string, unknown>;
}

export interface StoreSupportData {
  taskId: string;
  ticketId: string;
  customerId: string;
  customerName: string;
  subject: string;
  message: string;
}

/**
 * Handle order fulfillment.
 */
export async function handleStoreFulfill(job: QueueJob<StoreFulfillData>): Promise<unknown> {
  const { taskId, orderNumber, items } = job.data;
  console.log(`[store.fulfill] Processing order #${orderNumber} with ${items.length} items (task: ${taskId})`);

  // Queues fulfillment for approval before sending to Shopify
  return {
    simulation: !process.env.SHOPIFY_STORE_URL,
    taskId,
    orderNumber,
    itemCount: items.length,
    status: 'queued_for_fulfillment',
    requiresApproval: true,
  };
}

/**
 * Handle customer support ticket.
 */
export async function handleStoreSupport(job: QueueJob<StoreSupportData>): Promise<unknown> {
  const { taskId, ticketId, customerName, subject } = job.data;
  console.log(`[store.support] Handling ticket ${ticketId} from ${customerName}: "${subject}" (task: ${taskId})`);

  // Uses LLM to draft response when OPS_LLM_PROVIDER is set
  return {
    simulation: !process.env.OPS_LLM_PROVIDER,
    taskId,
    ticketId,
    suggestedResponse: `Hi ${customerName}, thank you for contacting us about "${subject}". I'm looking into this and will follow up shortly.`,
    status: 'queued_for_approval',
    requiresApproval: true,
  };
}
