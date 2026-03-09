import { BaseConnector, ConnectorConfig, ConnectorResult } from './base';

const SHOPIFY_API_VERSION = '2024-01';

/**
 * Shopify connector for managing orders, products, and customers
 * via the Shopify Admin REST API.
 *
 * Required credentials (via config or environment variables):
 *   - `storeUrl`    : The myshopify.com store URL (e.g. "my-store.myshopify.com")
 *   - `accessToken` : A valid Shopify Admin API access token
 *
 * When both credentials are present the connector auto-enables itself.
 * When credentials are missing the connector stays disabled and returns
 * graceful error results instead of throwing.
 */
export class ShopifyConnector extends BaseConnector {
  private storeUrl: string;
  private accessToken: string;

  constructor(config?: Partial<ConnectorConfig>) {
    const storeUrl =
      config?.credentials?.storeUrl ||
      (typeof process !== 'undefined' ? process.env?.SHOPIFY_STORE_URL : undefined) ||
      '';
    const accessToken =
      config?.credentials?.accessToken ||
      (typeof process !== 'undefined' ? process.env?.SHOPIFY_ACCESS_TOKEN : undefined) ||
      '';

    const hasCredentials = !!storeUrl && !!accessToken;

    super({
      enabled: hasCredentials,
      ...config,
      // If the caller explicitly passed `enabled` via config, honour it only
      // when credentials are actually available; otherwise force disabled.
      ...(hasCredentials ? {} : { enabled: false }),
      name: config?.name ?? 'shopify',
    });

    this.storeUrl = storeUrl.replace(/\/+$/, ''); // strip trailing slashes
    this.accessToken = accessToken;
  }

  /**
   * Supported Shopify operations:
   * - `list_orders`     : List orders with optional filters (status, date range)
   * - `get_order`       : Retrieve details for a specific order by ID
   * - `fulfill_order`   : Mark an order as fulfilled with tracking information
   * - `refund`          : Issue a full or partial refund for an order
   * - `list_products`   : List products in the store catalog
   * - `update_product`  : Update product details (title, description, price, inventory)
   * - `list_customers`  : List customers with optional search filters
   */
  get supportedOperations(): string[] {
    return [
      'list_orders',
      'get_order',
      'fulfill_order',
      'refund',
      'list_products',
      'update_product',
      'list_customers',
    ];
  }

