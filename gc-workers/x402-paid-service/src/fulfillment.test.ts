/**
 * High-tier auto-fulfillment and revenue reporting.
 *
 * The invariant these tests exist to protect: fulfillment runs AFTER on-chain
 * settlement, so by the time it can fail the buyer's $4,999 is already gone and
 * unrecoverable. A fulfillment failure must therefore never surface as a 5xx —
 * the caller has to receive the settlement tx and a support reference, because
 * an error response invites a retry that charges them a second time.
 *
 * Everything is mocked at the module and global-fetch boundary; no network,
 * wallet, facilitator, or Shopify store is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const httpMocks = vi.hoisted(() => ({
  encodePaymentRequiredHeader: vi.fn(() => 'encoded-payment-required'),
  decodePaymentSignatureHeader: vi.fn((header: string) => ({ signed: header })),
}));

const coinbaseMocks = vi.hoisted(() => ({
  createAuthHeader: vi.fn(async () => 'test-jwt'),
  createCorrelationHeader: vi.fn(() => 'test-correlation'),
}));

vi.mock('@x402/core/http', () => httpMocks);
vi.mock('@coinbase/x402', () => coinbaseMocks);

type WorkerModule = typeof import('./index');

const HOST = 'https://worker.example';
const VAULT = '0x000000000000000000000000000000000000dEaD';
const VARIANT = 'gid://shopify/ProductVariant/111';
const SHOP = 'test-store.myshopify.com';

let worker: WorkerModule['default'];

interface KvMock {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function createKv(): KvMock {
  return { put: vi.fn(async () => undefined), get: vi.fn(async () => null) };
}

function buildEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    VAULT_ADDRESS: VAULT,
    CHAIN_ID: '8453',
    TIER_DISCOVERY_USD6: '10000',
    TIER_FOUNDERS_USD6: '4999000000',
    SHOPIFY_FOUNDERS_URL: 'https://shop.example/founders',
    SHOPIFY_FOUNDERS_VARIANT_ID: VARIANT,
    SHOPIFY_ADMIN_TOKEN: 'test-admin-token',
    SHOPIFY_SHOP_DOMAIN: SHOP,
    ...overrides,
  };
}

function createCtx() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
}

/** Which Shopify operation a GraphQL request body represents. */
function operationOf(init?: RequestInit): string {
  const body = String(init?.body ?? '');
  if (body.includes('CreatePaidOrder')) return 'orderCreate';
  if (body.includes('PaidOrders')) return 'orders';
  if (body.includes('ActiveSubscriptions')) return 'subscriptions';
  return 'unknown';
}

const ORDER_OK = {
  data: {
    orderCreate: {
      order: {
        id: 'gid://shopify/Order/9001',
        name: '#1001',
        statusPageUrl: 'https://shop.example/orders/9001',
      },
      userErrors: [],
    },
  },
};

/**
 * Stub verify+settle as successful and route Shopify Admin calls to `shopify`.
 * Returns the spy so tests can assert whether Shopify was contacted at all.
 */
