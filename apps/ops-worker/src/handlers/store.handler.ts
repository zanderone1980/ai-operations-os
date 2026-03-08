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

  // TODO: Use Shopify connector to create fulfillment
  return {
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

  // TODO: Use LLM to draft response, check order history
  return {
    taskId,
    ticketId,
    suggestedResponse: `[LLM-drafted response to ${customerName} about "${subject}"]`,
    status: 'queued_for_approval',
    requiresApproval: true,
  };
}