  /**
   * Execute a Shopify operation.
   *
   * @param operation - One of the supported operation identifiers
   * @param input - Operation-specific parameters:
   *   - `list_orders`    : `{ status?: 'open'|'closed'|'any', limit?: number, since_id?: string, created_at_min?: string }`
   *   - `get_order`      : `{ orderId: string }`
   *   - `fulfill_order`  : `{ orderId: string, trackingNumber?: string, trackingCompany?: string }`
   *   - `refund`         : `{ orderId: string, amount?: number, reason?: string, lineItems?: object[] }`
   *   - `list_products`  : `{ limit?: number, collection_id?: string, status?: string }`
   *   - `update_product` : `{ productId: string, title?: string, description?: string, price?: number, inventory?: number }`
   *   - `list_customers` : `{ query?: string, limit?: number }`
   * @returns A `ConnectorResult` indicating the outcome
   */
  async execute(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    if (!this.supportsOperation(operation)) {
      return {
        success: false,
        error: `Unsupported operation: ${operation}`,
      };
    }

    if (!this.storeUrl || !this.accessToken) {
      return {
        success: false,
        error:
          'Shopify not configured — set storeUrl and accessToken in connector credentials or SHOPIFY_STORE_URL / SHOPIFY_ACCESS_TOKEN environment variables.',
      };
    }

    try {
      switch (operation) {
        case 'list_orders':
          return await this.listOrders(input);
        case 'get_order':
          return await this.getOrder(input);
        case 'fulfill_order':
          return {
            success: false,
            error:
              'fulfill_order: Requires implementation and approval gate \u2014 use API directly for safety',
          };
        case 'refund':
          return {
            success: false,
            error:
              'refund: Requires implementation and approval gate \u2014 use API directly for safety',
          };
        case 'list_products':
          return await this.listProducts(input);
        case 'update_product':
          return {
            success: false,
            error:
              'update_product: Requires implementation and approval gate \u2014 use API directly for safety',
          };
        case 'list_customers':
          return await this.listCustomers(input);
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Verify connectivity to the Shopify Admin API by fetching shop info.
   *
   * @returns `true` if the Shopify API is reachable and credentials are valid
   */
  async healthCheck(): Promise<boolean> {
    if (!this.storeUrl || !this.accessToken) return false;
    try {
      const res = await this.shopifyFetch('/shop.json');
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Operations ────────────────────────────────────────────────────────

  /**
   * List orders, optionally filtered by status, date, or pagination cursor.
   *
   * Params: status ('open'|'closed'|'any'), limit, since_id, created_at_min
   */
  private async listOrders(
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    const status = (input.status as string) || 'open';
    const limit = (input.limit as number) || 50;
    const sinceId = input.since_id as string | undefined;
    const createdAtMin = input.created_at_min as string | undefined;

    const params = new URLSearchParams({
      status,
      limit: String(limit),
    });
    if (sinceId) params.set('since_id', sinceId);
    if (createdAtMin) params.set('created_at_min', createdAtMin);

    const res = await this.shopifyFetch(`/orders.json?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    const orders: Record<string, unknown>[] = (data.orders || []).map(
      (o: any) => ({
        id: o.id,
        order_number: o.order_number,
        email: o.email,
        total_price: o.total_price,
        currency: o.currency,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        created_at: o.created_at,
        line_items_count: Array.isArray(o.line_items)
          ? o.line_items.length
          : 0,
        customer_name: o.customer
          ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim()
          : null,
      }),
    );

    return {
      success: true,
      data: {
        orders,
        count: orders.length,
      },
    };
  }

  /**
   * Retrieve full details of a specific order including line items,
   * shipping address, and customer information.
   */
  private async getOrder(
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    const orderId = input.orderId as string;
    if (!orderId) {
      return { success: false, error: 'orderId is required' };
    }

    const res = await this.shopifyFetch(`/orders/${orderId}.json`);
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    const o = data.order;
    if (!o) {
      return { success: false, error: `Order ${orderId} not found` };
    }

    const lineItems = Array.isArray(o.line_items)
      ? o.line_items.map((li: any) => ({
          title: li.title,
          quantity: li.quantity,
          price: li.price,
        }))
      : [];

    const shippingAddress = o.shipping_address
      ? {
          address1: o.shipping_address.address1,
          address2: o.shipping_address.address2,
          city: o.shipping_address.city,
          province: o.shipping_address.province,
          country: o.shipping_address.country,
          zip: o.shipping_address.zip,
        }
      : null;

    const customer = o.customer
      ? {
          first_name: o.customer.first_name,
          last_name: o.customer.last_name,
          email: o.customer.email,
        }
      : null;

    return {
      success: true,
      data: {
        id: o.id,
        order_number: o.order_number,
        email: o.email,
        total_price: o.total_price,
        subtotal_price: o.subtotal_price,
        currency: o.currency,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        created_at: o.created_at,
        line_items: lineItems,
        shipping_address: shippingAddress,
        customer,
      },
    };
  }

  /**
   * List products in the store, optionally filtered by collection or status.
   *
   * Params: limit, collection_id, status
   */
  private async listProducts(
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    const limit = (input.limit as number) || 50;
    const collectionId = input.collection_id as string | undefined;
    const status = input.status as string | undefined;

    const params = new URLSearchParams({
      limit: String(limit),
    });
    if (collectionId) params.set('collection_id', collectionId);
    if (status) params.set('status', status);

    const res = await this.shopifyFetch(`/products.json?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    const products: Record<string, unknown>[] = (data.products || []).map(
      (p: any) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        variants_count: Array.isArray(p.variants) ? p.variants.length : 0,
        images_count: Array.isArray(p.images) ? p.images.length : 0,
        created_at: p.created_at,
      }),
    );

    return {
      success: true,
      data: {
        products,
        count: products.length,
      },
    };
  }

  /**
   * Search customers using Shopify's customer search endpoint.
   *
   * Params: query, limit
   */
  private async listCustomers(
    input: Record<string, unknown>,
  ): Promise<ConnectorResult> {
    const query = (input.query as string) || '';
    const limit = (input.limit as number) || 50;

    const params = new URLSearchParams({
      query,
      limit: String(limit),
    });

    const res = await this.shopifyFetch(`/customers/search.json?${params}`);
    if (!res.ok) return this.apiError(res);

    const data = (await res.json()) as any;
    const customers: Record<string, unknown>[] = (
      data.customers || []
    ).map((c: any) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      orders_count: c.orders_count,
      total_spent: c.total_spent,
    }));

    return {
      success: true,
      data: {
        customers,
        count: customers.length,
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Make an authenticated request to the Shopify Admin REST API.
   */
  private async shopifyFetch(
    path: string,
    options?: RequestInit,
  ): Promise<Response> {
    const url = `https://${this.storeUrl}/admin/api/${SHOPIFY_API_VERSION}${path}`;
    return fetch(url, {
      ...options,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
        ...((options?.headers as Record<string, string>) || {}),
      },
    });
  }

  /**
   * Build a standardised error result from a failed Shopify API response.
   */
  private async apiError(res: Response): Promise<ConnectorResult> {
    let msg = `Shopify API error: ${res.status}`;
    try {
      const data = (await res.json()) as any;
      if (data.errors) {
        msg =
          typeof data.errors === 'string'
            ? data.errors
            : JSON.stringify(data.errors);
      }
    } catch {
      /* ignore parse failures */
    }
    return { success: false, error: msg };
  }
}
