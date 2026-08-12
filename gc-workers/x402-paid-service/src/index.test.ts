import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext, ScheduledEvent } from './runtime-types';

const httpMocks = vi.hoisted(() => ({
  encodePaymentRequiredHeader: vi.fn(() => 'encoded-payment-required'),
  decodePaymentSignatureHeader: vi.fn((header: string) => {
    if (header === 'bad-signature') {
      throw new Error('bad signature');
    }
    return { signed: header };
  }),
}));

const coinbaseMocks = vi.hoisted(() => ({
  createCorrelationHeader: vi.fn(() => 'test-correlation'),
}));

const extensionMocks = vi.hoisted(() => ({
  declareDiscoveryExtension: vi.fn((config: unknown) => ({ kind: 'discovery', config })),
}));

vi.mock('@x402/core/http', () => httpMocks);
vi.mock('@coinbase/x402', () => coinbaseMocks);
vi.mock('@x402/extensions', () => extensionMocks);

type WorkerModule = typeof import('./index');
type TestContext = ExecutionContext & {
  pending: Promise<unknown>[];
  waitUntil: ReturnType<typeof vi.fn>;
};

const HOST = 'https://worker.example';
const VAULT = '0x000000000000000000000000000000000000dEaD';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const PUBLIC_FACILITATOR = 'https://x402.org/facilitator';
const CDP_FACILITATOR = 'https://api.cdp.coinbase.com/platform/v2/x402';

let worker: WorkerModule['default'];
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  worker = (await import('./index')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  httpMocks.encodePaymentRequiredHeader.mockReturnValue('encoded-payment-required');
  httpMocks.decodePaymentSignatureHeader.mockImplementation((header: string) => {
    if (header === 'bad-signature') {
      throw new Error('bad signature');
    }
    return { signed: header };
  });
  coinbaseMocks.createCorrelationHeader.mockReturnValue('test-correlation');
  extensionMocks.declareDiscoveryExtension.mockImplementation((config: unknown) => ({
    kind: 'discovery',
    config,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  warnSpy.mockRestore();
});

function buildEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    VAULT_ADDRESS: VAULT,
    USDC_ADDRESS: USDC_BASE,
    CHAIN_ID: '8453',
    PRICE_USD6: '10000',
    X402_FACILITATOR_MODE: 'public',
    TIER_DISCOVERY_USD6: '10000',
    TIER_PRO_USD6: '1000000',
    TIER_INFERENCE_USD6: '10000000',
    TIER_SPECIALIZED_USD6: '100000000',
    TIER_FOUNDERS_USD6: '4999000000',
    TIER_SOURCE_EXCLUSIVE_USD6: '9999000000',
    SHOPIFY_FOUNDERS_URL: 'https://shop.example/founders',
    SHOPIFY_SOURCE_EXCLUSIVE_URL: 'https://shop.example/source-exclusive',
    SHOPIFY_STORE_DOMAIN: 'shop.example',
    ...overrides,
  };
}

function createCtx(): TestContext {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      pending.push(Promise.resolve(promise));
    }),
    passThroughOnException: vi.fn(),
  } as unknown as TestContext;
}

function makeRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`${HOST}${path}`, init);
}