function stubNetwork(
  shopify: (op: string) => Response,
  settle: () => Response = () => Response.json({ success: true, transaction: '0xSettleTx' }),
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/verify')) return Response.json({ isValid: true, payer: '0xPayer' });
    if (url.endsWith('/settle')) return settle();
    if (url.includes('/admin/api/')) return shopify(operationOf(init));
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function paidPost(path: string, envOverrides: Record<string, unknown> = {}) {
  const env = buildEnv(envOverrides);
  const req = new Request(`${HOST}${path}`, {
    method: 'POST',
    headers: { 'PAYMENT-SIGNATURE': 'valid-sig', 'Content-Type': 'application/json' },
    body: JSON.stringify({ job: 'run' }),
  });
  const response = await worker.fetch(req, env as never, createCtx() as never);
  return { response, env };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  worker = (await import('./index')).default;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('high-tier auto-fulfillment', () => {
  it('creates a real paid order and returns a license key', async () => {
    const kv = createKv();
    stubNetwork(() => Response.json(ORDER_OK));

    const { response } = await paidPost('/api/founders', { API_KEYS: kv });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.fulfillment_status).toBe('order_created');
    expect(body.order_id).toBe('gid://shopify/Order/9001');
    expect(body.order_status_url).toBe('https://shop.example/orders/9001');
    expect(body.settlement_tx).toBe('0xSettleTx');
    expect(typeof body.license_key).toBe('string');
    expect(body.license_key).toBeTruthy();

    // The licence is indexed for lookup, keyed by the value handed to the buyer.
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [kvKey, kvValue] = kv.put.mock.calls[0] as [string, string];
    expect(kvKey).toBe(`license:${body.license_key}`);
    expect(JSON.parse(kvValue)).toMatchObject({
      payer: '0xPayer',
      tier: 'founders',
      order_id: 'gid://shopify/Order/9001',
      settlement_tx: '0xSettleTx',
    });
  });

  it('sends the payer and settlement tx to Shopify as the audit trail', async () => {
    let sentBody: string | undefined;
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/verify')) return Response.json({ isValid: true, payer: '0xPayer' });
      if (url.endsWith('/settle')) return Response.json({ success: true, transaction: '0xSettleTx' });
      if (url.includes('/admin/api/')) {
        sentBody = String(init?.body ?? '');
        return Response.json(ORDER_OK);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', spy);

    await paidPost('/api/founders', { API_KEYS: createKv() });

    const parsed = JSON.parse(sentBody!) as { variables: { order: Record<string, unknown> } };
    const order = parsed.variables.order;
    expect(order.financialStatus).toBe('PAID');
    expect(order.lineItems).toEqual([{ variantId: VARIANT, quantity: 1 }]);
    const attrs = order.customAttributes as { key: string; value: string }[];
    expect(attrs).toEqual(
      expect.arrayContaining([
        { key: 'x402_payer', value: '0xPayer' },
        { key: 'x402_settlement_tx', value: '0xSettleTx' },
        { key: 'x402_charged_amount', value: '4999000000' },
        { key: 'x402_charged_asset', value: 'USDC' },
      ]),
    );
  });

  it('returns 200 with pending_manual when Shopify rejects the order', async () => {
    // The money-safety invariant. Settlement already happened, so this must NOT
    // be an error response — an error invites a retry and a second charge.
    stubNetwork(() =>
      Response.json({
        data: {
          orderCreate: {
            order: null,
            userErrors: [{ field: ['lineItems'], message: 'Variant not found' }],
          },
        },
      }),
    );

    const { response } = await paidPost('/api/founders', { API_KEYS: createKv() });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.fulfillment_status).toBe('pending_manual');
    expect(body.order_id).toBeNull();
    expect(body.license_key).toBeNull();
    // The buyer keeps proof of payment and a reference to quote.
    expect(body.settlement_tx).toBe('0xSettleTx');
    expect(body.support_ref).toBe('0xPayer:0xSettleTx');
    // ...and still gets somewhere to go.
    expect(body.fulfillment_url).toBe('https://shop.example/founders');
  });

  it('returns 200 with pending_manual when the Shopify API is down', async () => {
    stubNetwork(() => new Response('gateway timeout', { status: 504 }));

    const { response } = await paidPost('/api/founders', { API_KEYS: createKv() });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.fulfillment_status).toBe('pending_manual');
    expect(body.settlement_tx).toBe('0xSettleTx');
  });

  it('still returns the order when only the licence index write fails', async () => {
    // Shopify holds the licence in customAttributes, so KV is a cache, not the
    // record. Losing it must not downgrade a completed purchase.
    const kv = createKv();
    kv.put.mockRejectedValue(new Error('KV unavailable'));
    stubNetwork(() => Response.json(ORDER_OK));

    const { response } = await paidPost('/api/founders', { API_KEYS: kv });

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.fulfillment_status).toBe('order_created');
    expect(body.order_id).toBe('gid://shopify/Order/9001');
    expect(body.license_key).toBeTruthy();
  });

  it('degrades without calling Shopify when no variant is configured', async () => {
    const spy = stubNetwork(() => Response.json(ORDER_OK));

    const { response } = await paidPost('/api/founders', {
      SHOPIFY_FOUNDERS_VARIANT_ID: '',
      API_KEYS: createKv(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.fulfillment_status).toBe('pending_manual');
    const hit = spy.mock.calls.map((c) => String(c[0]));
    expect(hit.some((u) => u.includes('/admin/api/'))).toBe(false);
  });

  it('never fulfils when settlement fails', async () => {
    const spy = stubNetwork(
      () => Response.json(ORDER_OK),
      () => Response.json({ success: false, errorReason: 'nonce_already_used' }),
    );

    const { response } = await paidPost('/api/founders', { API_KEYS: createKv() });

    expect(response.status).toBe(402);
    const hit = spy.mock.calls.map((c) => String(c[0]));
    expect(hit.some((u) => u.includes('/admin/api/'))).toBe(false);
  });

  it('leaves non-Shopify tiers untouched', async () => {
    stubNetwork(() => Response.json(ORDER_OK));

    const { response } = await paidPost('/api/execute', { API_KEYS: createKv() });

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.fulfillment_status).toBeUndefined();
    expect(body.license_key).toBeUndefined();
    expect(body.settlement_tx).toBe('0xSettleTx');
  });
});

