/**
 * Focused regression tests for the settle-before-dispatch fix in handleTier.
 *
 * The bug: settlement ran fire-and-forget in ctx.waitUntil(...).catch(console.error),
 * so a paid route returned its 200 response (including the Shopify fulfillment_url on
 * the $4,999 / $9,999 tiers) BEFORE settlement was confirmed, and swallowed any settle
 * failure. A verified-but-unsettled payment still got the goods.
 *
 * The fix: settlement is awaited and gates the response. These tests prove:
 *   1. settle success  -> 200 with the result and a settlement_tx.
 *   2. settle success:false -> 402, and NO fulfillment_url / result leaks.
 *   3. settle HTTP 5xx  -> 402, and NO fulfillment_url / result leaks.
 *   4. settlement is NOT dispatched via ctx.waitUntil anymore.
 *
 * This file is deliberately separate from index.test.ts, which targets a richer
 * in-progress (939-line) index.ts variant and is skewed against the committed source.
 * Everything here is mocked at the module and global-fetch boundary; no network,
 * wallet, or facilitator is touched.
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
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

let worker: WorkerModule['default'];

function buildEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    VAULT_ADDRESS: VAULT,
    USDC_ADDRESS: USDC_BASE,
    CHAIN_ID: '8453',
    // No CDP_API_KEY_ID/SECRET -> facilitatorPost uses the public facilitator path,
    // so verify/settle go through global fetch with no JWT minting.
    TIER_DISCOVERY_USD6: '10000',
    TIER_FOUNDERS_USD6: '4999000000',
    SHOPIFY_FOUNDERS_URL: 'https://shop.example/founders',
    ...overrides,
  };
}

interface TestCtx {
  pending: Promise<unknown>[];
  waitUntil: ReturnType<typeof vi.fn>;
  passThroughOnException: ReturnType<typeof vi.fn>;
}

function createCtx(): TestCtx {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: vi.fn((p: Promise<unknown>) => {
      pending.push(Promise.resolve(p));
    }),
    passThroughOnException: vi.fn(),
  };
}

/**
 * Stub global fetch so verify always succeeds and settle returns whatever the
 * test dictates. Returns the fetch spy so a test can assert which facilitator
 * endpoints were hit.
 */
function stubFacilitator(settle: () => Response): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/verify')) {
      return Response.json({ isValid: true, payer: '0xPayer' });
    }
    if (url.endsWith('/settle')) {
      return settle();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function paidPost(path: string, envOverrides: Record<string, unknown> = {}) {
  const ctx = createCtx();
  const req = new Request(`${HOST}${path}`, {
    method: 'POST',
    headers: { 'PAYMENT-SIGNATURE': 'valid-sig', 'Content-Type': 'application/json' },
    body: JSON.stringify({ job: 'run' }),
  });
  const response = await worker.fetch(req, buildEnv(envOverrides) as never, ctx as never);
  return { response, ctx };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  worker = (await import('./index')).default;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settle gates the response', () => {
  it('releases the result and a settlement_tx only after settle succeeds', async () => {
    const fetchSpy = stubFacilitator(() =>
      Response.json({ success: true, transaction: '0xSettleTx', network: 'eip155:8453' }),
    );

    const { response, ctx } = await paidPost('/api/execute');

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.settlement_tx).toBe('0xSettleTx');
    expect(body.charged_usd6).toBe('10000');

    // Both verify and settle were awaited through fetch...
    const hitEndpoints = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(hitEndpoints.some((u) => u.endsWith('/verify'))).toBe(true);
    expect(hitEndpoints.some((u) => u.endsWith('/settle'))).toBe(true);
    // ...and settlement is NO LONGER fire-and-forget through waitUntil.
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('returns 402 and leaks NO result when the facilitator reports settle failure', async () => {
    stubFacilitator(() => Response.json({ success: false, errorReason: 'insufficient_funds' }));

    const { response } = await paidPost('/api/execute');

    expect(response.status).toBe(402);
    // Assert the TOP-LEVEL result fields, not substrings: the 402 challenge body
    // embeds a Bazaar discovery-extension example that legitimately contains
    // "success":true, so a substring check would false-positive. What must never
    // appear is an actual settled result.
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).not.toBe(true);
    expect(body.settlement_tx).toBeUndefined();
    expect(body.fulfillment_url).toBeUndefined();
  });

  it('returns 402 and leaks NO fulfillment_url when settle fails on a Shopify tier', async () => {
    // This is the core of the bug: a verified-but-unsettled payment must NOT
    // receive the $4,999 fulfillment URL.
    stubFacilitator(() => Response.json({ success: false, errorReason: 'nonce_already_used' }));

    const { response } = await paidPost('/api/founders');

    expect(response.status).toBe(402);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).not.toBe(true);
    expect(body.fulfillment_url).toBeUndefined();
    expect(body.settlement_tx).toBeUndefined();
  });

  it('returns 502 and no result when the settle request itself throws', async () => {
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/verify')) return Response.json({ isValid: true, payer: '0xPayer' });
      if (url.endsWith('/settle')) throw new Error('network down');
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', spy);

    const { response } = await paidPost('/api/founders');

    expect(response.status).toBe(502);
    const raw = await response.text();
    expect(raw).not.toContain('shop.example/founders');
  });

  it('hands over the Shopify fulfillment_url once settle succeeds', async () => {
    stubFacilitator(() => Response.json({ success: true, transaction: '0xFound' }));

    const { response } = await paidPost('/api/founders');

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.fulfillment_url).toBe('https://shop.example/founders');
    expect(body.settlement_tx).toBe('0xFound');
  });
});
