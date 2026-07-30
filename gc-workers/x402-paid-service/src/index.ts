import { encodePaymentRequiredHeader, decodePaymentSignatureHeader } from '@x402/core/http';
import { createAuthHeader, createCorrelationHeader } from '@coinbase/x402';

// ── Constants ─────────────────────────────────────────────────────────────────
const X402_VERSION = 2;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'eip155:8453';
const MAX_TIMEOUT_SECONDS = 60;
const PUBLIC_FACILITATOR = 'https://x402.org/facilitator';
const CDP_FACILITATOR = 'https://api.cdp.coinbase.com/platform/v2/x402';
const CDP_FACILITATOR_HOST = 'api.cdp.coinbase.com';
const CDP_FACILITATOR_PATH = '/platform/v2/x402';

// ── Env types ─────────────────────────────────────────────────────────────────
interface Env {
  API_KEYS: KVNamespace;
  ANALYTICS: AnalyticsEngineDataset;
  VAULT_ADDRESS: string;
  USDC_ADDRESS: string;
  CHAIN_ID: string;
  PRICE_USD6: string;
  X402_FACILITATOR_MODE: string;
  TIER_DISCOVERY_USD6: string;
  TIER_PRO_USD6: string;
  TIER_INFERENCE_USD6: string;
  TIER_SPECIALIZED_USD6: string;
  TIER_FOUNDERS_USD6: string;
  TIER_SOURCE_EXCLUSIVE_USD6: string;
  SHOPIFY_FOUNDERS_URL: string;
  SHOPIFY_SOURCE_EXCLUSIVE_URL: string;
  SHOPIFY_STORE_DOMAIN: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  // Gas monitoring
  BASE_RPC_URL?: string;
  MAIN_WALLET?: string;
  GAS_ALERT_WEBHOOK?: string;
}

// ── Tier configuration ────────────────────────────────────────────────────────
interface TierConfig {
  path: string;
  getAmount: (env: Env) => string;
  description: string;
  displayPrice: string;
  shopifyUrl?: (env: Env) => string;
}

const TIERS: TierConfig[] = [
  {
    path: '/api/execute',
    getAmount: (e) => e.TIER_DISCOVERY_USD6,
    description: 'Discovery tier — generic paid API call',
    displayPrice: '$0.01',
  },
  {
    path: '/api/pro',
    getAmount: (e) => e.TIER_PRO_USD6,
    description: 'Pro tier — premium paid API access',
    displayPrice: '$1.00',
  },
  {
    path: '/api/inference',
    getAmount: (e) => e.TIER_INFERENCE_USD6,
    description: 'Inference tier — AI inference workloads',
    displayPrice: '$10.00',
  },
  {
    path: '/api/specialized',
    getAmount: (e) => e.TIER_SPECIALIZED_USD6,
    description: 'Specialized data tier',
    displayPrice: '$100.00',
  },
  {
    path: '/api/founders',
    getAmount: (e) => e.TIER_FOUNDERS_USD6,
    description: 'Genesis Conductor Founders License — agent-to-agent checkout',
    displayPrice: '$4,999',
    shopifyUrl: (e) => e.SHOPIFY_FOUNDERS_URL,
  },
  {
    path: '/api/source-exclusive',
    getAmount: (e) => e.TIER_SOURCE_EXCLUSIVE_USD6,
    description: 'Genesis Conductor Source Exclusive — one source-exclusive plugin',
    displayPrice: '$9,999',
    shopifyUrl: (e) => e.SHOPIFY_SOURCE_EXCLUSIVE_URL,
  },
];

// ── x402 helpers ──────────────────────────────────────────────────────────────

function buildPaymentRequired(requestUrl: string, amount: string, payTo: string, asset: string, description: string) {
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        asset,
        amount,
        payTo,
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        extra: {},
      },
    ],
    resource: {
      url: requestUrl,
      description,
      mimeType: 'application/json',
    },
  };
}

function payment402(paymentRequired: ReturnType<typeof buildPaymentRequired>, error?: string): Response {
  const body = error ? { ...paymentRequired, error } : paymentRequired;
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(body as any),
    },
  });
}

/**
 * Posts to the configured facilitator.
 *
 * When CDP_API_KEY_ID and CDP_API_KEY_SECRET are present in env, requests are
 * routed through the Coinbase CDP facilitator (https://api.cdp.coinbase.com/platform/v2/x402)
 * with a per-request JWT in the Authorization header so high-tier settlements
 * ($4,999 / $9,999) are handled production-grade.
 *
 * Falls back to the public x402.org facilitator when the CDP keys are absent.
 * Keys are always read from env (never from process.env) so the Cloudflare
 * Workers runtime can supply them as encrypted secrets.
 */