describe('GET /health/revenue', () => {
  const REVENUE_TOKEN = 'super-secret-revenue-token';

  function revenueShopify(op: string): Response {
    if (op === 'orders') {
      return Response.json({
        data: {
          orders: {
            edges: [
              {
                node: {
                  id: 'gid://shopify/Order/1',
                  name: '#1001',
                  createdAt: '2026-01-01T00:00:00Z',
                  displayFinancialStatus: 'PAID',
                  currentTotalPriceSet: { shopMoney: { amount: '4999.00', currencyCode: 'USD' } },
                  sourceName: 'x402',
                },
              },
            ],
          },
        },
      });
    }
    return Response.json({ data: { subscriptionContracts: { edges: [] } } });
  }

  async function getRevenue(headers: Record<string, string>, envOverrides: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/admin/api/')) return revenueShopify(operationOf(init));
        throw new Error(`unexpected fetch: ${String(input)}`);
      }),
    );
    const req = new Request(`${HOST}/health/revenue`, { headers });
    return worker.fetch(req, buildEnv(envOverrides) as never, createCtx() as never);
  }

  it('is disabled rather than public when no token is configured', async () => {
    const res = await getRevenue({}, {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    // Must not leak figures on the unconfigured path.
    expect(body.recurring_mrr_usd).toBeUndefined();
  });

  it('rejects a missing or wrong bearer token', async () => {
    const missing = await getRevenue({}, { REVENUE_TOKEN });
    expect(missing.status).toBe(401);

    const wrong = await getRevenue({ Authorization: 'Bearer nope' }, { REVENUE_TOKEN });
    expect(wrong.status).toBe(401);
    const body = (await wrong.json()) as Record<string, unknown>;
    expect(body.one_time_revenue_usd).toBeUndefined();
  });

  it('reports one-time revenue and MRR separately for a valid token', async () => {
    const res = await getRevenue({ Authorization: `Bearer ${REVENUE_TOKEN}` }, { REVENUE_TOKEN });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.one_time_revenue_usd).toBe(4999);
    expect(body.paid_order_count).toBe(1);
    // One-time GMV is never reported as MRR.
    expect(body.recurring_mrr_usd).toBe(0);
    expect(body.by_source_usd).toEqual({ x402: 4999 });
  });
});
