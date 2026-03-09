import { ShopifyConnector } from '../shopify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnector(storeUrl = 'my-store.myshopify.com', accessToken = 'shpat_test123') {
  return new ShopifyConnector({
    credentials: { storeUrl, accessToken },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShopifyConnector', () => {
  let fetchSpy: jest.SpyInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}));
    // Ensure env vars don't leak between tests
    process.env = { ...originalEnv };
    delete process.env.SHOPIFY_STORE_URL;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = originalEnv;
  });

  // ── Constructor ───────────────────────────────────────────────────────

  it('should default name to "shopify"', () => {
    const c = new ShopifyConnector();
    expect(c.name).toBe('shopify');
  });

  it('should auto-enable when both credentials are provided', () => {
    const c = makeConnector();
    expect(c.isEnabled()).toBe(true);
  });

  it('should be disabled without credentials', () => {
    const c = new ShopifyConnector();
    expect(c.isEnabled()).toBe(false);
  });

  it('should be disabled with only storeUrl', () => {
    const c = new ShopifyConnector({ credentials: { storeUrl: 'x.myshopify.com' } });
    expect(c.isEnabled()).toBe(false);
  });

  it('should be disabled with only accessToken', () => {
    const c = new ShopifyConnector({ credentials: { accessToken: 'tok' } });
    expect(c.isEnabled()).toBe(false);
  });

  it('should fall back to environment variables', () => {
    process.env.SHOPIFY_STORE_URL = 'env-store.myshopify.com';
    process.env.SHOPIFY_ACCESS_TOKEN = 'env-token';
    const c = new ShopifyConnector();
    expect(c.isEnabled()).toBe(true);
  });

  it('should list correct supported operations', () => {
    const c = makeConnector();
    expect(c.supportedOperations).toEqual([
      'list_orders',
      'get_order',
      'fulfill_order',
      'refund',
      'list_products',
      'update_product',
      'list_customers',
    ]);
  });

  // ── No credentials ────────────────────────────────────────────────────

  it('should return error when executed without credentials', async () => {
    const c = new ShopifyConnector();
    const result = await c.execute('list_orders', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Shopify not configured');
  });

  it('should return error for unsupported operation', async () => {
    const c = makeConnector();
    const result = await c.execute('delete_order', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported operation');
  });

  // ── list_orders ───────────────────────────────────────────────────────

  it('should list orders with default parameters', async () => {
    const apiBody = {
      orders: [
        {
          id: 1001,
          order_number: '#1001',
          email: 'buyer@example.com',
          total_price: '49.99',
          currency: 'USD',
          financial_status: 'paid',
          fulfillment_status: null,
          created_at: '2024-01-15T10:00:00Z',
          line_items: [{ title: 'Widget' }],
          customer: { first_name: 'Jane', last_name: 'Doe' },
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(apiBody));

    const c = makeConnector();
    const result = await c.execute('list_orders', {});

    expect(result.success).toBe(true);
    const orders = result.data?.orders as any[];
    expect(orders).toHaveLength(1);
    expect(orders[0].customer_name).toBe('Jane Doe');
    expect(orders[0].line_items_count).toBe(1);
    expect(result.data?.count).toBe(1);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/orders.json');
    expect(url).toContain('status=open');
  });

  it('should pass custom parameters for list_orders', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ orders: [] }));

    const c = makeConnector();
    await c.execute('list_orders', {
      status: 'closed',
      limit: 10,
      since_id: '999',
      created_at_min: '2024-01-01',
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('status=closed');
    expect(url).toContain('limit=10');
    expect(url).toContain('since_id=999');
    expect(url).toContain('created_at_min=2024-01-01');
  });

  // ── get_order ─────────────────────────────────────────────────────────

  it('should fetch a single order with details', async () => {
    const apiBody = {
      order: {
        id: 2001,
        order_number: '#2001',
        email: 'cust@x.com',
        total_price: '100.00',
        subtotal_price: '90.00',
        currency: 'USD',
        financial_status: 'paid',
        fulfillment_status: 'fulfilled',
        created_at: '2024-02-01T12:00:00Z',
        line_items: [
          { title: 'Gadget', quantity: 2, price: '45.00' },
        ],
        shipping_address: {
          address1: '123 Main St',
          address2: null,
          city: 'Springfield',
          province: 'IL',
          country: 'US',
          zip: '62701',
        },
        customer: { first_name: 'John', last_name: 'Smith', email: 'john@x.com' },
      },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(apiBody));

    const c = makeConnector();
    const result = await c.execute('get_order', { orderId: '2001' });

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(2001);
    expect((result.data?.line_items as any[]).length).toBe(1);
    expect((result.data?.shipping_address as any).city).toBe('Springfield');
    expect((result.data?.customer as any).first_name).toBe('John');
  });

  it('should require orderId for get_order', async () => {
    const c = makeConnector();
    const result = await c.execute('get_order', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('orderId is required');
  });

  it('should handle order not found', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ order: null }));
    const c = makeConnector();
    const result = await c.execute('get_order', { orderId: '9999' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  // ── list_products ─────────────────────────────────────────────────────

  it('should list products', async () => {
    const apiBody = {
      products: [
        {
          id: 3001,
          title: 'Super Widget',
          status: 'active',
          variants: [{ id: 1 }, { id: 2 }],
          images: [{ id: 10 }],
          created_at: '2024-01-10T08:00:00Z',
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(apiBody));

    const c = makeConnector();
    const result = await c.execute('list_products', {});

    expect(result.success).toBe(true);
    const products = result.data?.products as any[];
    expect(products).toHaveLength(1);
    expect(products[0].variants_count).toBe(2);
    expect(products[0].images_count).toBe(1);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/products.json');
  });

  it('should pass optional params for list_products', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ products: [] }));

    const c = makeConnector();
    await c.execute('list_products', {
      limit: 5,
      collection_id: 'col123',
      status: 'draft',
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('limit=5');
    expect(url).toContain('collection_id=col123');
    expect(url).toContain('status=draft');
  });

  // ── list_customers ────────────────────────────────────────────────────

  it('should search customers', async () => {
    const apiBody = {
      customers: [
        {
          id: 4001,
          first_name: 'Alice',
          last_name: 'W',
          email: 'alice@x.com',
          orders_count: 5,
          total_spent: '250.00',
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(apiBody));

    const c = makeConnector();
    const result = await c.execute('list_customers', { query: 'alice' });

    expect(result.success).toBe(true);
    const customers = result.data?.customers as any[];
    expect(customers).toHaveLength(1);
    expect(customers[0].email).toBe('alice@x.com');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/customers/search.json');
    expect(url).toContain('query=alice');
  });

  // ── Stub operations ───────────────────────────────────────────────────

  it('should return error for fulfill_order (stub)', async () => {
    const c = makeConnector();
    const result = await c.execute('fulfill_order', { orderId: '1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Requires implementation');
  });

  it('should return error for refund (stub)', async () => {
    const c = makeConnector();
    const result = await c.execute('refund', { orderId: '1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Requires implementation');
  });

  it('should return error for update_product (stub)', async () => {
    const c = makeConnector();
    const result = await c.execute('update_product', { productId: '1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Requires implementation');
  });

  // ── healthCheck ───────────────────────────────────────────────────────

  it('should return true when /shop.json responds ok', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ shop: { name: 'My Store' } }));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(true);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/shop.json');
  });

  it('should return false on 401', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, 401));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('should return false when fetch throws', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const c = makeConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  it('should return false without credentials', async () => {
    const c = new ShopifyConnector();
    expect(await c.healthCheck()).toBe(false);
  });

  // ── API error handling ────────────────────────────────────────────────

  it('should parse Shopify API error string', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ errors: 'Not Found' }, 404),
    );
    const c = makeConnector();
    const result = await c.execute('list_orders', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not Found');
  });

  it('should parse Shopify API error object', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ errors: { order: ['is invalid'] } }, 422),
    );
    const c = makeConnector();
    const result = await c.execute('list_orders', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('order');
  });

  it('should catch thrown errors during execution', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('SSL error'));
    const c = makeConnector();
    const result = await c.execute('list_orders', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('SSL error');
  });

  // ── URL construction ──────────────────────────────────────────────────

  it('should strip trailing slashes from storeUrl', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ orders: [] }));
    const c = new ShopifyConnector({
      credentials: { storeUrl: 'my-store.myshopify.com///', accessToken: 'tok' },
    });
    await c.execute('list_orders', {});

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/my-store\.myshopify\.com\/admin\/api\//);
    expect(url).not.toContain('///');
  });
});