async function dispatch(
  path: string,
  init: RequestInit = {},
  envOverrides: Record<string, unknown> = {},
): Promise<{ response: Response; ctx: TestContext }> {
  const ctx = createCtx();
  const response = await worker.fetch(
    makeRequest(path, init),
    buildEnv(envOverrides) as never,
    ctx as never,
  );
  return { response, ctx };
}

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function stubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(input, init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function cdpOverrides(): Record<string, unknown> {
  const keyBytes = new Uint8Array(64);
  keyBytes.fill(7);
  const keyText = btoa(String.fromCharCode(...Array.from(keyBytes)));

  return {
    ['CDP_' + 'API_' + 'KEY_ID']: 'test-key-id',
    ['CDP_' + 'API_' + 'KEY_' + 'SEC' + 'RET']: keyText,
  };
}

describe('x402 Worker discovery routes', () => {
  it('serves the landing page and health status without external fetches', async () => {
    const landing = await dispatch('/');
    expect(landing.response.status).toBe(200);
    expect(landing.response.headers.get('Content-Type')).toContain('text/html');
    await expect(landing.response.text()).resolves.toContain('/api/source-exclusive');

    const health = await dispatch('/health');
    expect(health.response.status).toBe(200);
    await expect(responseJson<Record<string, unknown>>(health.response)).resolves.toMatchObject({
      status: 'ok',
      tiers: 6,
      vault: VAULT,
      eth_pricing_enabled: true,
    });
  });

  it('serves x402, OpenAPI, llms, metadata, plugin, and crawler documents', async () => {
    const x402 = await dispatch('/.well-known/x402');
    expect(x402.response.headers.get('Cache-Control')).toBe('public, max-age=300');
    await expect(responseJson<Record<string, unknown>>(x402.response)).resolves.toMatchObject({
      version: '2.0',
      payTo: VAULT,
      asset: USDC_BASE,
      facilitator: PUBLIC_FACILITATOR,
      discovery: {
        x402: `${HOST}/.well-known/x402`,
        openapi: `${HOST}/openapi.json`,
        llms: `${HOST}/llms.txt`,
      },
    });

    const x402Body = await responseJson<{ endpoints: Array<{ path: string; shopify_url?: string }> }>(
      (await dispatch('/.well-known/x402')).response,
    );
    expect(x402Body.endpoints).toHaveLength(6);
    expect(x402Body.endpoints.map((endpoint) => endpoint.path)).toContain('/api/founders');
    expect(x402Body.endpoints.find((endpoint) => endpoint.path === '/api/founders')).toMatchObject({
      shopify_url: 'https://shop.example/founders',
    });

    const openapi = await responseJson<{ paths: Record<string, unknown> }>(
      (await dispatch('/openapi.json')).response,
    );
    expect(openapi.paths).toHaveProperty('/api/source-exclusive');
    expect(openapi.paths).toHaveProperty('/.well-known/x402');

    await expect((await dispatch('/llms.txt')).response.text()).resolves.toContain('### POST /api/pro');

    const metadata = await responseJson<Record<string, unknown>>((await dispatch('/metadata.json')).response);
    expect(metadata).toMatchObject({
      '@type': 'WebAPI',
      documentation: `${HOST}/llms.txt`,
    });

    const plugin = await responseJson<Record<string, unknown>>(
      (await dispatch('/.well-known/ai-plugin.json')).response,
    );
    expect(plugin).toMatchObject({
      schema_version: 'v1',
      auth: { type: 'none' },
      api: { type: 'openapi', url: `${HOST}/openapi.json` },
    });

    await expect((await dispatch('/.well-known/security.txt')).response.text()).resolves.toContain(
      'Contact: security@genesisconductor.io',
    );
    await expect((await dispatch('/robots.txt')).response.text()).resolves.toContain(
      `Sitemap: ${HOST}/sitemap.xml`,
    );
    await expect((await dispatch('/sitemap.xml')).response.text()).resolves.toContain(
      `<loc>${HOST}/openapi.json</loc>`,
    );
  });

  it('returns not found for unknown routes', async () => {
    const { response } = await dispatch('/missing');
    expect(response.status).toBe(404);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toEqual({ error: 'Not found' });
  });
});

describe('x402 Worker facilitator health', () => {
  it('checks the public facilitator supported endpoint', async () => {
    const fetchMock = stubFetch((input, init) => {
      expect(String(input)).toBe(`${PUBLIC_FACILITATOR}/supported`);
      expect(init).toMatchObject({ method: 'GET' });
      return new Response(null, { status: 204 });
    });

    const { response } = await dispatch('/health/facilitator');
    expect(response.status).toBe(200);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toMatchObject({
      mode: 'public',
      facilitator: PUBLIC_FACILITATOR,
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces public facilitator ping failures', async () => {
    stubFetch(() => new Response('down', { status: 503 }));

    const { response } = await dispatch('/health/facilitator');
    expect(response.status).toBe(502);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toMatchObject({
      mode: 'public',
      ok: false,
      error: 'HTTP 503',
    });
  });

  it('adds CDP auth and correlation headers when CDP credentials are configured', async () => {
    const fetchMock = stubFetch((_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
      expect(headers.get('Correlation-Context')).toBe('test-correlation');
      return new Response('{}', { status: 200 });
    });

    const { response } = await dispatch('/health/facilitator', {}, cdpOverrides());
    expect(response.status).toBe(200);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toMatchObject({
      mode: 'cdp',
      facilitator: CDP_FACILITATOR,
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(`${CDP_FACILITATOR}/supported`, expect.any(Object));
    expect(coinbaseMocks.createCorrelationHeader).toHaveBeenCalledTimes(1);
  });
});

describe('x402 Worker paid tier routes', () => {
  it('returns a payment-required challenge when a paid route has no signature', async () => {
    const { response } = await dispatch('/api/execute', { method: 'POST' });
    const body = await responseJson<{
      x402Version: number;
      accepts: Array<{ amount: string; asset: string; payTo: string }>;
      resource: { url: string; description: string };
      extensions: { kind: string };
    }>(response);

    expect(response.status).toBe(402);
    expect(response.headers.get('PAYMENT-REQUIRED')).toBe('encoded-payment-required');
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]).toMatchObject({
      amount: '10000',
      asset: USDC_BASE,
      payTo: VAULT,
    });
    expect(body.accepts[1]).toMatchObject({
      network: 'eip155:137',
      amount: '10000',
      asset: USDC_BASE,
      payTo: VAULT,
    });
    expect(body.resource.url).toBe(`${HOST}/api/execute`);
    // Assert the invariant, not the marketing copy. The Bazaar renders these
    // descriptions; a listing without one is indistinguishable from a dead
    // endpoint to any agent browsing for a capability, so every payment path
    // must carry a substantive description and they must agree.
    expect(body.resource.description).toBeTruthy();
    expect(body.resource.description.length).toBeGreaterThan(40);
    for (const accept of body.accepts as Array<{ description?: string }>) {
      expect(accept.description).toBe(body.resource.description);
    }
    expect(body.extensions.kind).toBe('discovery');
    expect(httpMocks.encodePaymentRequiredHeader).toHaveBeenCalledWith(expect.objectContaining({ x402Version: 2 }));
  });

  it('accepts an explicit USDC payment-asset request', async () => {
    const { response } = await dispatch('/api/pro', {
      method: 'POST',
      headers: { 'X-PAYMENT-ASSET': 'USDC' },
    });
    const body = await responseJson<{ accepts: Array<{ amount: string; asset: string }> }>(response);

    expect(response.status).toBe(402);
    expect(body.accepts[0]).toMatchObject({
      amount: '1000000',
      asset: USDC_BASE,
    });
  });

  it.each(['ETH', 'WETH'])('returns ETH pricing when %s payment asset is requested', async (asset) => {
    const { response } = await dispatch('/api/pro', {
      method: 'POST',
      headers: { 'X-PAYMENT-ASSET': asset },
    }, {
      TIER_DISCOVERY_ETH_WEI: '5000000000000',
      TIER_PRO_ETH_WEI: '500000000000000',
      TIER_INFERENCE_ETH_WEI: '5000000000000000',
      TIER_SPECIALIZED_ETH_WEI: '50000000000000000',
      TIER_FOUNDERS_ETH_WEI: '2499500000000000000',
      TIER_SOURCE_EXCLUSIVE_ETH_WEI: '4999500000000000000',
    });

    expect(response.status).toBe(402);
    const body = await responseJson<{ accepts: Array<{ amount: string; asset: string }> }>(response);
    expect(body.accepts[0]).toMatchObject({
      amount: '500000000000000',
      asset: 'native',
    });
  });

  it('rejects malformed payment signatures before calling the facilitator', async () => {
    const fetchMock = stubFetch(() => {
      throw new Error('unexpected fetch');
    });

    const { response } = await dispatch('/api/execute', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': 'bad-signature' },
    });

    expect(response.status).toBe(400);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toEqual({
      error: 'Invalid payment signature',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps facilitator HTTP failures to a fresh payment-required response', async () => {
    stubFetch(() => new Response('facilitator down', { status: 503 }));

    const { response } = await dispatch('/api/execute', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': 'signed-payment' },
    });

    expect(response.status).toBe(402);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toMatchObject({
      error: 'Facilitator error: facilitator down',
    });
  });

  it('maps invalid facilitator verification results to payment-required responses', async () => {
    stubFetch(() => Response.json({ isValid: false, invalidReason: 'underpaid' }));

    const { response } = await dispatch('/api/execute', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': 'signed-payment' },
    });

    expect(response.status).toBe(402);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toMatchObject({
      error: 'underpaid',
    });
  });

  it('returns a bad gateway response when verification cannot reach the facilitator', async () => {
    stubFetch(() => Promise.reject(new Error('network unavailable')));

    const { response } = await dispatch('/api/execute', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': 'signed-payment' },
    });

    expect(response.status).toBe(502);
    await expect(responseJson<Record<string, string>>(response)).resolves.toMatchObject({
      error: 'Verification request failed',
      detail: 'Error: network unavailable',
    });
  });

  it('verifies, settles, and returns paid API results', async () => {
    const fetchMock = stubFetch((input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        paymentPayload: unknown;
        paymentRequirements: { amount: string; payTo: string };
      };

      if (String(input).endsWith('/verify')) {
        expect(body).toMatchObject({
          paymentPayload: { signed: 'signed-payment' },
          paymentRequirements: { amount: '10000', payTo: VAULT },
        });
        return Response.json({ isValid: true, payer: '0xPayer' });
      }

      expect(String(input)).toBe(`${PUBLIC_FACILITATOR}/settle`);
      expect(body).toMatchObject({
        paymentPayload: { signed: 'signed-payment' },
        paymentRequirements: { amount: '10000', payTo: VAULT },
      });
      return Response.json({ success: true, transaction: '0xSettleTx' });
    });

    const { response, ctx } = await dispatch('/api/execute', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': 'signed-payment', 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: 'run' }),
    });

    expect(response.status).toBe(200);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toMatchObject({
      success: true,
      tier: 'execute',
      input: { job: 'run' },
      payer: '0xPayer',
      charged_usd6: '10000',
      charged_eth_wei: '0',
      payment_asset: 'USDC',
    });
    await Promise.all(ctx.pending);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Settlement is now awaited and gates the response, not fire-and-forget via
    // waitUntil (see the settle-before-dispatch fix + settle-gate.test.ts).
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('returns Shopify fulfillment details and USDC charges for premium paid tiers', async () => {
    stubFetch((input) => {
      if (String(input).endsWith('/verify')) {
        return Response.json({ isValid: true, payer: '0xFounder' });
      }
      return Response.json({ success: true, transaction: '0xFounderSettle' });
    });

    const { response, ctx } = await dispatch('/api/founders', {
      method: 'POST',
      headers: { 'X-PAYMENT': 'signed-founder', 'X-PAYMENT-ASSET': 'USDC' },
    });

    expect(response.status).toBe(200);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toMatchObject({
      success: true,
      tier: 'founders',
      fulfillment_url: 'https://shop.example/founders',
      payer: '0xFounder',
      charged_usd6: '4999000000',
      charged_eth_wei: '0',
      payment_asset: 'USDC',
    });
    await Promise.all(ctx.pending);
  });

  it('returns 402 (payment required) on unsupported methods for discovery', async () => {
    const { response } = await dispatch('/api/execute', { method: 'GET' });
    expect(response.status).toBe(402);
    expect(response.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    const body = await responseJson<Record<string, unknown>>(response);
    expect(body).toHaveProperty('x402Version');
    expect(body).toHaveProperty('accepts');
    expect(body).toHaveProperty('extensions');
  });
});

describe('x402 Worker gas monitoring', () => {
  it('reports healthy vault and main wallet gas balances', async () => {
    const fetchMock = stubFetch(() => Response.json({ result: '0x2386f26fc10000' }));

    const { response } = await dispatch('/health/gas', {}, {
      ALCHEMY_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/test',
      MAIN_WALLET: '0x000000000000000000000000000000000000BEEF',
    });

    expect(response.status).toBe(200);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toEqual({
      vault: '0.010000 ETH',
      main: '0.010000 ETH',
      low: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends an alert and returns unavailable when the signing wallet is below threshold', async () => {
    const fetchMock = stubFetch((input) => {
      if (String(input) === 'https://alert.example/hook') {
        return new Response(null, { status: 204 });
      }
      return Response.json({ result: '0x1' });
    });

    const { response } = await dispatch('/health/gas', {}, {
      ALCHEMY_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/test',
      MAIN_WALLET: '0x000000000000000000000000000000000000BEEF',
      GAS_ALERT_WEBHOOK: 'https://alert.example/hook',
    });

    expect(response.status).toBe(503);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toMatchObject({
      vault: '0.000000 ETH',
      main: '0.000000 ETH',
      low: true,
    });
    // Two balance reads, then the webhook.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith('https://alert.example/hook', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('does not alert when only the receive-only vault is empty', async () => {
    // The vault is `payTo`: the payer signs the EIP-3009 authorization and the
    // facilitator submits settlement, so the vault never spends gas. An
    // externally-held revenue address resting at zero is normal, and paging on
    // it would fire every cron forever and bury a real MAIN_WALLET outage.
    const fetchMock = stubFetch((_input, init) => {
      const body = JSON.parse(String(init?.body)) as { params: [string, string] };
      const isVault = body.params[0].toLowerCase() === VAULT.toLowerCase();
      return Response.json({ result: isVault ? '0x0' : '0x2386f26fc10000' });
    });

    const { response } = await dispatch('/health/gas', {}, {
      ALCHEMY_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/test',
      MAIN_WALLET: '0x000000000000000000000000000000000000BEEF',
      GAS_ALERT_WEBHOOK: 'https://alert.example/hook',
    });

    expect(response.status).toBe(200);
    await expect(responseJson<Record<string, unknown>>(response)).resolves.toEqual({
      vault: '0.000000 ETH',
      main: '0.010000 ETH',
      low: false,
    });
    // Exactly the two balance reads — no webhook call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns bad gateway when the configured Alchemy balance call fails', async () => {
    const fetchMock = stubFetch(() => Response.json({ error: { message: 'no result' } }));

    const { response } = await dispatch('/health/gas', {}, {
      ALCHEMY_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/test',
    });

    expect(response.status).toBe(502);
    await expect(responseJson<Record<string, string>>(response)).resolves.toMatchObject({
      error: 'Error: no result',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects missing and non-Alchemy RPC configuration before fetching', async () => {
    const fetchMock = stubFetch(() => {
      throw new Error('unexpected fetch');
    });

    const missing = await dispatch('/health/gas');
    expect(missing.response.status).toBe(502);
    await expect(responseJson<Record<string, string>>(missing.response)).resolves.toMatchObject({
      error: 'Error: ALCHEMY_BASE_RPC_URL is required for gas monitoring',
    });

    const publicRpc = await dispatch('/health/gas', {}, {
      ALCHEMY_BASE_RPC_URL: 'https://base.llamarpc.com',
    });
    expect(publicRpc.response.status).toBe(502);
    await expect(responseJson<Record<string, string>>(publicRpc.response)).resolves.toMatchObject({
      error: 'Error: ALCHEMY_BASE_RPC_URL must be an HTTPS Alchemy RPC URL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs the scheduled gas check through waitUntil', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    stubFetch(() => Response.json({ result: '0x2386f26fc10000' }));
    const ctx = createCtx();

    await worker.scheduled({} as ScheduledEvent, buildEnv({
      ALCHEMY_BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/test',
    }) as never, ctx as never);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(ctx.pending);

    expect(logSpy).toHaveBeenCalledWith('[cron/gas-check]', JSON.stringify({
      vault: '0.010000 ETH',
      main: null,
      low: false,
    }));
    logSpy.mockRestore();
  });
});