async function facilitatorPost(endpoint: string, body: unknown, env: Env): Promise<Response> {
  const useCdp = Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);

  if (useCdp) {
    // JWT expires in ~120 s — generate fresh per-request.
    const authHeader = await createAuthHeader(
      env.CDP_API_KEY_ID!,
      env.CDP_API_KEY_SECRET!,
      'POST',
      CDP_FACILITATOR_HOST,
      `${CDP_FACILITATOR_PATH}/${endpoint}`,
    );
    return fetch(`${CDP_FACILITATOR}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'Correlation-Context': createCorrelationHeader(),
      },
      body: JSON.stringify(body),
    });
  }

  // Public facilitator fallback (rate-limited, unsuitable for high-value tiers).
  return fetch(`${PUBLIC_FACILITATOR}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Tier handler ──────────────────────────────────────────────────────────────

async function handleTier(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  tier: TierConfig,
): Promise<Response> {
  const amount = tier.getAmount(env);
  const asset = env.USDC_ADDRESS || USDC_BASE;
  const payTo = env.VAULT_ADDRESS;

  const paymentRequired = buildPaymentRequired(request.url, amount, payTo, asset, tier.description);
  const paymentRequirements = paymentRequired.accepts[0];

  // Clients may use PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1 legacy)
  const sigHeader = request.headers.get('PAYMENT-SIGNATURE') ?? request.headers.get('X-PAYMENT');

  if (!sigHeader) {
    return payment402(paymentRequired);
  }

  // Decode payment payload
  let paymentPayload: unknown;
  try {
    paymentPayload = decodePaymentSignatureHeader(sigHeader);
  } catch {
    return Response.json({ error: 'Invalid payment signature' }, { status: 400 });
  }

  // Verify with facilitator
  let verifyResult: { isValid: boolean; invalidReason?: string; payer?: string };
  try {
    const verifyResp = await facilitatorPost('verify', {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    }, env);

    if (!verifyResp.ok) {
      const txt = await verifyResp.text();
      return payment402(paymentRequired, `Facilitator error: ${txt}`);
    }
    verifyResult = (await verifyResp.json()) as typeof verifyResult;
  } catch (e) {
    return Response.json({ error: 'Verification request failed', detail: String(e) }, { status: 502 });
  }

  if (!verifyResult.isValid) {
    return payment402(paymentRequired, verifyResult.invalidReason ?? 'Payment invalid');
  }

  // Read body (best-effort). Safe to read before settlement — it is only echoed
  // back in the response and never drives payment or fulfillment decisions.
  const body = await request.json().catch(() => ({}));

  // Settle the payment and CONFIRM success BEFORE releasing anything of value.
  // This previously ran fire-and-forget in ctx.waitUntil(...).catch(console.error),
  // so the 200 response — including the Shopify fulfillment_url on the $4,999 /
  // $9,999 tiers — was returned before settlement was confirmed, and any settle
  // failure was swallowed. That handed over the goods for a verified-but-unsettled
  // payment. Settlement is now awaited and gates the response: no settle success,
  // no result.
  let settleResult: { success?: boolean; errorReason?: string; transaction?: string; network?: string };
  try {
    const settleResp = await facilitatorPost('settle', {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    }, env);

    if (!settleResp.ok) {
      const txt = await settleResp.text();
      console.error(`[settle] facilitator HTTP ${settleResp.status}: ${txt}`);
      return payment402(paymentRequired, `Settlement failed: ${txt}`);
    }
    settleResult = (await settleResp.json()) as typeof settleResult;
  } catch (e) {
    console.error(`[settle] request failed: ${String(e)}`);
    return Response.json({ error: 'Settlement request failed', detail: String(e) }, { status: 502 });
  }

  if (!settleResult.success) {
    console.error(`[settle] not settled: ${settleResult.errorReason ?? 'unknown reason'}`);
    return payment402(paymentRequired, settleResult.errorReason ?? 'Settlement not completed');
  }

  // Payment is now verified AND settled on-chain — safe to release the result.
  const result = tier.shopifyUrl
    ? {
        success: true,
        tier: tier.path.replace('/api/', ''),
        fulfillment_url: tier.shopifyUrl(env),
        payer: verifyResult.payer,
        charged_usd6: amount,
        settlement_tx: settleResult.transaction ?? null,
      }
    : {
        success: true,
        tier: tier.path.replace('/api/', ''),
        result: tier.description,
        input: body,
        payer: verifyResult.payer,
        charged_usd6: amount,
        settlement_tx: settleResult.transaction ?? null,
      };

  return Response.json(result);
}

// ── Static content builders ───────────────────────────────────────────────────

function activeFacilitatorUrl(env: Env): string {
  return (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) ? CDP_FACILITATOR : PUBLIC_FACILITATOR;
}

function buildX402Discovery(env: Env, hostname: string) {
  return {
    version: '2.0',
    endpoints: TIERS.map((t) => ({
      path: t.path,
      method: 'POST',
      price: { amount: t.getAmount(env), currency: 'USDC', decimals: 6 },
      displayPrice: t.displayPrice,
      description: t.description,
      network: NETWORK,
      payTo: env.VAULT_ADDRESS,
      ...(t.shopifyUrl ? { shopify_url: t.shopifyUrl(env) } : {}),
    })),
    payTo: env.VAULT_ADDRESS,
    asset: env.USDC_ADDRESS || USDC_BASE,
    network: NETWORK,
    facilitator: activeFacilitatorUrl(env),
    discovery: {
      x402: `https://${hostname}/.well-known/x402`,
      openapi: `https://${hostname}/openapi.json`,
      llms: `https://${hostname}/llms.txt`,
    },
  };
}

function buildOpenAPI(hostname: string) {
  const tierPaths: Record<string, unknown> = {};
  for (const t of TIERS) {
    tierPaths[t.path] = {
      post: {
        summary: `${t.description} (${t.displayPrice})`,
        operationId: `tier_${t.path.replace('/api/', '').replace('-', '_')}`,
        requestBody: {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '200': { description: 'Success' },
          '402': { description: 'Payment Required — include PAYMENT-SIGNATURE header' },
        },
      },
    };
  }
  return {
    openapi: '3.0.0',
    info: {
      title: 'Genesis Conductor x402 Tiered Service',
      version: '2.0.0',
      description: 'Six-tier x402 paid API on Base. Pay USDC per request — no accounts needed.',
    },
    servers: [{ url: `https://${hostname}` }],
    paths: {
      ...tierPaths,
      '/.well-known/x402': {
        get: { summary: 'x402 payment discovery', responses: { '200': { description: 'Payment info' } } },
      },
    },
  };
}

function buildLlmsTxt(hostname: string) {
  const tierDocs = TIERS.map(
    (t) => `### POST ${t.path}\n${t.description} (${t.displayPrice} USDC)\n`,
  ).join('\n');

  return `# Genesis Conductor x402 Tiered Service

> Paid API using the x402 protocol on Base. Six tiers from $0.01 to $9,999.

## Overview
- **Network**: Base mainnet (eip155:8453)
- **Payment token**: USDC
- **Facilitator**: Coinbase CDP facilitator (${CDP_FACILITATOR}) — production-grade settlement via Coinbase Developer Platform, handles high-value tiers ($4,999 / $9,999). Falls back to the public x402.org facilitator when CDP keys are absent.

## Payment Flow
1. Call any \`POST /api/*\` endpoint without a payment header
2. Receive \`402\` with \`PAYMENT-REQUIRED\` header (base64-JSON payment requirements)
3. Sign a USDC transfer for the advertised amount to the advertised wallet
4. Retry with \`PAYMENT-SIGNATURE: <base64 payload>\` header

## Endpoints

${tierDocs}
## Discovery
- x402 spec: https://${hostname}/.well-known/x402
- OpenAPI: https://${hostname}/openapi.json
- Facilitator health: https://${hostname}/health/facilitator
`;
}

// ── Gas monitor ───────────────────────────────────────────────────────────────

const GAS_LOW_THRESHOLD_WEI = BigInt('2000000000000000');  // 0.002 ETH
const BASE_RPC_FALLBACKS = [
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
  'https://mainnet.base.org',
];

async function getEthBalance(address: string, primaryRpc: string): Promise<bigint> {
  const rpcs = [primaryRpc, ...BASE_RPC_FALLBACKS.filter((r) => r !== primaryRpc)];
  let lastErr: Error | null = null;
  for (const rpc of rpcs) {
    try {
      const resp = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      });
      const json = (await resp.json()) as { result?: string; error?: { message: string } };
      if (!json.result) throw new Error(json.error?.message ?? 'no result');
      return BigInt(json.result);
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error('All RPCs failed');
}

async function checkGasAndAlert(env: Env): Promise<{ vault: string; main: string | null; low: boolean }> {
  const rpc = env.BASE_RPC_URL || BASE_RPC_FALLBACKS[0];
  const vaultBal = await getEthBalance(env.VAULT_ADDRESS, rpc);
  const mainBal = env.MAIN_WALLET ? await getEthBalance(env.MAIN_WALLET, rpc) : null;

  const low = vaultBal < GAS_LOW_THRESHOLD_WEI || (mainBal !== null && mainBal < GAS_LOW_THRESHOLD_WEI);

  const fmt = (w: bigint) => `${(Number(w) / 1e18).toFixed(6)} ETH`;
  const result = { vault: fmt(vaultBal), main: mainBal !== null ? fmt(mainBal) : null, low };

  if (low && env.GAS_ALERT_WEBHOOK) {
    await fetch(env.GAS_ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert: 'gas_low', ...result, threshold: fmt(GAS_LOW_THRESHOLD_WEI) }),
    }).catch(() => {});
  }

  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const hostname = url.hostname;

    // Static / discovery routes
    if (pathname === '/' && request.method === 'GET') {
      const tierRows = TIERS.map(
        (t) => `<tr><td><code>${t.path}</code></td><td>${t.displayPrice}</td><td>${t.description}</td></tr>`,
      ).join('');
      const html = `<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Genesis Conductor x402 — Tiered Paid API</title>
  <meta name="description" content="Six-tier x402 paid service on Base. Pay USDC per request.">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebAPI","name":"Genesis Conductor x402 Tiered Service","url":"https://${hostname}"}</script>
</head><body>
  <h1>Genesis Conductor x402 Tiered Service</h1>
  <p>Six tiers of paid API access — pay USDC on Base, no accounts needed.</p>
  <table border="1" cellpadding="4"><thead><tr><th>Endpoint</th><th>Price</th><th>Description</th></tr></thead>
  <tbody>${tierRows}</tbody></table>
  <p>See <a href="/llms.txt">/llms.txt</a> or <a href="/.well-known/x402">/.well-known/x402</a> for payment details.</p>
</body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (pathname === '/health') {
      return Response.json({ status: 'ok', tiers: TIERS.length, vault: env.VAULT_ADDRESS });
    }

    if (pathname === '/health/gas') {
      try {
        const gas = await checkGasAndAlert(env);
        return Response.json(gas, { status: gas.low ? 503 : 200 });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502 });
      }
    }

    if (pathname === '/health/facilitator') {
      const mode = (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) ? 'cdp' : 'public';
      const facilitatorUrl = mode === 'cdp' ? CDP_FACILITATOR : PUBLIC_FACILITATOR;
      // Lightweight ping — call the /supported endpoint (GET, no auth required for public info)
      let ok = false;
      let pingError: string | undefined;
      try {
        const pingResp = await fetch(`${facilitatorUrl}/supported`, { method: 'GET' });
        ok = pingResp.ok;
        if (!ok) {
          pingError = `HTTP ${pingResp.status}`;
        }
      } catch (e) {
        pingError = String(e);
      }
      return Response.json({ mode, facilitator: facilitatorUrl, ok, ...(pingError ? { error: pingError } : {}) }, {
        status: ok ? 200 : 502,
      });
    }

    if (pathname === '/.well-known/x402') {
      return Response.json(buildX402Discovery(env, hostname), {
        headers: { 'Cache-Control': 'public, max-age=300' },
      });
    }

    if (pathname === '/openapi.json') {
      return Response.json(buildOpenAPI(hostname), {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (pathname === '/llms.txt') {
      return new Response(buildLlmsTxt(hostname), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    if (pathname === '/metadata.json') {
      return Response.json({
        '@context': 'https://schema.org',
        '@type': 'WebAPI',
        name: 'Genesis Conductor x402 Tiered Service',
        description: 'Six-tier x402 paid API on Base.',
        url: `https://${hostname}`,
        documentation: `https://${hostname}/llms.txt`,
      }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    }

    if (pathname === '/.well-known/ai-plugin.json') {
      return Response.json({
        schema_version: 'v1',
        name_for_human: 'Genesis Conductor x402',
        name_for_model: 'genesis_conductor_x402',
        description_for_human: 'Six-tier paid API using USDC micropayments on Base',
        description_for_model: 'Six tiers of paid API access ($0.01–$9,999). Call /.well-known/x402 first, then retry with PAYMENT-SIGNATURE header.',
        auth: { type: 'none' },
        api: { type: 'openapi', url: `https://${hostname}/openapi.json` },
        contact_email: 'api@genesisconductor.io',
      }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    }

    if (pathname === '/.well-known/security.txt') {
      return new Response(`Contact: security@genesisconductor.io\nExpires: 2027-06-01T00:00:00.000Z\nPreferred-Languages: en\n`, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    if (pathname === '/robots.txt') {
      return new Response(`User-agent: *\nAllow: /\nSitemap: https://${hostname}/sitemap.xml\n`, {
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    if (pathname === '/sitemap.xml') {
      const base = `https://${hostname}`;
      const urls = ['/', '/health', '/.well-known/x402', '/openapi.json', '/llms.txt']
        .map((p) => `  <url><loc>${base}${p}</loc></url>`)
        .join('\n');
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
        { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' } },
      );
    }

    // Paid tier routes
    const tier = TIERS.find((t) => t.path === pathname);
    if (tier) {
      if (request.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
      }
      return handleTier(request, env, ctx, tier);
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      checkGasAndAlert(env).then((gas) => {
        console.log('[cron/gas-check]', JSON.stringify(gas));
      }).catch((e) => {
        console.error('[cron/gas-check] error:', e);
      }),
    );
  },
};
