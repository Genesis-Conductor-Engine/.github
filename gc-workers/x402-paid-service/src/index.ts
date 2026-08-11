import { encodePaymentRequiredHeader, decodePaymentSignatureHeader } from '@x402/core/http';
import { createCorrelationHeader } from '@coinbase/x402';
import { declareDiscoveryExtension } from '@x402/extensions';
import nacl from 'tweetnacl';
import type {
  ExecutionContext,
  ScheduledEvent,
  KVNamespace,
  AnalyticsEngineDataset,
} from './runtime-types';

// ── Constants ─────────────────────────────────────────────────────────────────

// ── Custom JWT Generation for Cloudflare Workers ────────────────────────────

function base64urlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...Array.from(buffer)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function createCdpAuthHeader(
  apiKeyId: string,
  apiKeySecret: string,
  requestMethod: string,
  requestHost: string,
  requestPath: string,
): Promise<string> {
  const fullKeyB64 = apiKeySecret.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = fullKeyB64.padEnd(Math.ceil(fullKeyB64.length / 4) * 4, '=');
  let fullKeyBytes: Uint8Array;
  try {
    fullKeyBytes = new Uint8Array(atob(padded).split('').map(c => c.charCodeAt(0)));
  } catch (e) {
    throw new Error(`Failed to decode key: ${e}`);
  }
  if (fullKeyBytes.length !== 64) {
    throw new Error(`Invalid Ed25519 key length: ${fullKeyBytes.length} (expected 64)`);
  }
  const seed = fullKeyBytes.slice(0, 32);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const header = { alg: 'EdDSA', typ: 'JWT', kid: apiKeyId, nonce: generateNonce() };
  const now = Math.floor(Date.now() / 1000);
  const uri = `${requestMethod} ${requestHost}${requestPath}`;
  const payload = { sub: apiKeyId, iss: 'cdp', aud: ['cdp_service'], nbf: now, exp: now + 120, uri };
  const encodedHeader = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const message = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = nacl.sign.detached(message, keyPair.secretKey);
  const encodedSignature = base64urlEncode(signature);
  return `Bearer ${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}
const X402_VERSION = 2;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'eip155:8453';
const NETWORK_POLYGON = 'eip155:137';
const MAX_TIMEOUT_SECONDS = 60;
const PUBLIC_FACILITATOR = 'https://x402.org/facilitator';
const CDP_FACILITATOR = 'https://api.cdp.coinbase.com/platform/v2/x402';
const CDP_FACILITATOR_HOST = 'api.cdp.coinbase.com';
const CDP_FACILITATOR_PATH = '/platform/v2/x402';
const ETH_SETTLEMENT_ENABLED: boolean = true;

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
  // ETH pricing tiers (wei)
  TIER_DISCOVERY_ETH_WEI: string;
  TIER_PRO_ETH_WEI: string;
  TIER_INFERENCE_ETH_WEI: string;
  TIER_SPECIALIZED_ETH_WEI: string;
  TIER_FOUNDERS_ETH_WEI: string;
  TIER_SOURCE_EXCLUSIVE_ETH_WEI: string;
  // Solana config
  SOLANA_USDC_MINT: string;
  SOLANA_RPC_URL: string;
  SOLANA_NETWORK: string;
  SHOPIFY_FOUNDERS_URL: string;
  SHOPIFY_SOURCE_EXCLUSIVE_URL: string;
  SHOPIFY_STORE_DOMAIN: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  // Gas monitoring + Alchemy (Base RPC secret; optional key for Solana RPC)
  ALCHEMY_BASE_RPC_URL?: string;
  BASE_RPC_URL?: string;
  ALCHEMY_API_KEY?: string;
  MAIN_WALLET?: string;
  GAS_ALERT_WEBHOOK?: string;
}

/** Prefer configured Solana RPC; fall back to Alchemy Solana if key present. */
function resolveSolanaRpcUrl(env: Env): string {
  if (env.SOLANA_RPC_URL && !env.SOLANA_RPC_URL.includes('api.mainnet-beta.solana.com')) {
    return env.SOLANA_RPC_URL;
  }
  if (env.ALCHEMY_API_KEY) {
    return `https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
  }
  return env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

// ── Tier configuration ────────────────────────────────────────────────────────
interface TierConfig {
  path: string;
  getAmount: (env: Env) => string;
  getEthAmount: (env: Env) => string;
  description: string;
  displayPrice: string;
  asset: string;
  ethAsset: string;
  shopifyUrl?: (env: Env) => string;
}

const ETH_PRICING_ENABLED = (_env: Env): boolean => ETH_SETTLEMENT_ENABLED;

const TIERS: TierConfig[] = [
  {
    path: '/api/execute',
    getAmount: (e) => e.TIER_DISCOVERY_USD6,
    getEthAmount: (e) => e.TIER_DISCOVERY_ETH_WEI,
    description:
      'x402 settlement smoke test — cheapest end-to-end paid call on Base. Verify your wallet, facilitator, and EIP-3009 USDC settlement for one cent before spending more. Returns payer address and confirmation. Keywords: x402 test, payment verification, cheapest api, micropayment, agent onboarding, penny call.',
    displayPrice: '$0.01',
    asset: USDC_BASE,
    ethAsset: 'native',
  },
  {
    path: '/api/pro',
    getAmount: (e) => e.TIER_PRO_USD6,
    getEthAmount: (e) => e.TIER_PRO_ETH_WEI,
    description:
      'Pro metered API access — authenticated agent-to-agent execution with per-call USDC billing on Base and Polygon. No account, no API key, no subscription. Keywords: paid api, metered access, pay per request, agent api, premium endpoint, usdc billing.',
    displayPrice: '$1.00',
    asset: USDC_BASE,
    ethAsset: 'native',
  },
  {
    path: '/api/inference',
    getAmount: (e) => e.TIER_INFERENCE_USD6,
    getEthAmount: (e) => e.TIER_INFERENCE_ETH_WEI,
    description:
      'AI inference execution billed per call in USDC — run model workloads without an inference-provider account or key. Settles on Base via EIP-3009. Keywords: ai inference, llm api, model execution, gpu compute, pay per inference, agent inference, no api key.',
    displayPrice: '$10.00',
    asset: USDC_BASE,
    ethAsset: 'native',
  },
  {
    path: '/api/specialized',
    getAmount: (e) => e.TIER_SPECIALIZED_USD6,
    getEthAmount: (e) => e.TIER_SPECIALIZED_ETH_WEI,
    description:
      'Specialized dataset and enrichment access billed per query in USDC — high-value structured data for agents, no subscription or contract. Keywords: data api, dataset access, enrichment, structured data, market data, research data, pay per query.',
    displayPrice: '$100.00',
    asset: USDC_BASE,
    ethAsset: 'native',
  },
  {
    path: '/api/founders',
    getAmount: (e) => e.TIER_FOUNDERS_USD6,
    getEthAmount: (e) => e.TIER_FOUNDERS_ETH_WEI,
    description:
      'Genesis Conductor Founders License — full commercial license purchasable entirely agent-to-agent, settled in USDC on Base with no sales call or contract negotiation. Includes fulfillment. Keywords: software license, commercial license, founders tier, agent checkout, autonomous purchase, b2b licensing.',
    displayPrice: '$4,999',
    asset: USDC_BASE,
    ethAsset: 'native',
    shopifyUrl: (e) => e.SHOPIFY_FOUNDERS_URL,
  },
  {
    path: '/api/source-exclusive',
    getAmount: (e) => e.TIER_SOURCE_EXCLUSIVE_USD6,
    getEthAmount: (e) => e.TIER_SOURCE_EXCLUSIVE_ETH_WEI,
    description:
      'Genesis Conductor Source Exclusive — exclusive source rights to one plugin, sold once, settled agent-to-agent in USDC on Base. Highest tier, includes transfer and fulfillment. Keywords: exclusive rights, source code license, exclusivity, buyout, agent commerce, high value checkout.',
    displayPrice: '$9,999',
    asset: USDC_BASE,
    ethAsset: 'native',
    shopifyUrl: (e) => e.SHOPIFY_SOURCE_EXCLUSIVE_URL,
  },
];

// ── Solana USDC helpers ─────────────────────────────────────────────────────

const SOLANA_USDC_MINT_DEFAULT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function verifySolanaUsdcTransfer(
  signature: string,
  expectedAmount: string,
  expectedRecipient: string,
  env: Env,
): Promise<{ isValid: boolean; payer?: string; error?: string }> {
  const rpcUrl = resolveSolanaRpcUrl(env);
  const usdcMint = env.SOLANA_USDC_MINT || SOLANA_USDC_MINT_DEFAULT;

  try {
    // Fetch transaction details
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
        ],
      }),
    });

    const json = (await resp.json()) as {
      result?: {
        transaction?: {
          message?: {
            accountKeys?: Array<{ pubkey: string; signer?: boolean }>;
            instructions?: Array<{
              parsed?: {
                type?: string;
                info?: {
                  source?: string;
                  destination?: string;
                  amount?: string;
                  mint?: string;
                  authority?: string;
                };
              };
            }>;
          };
        };
        meta?: { err?: unknown };
      };
      error?: { message: string };
    };

    if (!json.result?.transaction) {
      return { isValid: false, error: 'Transaction not found' };
    }

    if (json.result.meta?.err) {
      return { isValid: false, error: 'Transaction failed on-chain' };
    }

    const instructions = json.result.transaction.message?.instructions || [];
    const accountKeys = json.result.transaction.message?.accountKeys || [];

    // Find USDC transfer instruction
    for (const ix of instructions) {
      if (ix.parsed?.type === 'transfer' && ix.parsed?.info) {
        const info = ix.parsed.info;
        if (info.mint === usdcMint && info.destination === expectedRecipient) {
          // Verify amount (USDC has 6 decimals)
          const amountMicroUsdc = BigInt(info.amount || '0');
          const expectedMicroUsdc = BigInt(expectedAmount);
          if (amountMicroUsdc >= expectedMicroUsdc) {
            const payer = info.source || accountKeys.find((k) => k.signer)?.pubkey || 'unknown';
            return { isValid: true, payer };
          }
          return { isValid: false, error: `Amount mismatch: got ${info.amount}, expected ${expectedAmount}` };
        }
      }
    }

    return { isValid: false, error: 'No matching USDC transfer found in transaction' };
  } catch (e) {
    return { isValid: false, error: `Solana RPC error: ${String(e)}` };
  }
}

// ── x402 helpers ──────────────────────────────────────────────────────────────

function buildPaymentRequired(requestUrl: string, amount: string, payTo: string, asset: string, description: string, ethAmount?: string) {
  // Bazaar discovery (v2 extensions field, official SDK)
  // `description` reaches the Bazaar listing. Without it the service renders
  // as a bare URL with no price or purpose, which is indistinguishable from a
  // dead endpoint to any agent browsing for a capability.
  const discovery = declareDiscoveryExtension({
    description,
    bodyType: 'json',
    input: {},
    inputSchema: { type: 'object', additionalProperties: true },
    output: {
      example: {
        success: true,
        payer: '0x0000000000000000000000000000000000dEaD',
        payment_asset: 'USDC',
      },
    },
  });

  const primaryAccept = {
    scheme: 'exact' as const,
    network: NETWORK,
    asset,
    amount,
    payTo,
    description,
    mimeType: 'application/json',
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: {
      name: 'USD Coin',
      version: '2',
    },
    outputSchema: {
      input: {
        type: 'http' as const,
        method: 'POST' as const,
        discoverable: true,
        description,
        body: { type: 'object' as const, additionalProperties: true },
      },
    },
  };

  const accepts: Array<typeof primaryAccept> = [primaryAccept];

  // Add Polygon USDC acceptance
  accepts.push({
    scheme: 'exact' as const,
    network: NETWORK_POLYGON,
    asset,
    amount,
    payTo,
    description,
    mimeType: 'application/json',
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: {
      name: 'USD Coin',
      version: '2',
    },
    outputSchema: {
      input: {
        type: 'http' as const,
        method: 'POST' as const,
        discoverable: true,
        description,
        body: { type: 'object' as const, additionalProperties: true },
      },
    },
  });

  // Add ETH acceptance if enabled and amount provided
  if (ETH_SETTLEMENT_ENABLED && ethAmount) {
    accepts.push({
      scheme: 'exact' as const,
      network: NETWORK,
      asset: 'native',
      amount: ethAmount,
      payTo,
      description,
      mimeType: 'application/json',
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      extra: {
        name: 'Ether',
        version: '1',
      },
      outputSchema: {
        input: {
          type: 'http' as const,
          method: 'POST' as const,
          discoverable: true,
          description,
          body: { type: 'object' as const, additionalProperties: true },
        },
      },
    });
  }

  return {
    x402Version: X402_VERSION,
    accepts,
    resource: {
      url: requestUrl,
      description,
      mimeType: 'application/json',
    },
    extensions: discovery,
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
 */
async function facilitatorPost(endpoint: string, body: unknown, env: Env): Promise<Response> {
  const useCdp = Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);

  if (useCdp) {
    const authHeader = await createCdpAuthHeader(
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
  const primaryAmount = tier.getAmount(env);
  const primaryAsset = tier.asset || env.USDC_ADDRESS || USDC_BASE;
  const ethAmount = tier.getEthAmount(env);
  const payTo = env.VAULT_ADDRESS;
  const requestedPaymentAsset = request.headers.get('X-PAYMENT-ASSET')?.trim().toUpperCase();
  const ethPricingEnabled = ETH_PRICING_ENABLED(env);
  const requestedEth = requestedPaymentAsset === 'ETH' || requestedPaymentAsset === 'WETH';
  
  if (requestedEth && !ethPricingEnabled) {
    return Response.json(
      { error: `Payment asset ${requestedPaymentAsset} is disabled; USDC is required` },
      { status: 400 },
    );
  }
  if (requestedPaymentAsset && requestedPaymentAsset !== 'USDC' && !requestedEth) {
    return Response.json({ error: `Unsupported payment asset: ${requestedPaymentAsset}` }, { status: 400 });
  }
  
  // Use ETH amount if requested and enabled
  const amount = requestedEth ? ethAmount : primaryAmount;
  const asset = requestedEth ? 'native' : primaryAsset;

  const paymentRequired = buildPaymentRequired(request.url, amount, payTo, asset, tier.description, ethAmount);
  const paymentRequirements = paymentRequired.accepts[0];

  const sigHeader = request.headers.get('PAYMENT-SIGNATURE') ?? request.headers.get('X-PAYMENT');

  if (!sigHeader) {
    return payment402(paymentRequired);
  }

  let paymentPayload: unknown;
  try {
    paymentPayload = decodePaymentSignatureHeader(sigHeader);
  } catch {
    return Response.json({ error: 'Invalid payment signature' }, { status: 400 });
  }

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

  const body = await request.json().catch(() => ({}));

  const result = tier.shopifyUrl
    ? {
        success: true,
        tier: tier.path.replace('/api/', ''),
        fulfillment_url: tier.shopifyUrl(env),
        payer: verifyResult.payer,
        charged_usd6: requestedEth ? '0' : amount,
        charged_eth_wei: requestedEth ? amount : '0',
        payment_asset: requestedEth ? 'ETH' : 'USDC',
      }
    : {
        success: true,
        tier: tier.path.replace('/api/', ''),
        result: tier.description,
        input: body,
        payer: verifyResult.payer,
        charged_usd6: requestedEth ? '0' : amount,
        charged_eth_wei: requestedEth ? amount : '0',
        payment_asset: requestedEth ? 'ETH' : 'USDC',
      };

  const payerAddress = verifyResult.payer ?? 'unknown';

  // Settle BEFORE releasing the result. Previously settlement ran fire-and-forget
  // in ctx.waitUntil(...), so the 200 (including the Shopify fulfillment_url on the
  // $4,999 / $9,999 tiers) was returned before settlement was confirmed and any
  // failure was swallowed. Settlement is now awaited and gates the response: no
  // settle success, no result. See settle-gate.test.ts.
  let settleResult: { success?: boolean; errorReason?: string; transaction?: string };
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

  // Confirmed settled — record analytics (best-effort) and release the result.
  try {
    env.ANALYTICS?.writeDataPoint({
      blobs: [payerAddress, tier.path, tier.description],
      doubles: [Number(amount) / (requestedEth ? 1e18 : 1_000_000)],
      indexes: [payerAddress],
    });
  } catch (e) {
    console.error('[analytics] failed:', e);
  }

  return Response.json({ ...result, payer: payerAddress, settlement_tx: settleResult.transaction ?? null });
}

// ── Discovery builders ─────────────────────────────────────────────────────

function buildX402Discovery(env: Env, hostname: string) {
  const tiers = TIERS.map((t) => {
    const primaryAmount = t.getAmount(env);
    const ethAmount = t.getEthAmount(env);

    return {
      path: t.path,
      method: 'POST',
      price: { amount: primaryAmount, currency: 'USDC', decimals: 6 },
      ethPrice: ETH_SETTLEMENT_ENABLED ? { amount: ethAmount, currency: 'ETH', decimals: 18 } : undefined,
      displayPrice: t.displayPrice,
      description: t.description,
      network: NETWORK,
      payTo: env.VAULT_ADDRESS,
      ...(t.shopifyUrl ? { shopify_url: t.shopifyUrl(env) } : {}),
    };
  });

  return {
    version: '2.0',
    endpoints: tiers,
    payTo: env.VAULT_ADDRESS,
    asset: env.USDC_ADDRESS || USDC_BASE,
    network: NETWORK,
    ethEnabled: ETH_SETTLEMENT_ENABLED,
    solanaEnabled: true,
    solanaNetwork: env.SOLANA_NETWORK || 'mainnet-beta',
    solanaUsdcMint: env.SOLANA_USDC_MINT || SOLANA_USDC_MINT_DEFAULT,
    shopify: {
      store: env.SHOPIFY_STORE_DOMAIN || 'shop.genesisconductor.io',
      founders: env.SHOPIFY_FOUNDERS_URL,
      sourceExclusive: env.SHOPIFY_SOURCE_EXCLUSIVE_URL,
    },
    alchemy: {
      baseRpcConfigured: Boolean(env.ALCHEMY_BASE_RPC_URL),
      solanaRpc: resolveSolanaRpcUrl(env).includes('alchemy.com') ? 'alchemy' : 'public-or-custom',
    },
    facilitator: (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) ? CDP_FACILITATOR : PUBLIC_FACILITATOR,
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
        parameters: [
          {
            name: 'X-PAYMENT-SIGNATURE',
            in: 'header',
            description: 'Base64-encoded x402 payment signature (USDC or ETH on Base/Polygon)',
            schema: { type: 'string' },
          },
          {
            name: 'X-SOLANA-SIGNATURE',
            in: 'header',
            description: 'Solana transaction signature for USDC payment',
            schema: { type: 'string' },
          },
          {
            name: 'X-PAYMENT-ASSET',
            in: 'header',
            description: 'Preferred payment asset: USDC, ETH, or WETH',
            schema: { type: 'string', enum: ['USDC', 'ETH', 'WETH'] },
          },
        ],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '200': { description: 'Success' },
          '402': { description: 'Payment Required' },
        },
      },
    };
  }
  return {
    openapi: '3.0.0',
    info: {
      title: 'Genesis Conductor x402 Tiered Service',
      version: '2.1.0',
      description: 'Six-tier x402 paid API on Base. Supports USDC, ETH, and Solana USDC payments.',
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
    (t) => `### POST ${t.path}\n${t.description} (${t.displayPrice})\n`,
  ).join('\n');

  return `# Genesis Conductor x402 Tiered Service

> Paid API using the x402 protocol on Base + Polygon. Six tiers from $0.01 to $9,999.

## Overview
- **Networks**: Base mainnet (eip155:8453), Polygon mainnet (eip155:137)
- **Payment tokens**: USDC, ETH (native)
- **Facilitator**: Coinbase CDP facilitator (${CDP_FACILITATOR}) — production-grade settlement via Coinbase Developer Platform, handles high-value tiers ($4,999 / $9,999). Falls back to the public x402.org facilitator when CDP keys are absent.

## Payment Flow
1. Call any \`POST /api/*\` endpoint without a payment header
2. Receive \`402\` with \`PAYMENT-REQUIRED\` header (base64-JSON payment requirements)
3. Sign a USDC or ETH transfer for the advertised amount to the advertised wallet
4. Retry with \`PAYMENT-SIGNATURE: <base64 payload>\` header

## Supported Assets
- **USDC**: 6-decimal stablecoin on Base/Polygon
- **ETH**: Native ether on Base (18-decimal wei)

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
function isAllowedAlchemyRpcUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (
      url.hostname === 'x402.alchemy.com' ||
      url.hostname.endsWith('.g.alchemy.com')
    );
  } catch {
    return false;
  }
}

function resolveBaseRpcUrl(env: Env): string {
  const rpcUrl = env.ALCHEMY_BASE_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error('ALCHEMY_BASE_RPC_URL is required for gas monitoring');
  }
  if (!isAllowedAlchemyRpcUrl(rpcUrl)) {
    throw new Error('ALCHEMY_BASE_RPC_URL must be an HTTPS Alchemy RPC URL');
  }
  return rpcUrl;
}

async function getEthBalance(address: string, primaryRpc: string): Promise<bigint> {
  const resp = await fetch(primaryRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
  });
  const json = (await resp.json()) as { result?: string; error?: { message: string } };
  if (!json.result) {
    throw new Error(json.error?.message ?? 'no result');
  }
  return BigInt(json.result);
}

async function readWalletBalances(rpc: string, env: Env): Promise<{ vault: bigint; main: bigint | null }> {
  const vault = await getEthBalance(env.VAULT_ADDRESS, rpc);
  const main = env.MAIN_WALLET ? await getEthBalance(env.MAIN_WALLET, rpc) : null;
  return { vault, main };
}

async function checkGasAndAlert(env: Env): Promise<{ vault: string; main: string | null; low: boolean }> {
  const primaryRpc = resolveBaseRpcUrl(env);
  const fallbackRpc = env.BASE_RPC_URL?.trim();

  let bals: { vault: bigint; main: bigint | null };
  try {
    bals = await readWalletBalances(primaryRpc, env);
  } catch (primaryErr) {
    if (!fallbackRpc) throw primaryErr;
    // Alchemy capacity/rate limit hit — degrade to public Base RPC.
    bals = await readWalletBalances(fallbackRpc, env);
  }

  const vaultBal = bals.vault;
  const mainBal = bals.main;

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
  <meta name="description" content="Six-tier x402 paid service on Base. Pay USDC, ETH, or Solana USDC.">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebAPI","name":"Genesis Conductor x402 Tiered Service","url":"https://${hostname}"}</script>
</head><body>
  <h1>Genesis Conductor x402 Tiered Service</h1>
  <p>Six tiers of paid API access — pay <strong>USDC</strong> or <strong>ETH</strong> on Base, or <strong>USDC</strong> on Solana.</p>
  <table border="1" cellpadding="4"><thead><tr><th>Endpoint</th><th>Price</th><th>Description</th></tr></thead>
  <tbody>${tierRows}</tbody></table>
  <p>See <a href="/llms.txt">/llms.txt</a> or <a href="/.well-known/x402">/.well-known/x402</a> for payment details.</p>
</body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (pathname === '/health') {
      return Response.json({
        status: 'ok',
        tiers: TIERS.length,
        vault: env.VAULT_ADDRESS,
        eth_pricing_enabled: ETH_PRICING_ENABLED(env),
        solana_enabled: true,
        solana_rpc: resolveSolanaRpcUrl(env).includes('alchemy.com') ? 'alchemy' : 'configured',
        shopify_store: env.SHOPIFY_STORE_DOMAIN || 'shop.genesisconductor.io',
        alchemy_base_rpc: Boolean(env.ALCHEMY_BASE_RPC_URL),
        facilitator: (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) ? 'cdp' : 'public',
        integrations: {
          shopify: true,
          alchemy: Boolean(env.ALCHEMY_BASE_RPC_URL || env.ALCHEMY_API_KEY),
          openclaw: true,
          cloudflare: true,
        },
      });
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
      let ok = false;
      let pingError: string | undefined;
      try {
        const pingOptions: RequestInit = { method: 'GET' };
        if (mode === 'cdp' && env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
          const authHeader = await createCdpAuthHeader(
            env.CDP_API_KEY_ID,
            env.CDP_API_KEY_SECRET,
            'GET',
            CDP_FACILITATOR_HOST,
            `${CDP_FACILITATOR_PATH}/supported`,
          );
          pingOptions.headers = { 'Authorization': authHeader, 'Correlation-Context': createCorrelationHeader() };
        }
        const pingResp = await fetch(`${facilitatorUrl}/supported`, pingOptions);
        ok = pingResp.ok;
        if (!ok) {
          pingError = `HTTP ${pingResp.status}`;
        }
      } catch (e) {
        pingError = String(e);
      }
      return Response.json({ mode, facilitator: facilitatorUrl, ok, ...(pingError ? { error: pingError } : {}), eth_pricing_enabled: ETH_PRICING_ENABLED(env) }, {
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
        description: 'Six-tier x402 paid API on Base. Supports USDC, ETH, and Solana USDC payments.',
        url: `https://${hostname}`,
        documentation: `https://${hostname}/llms.txt`,
      }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    }

    if (pathname === '/.well-known/ai-plugin.json') {
      return Response.json({
        schema_version: 'v1',
        name_for_human: 'Genesis Conductor x402',
        name_for_model: 'genesis_conductor_x402',
        description_for_human: 'Six-tier paid API using USDC, ETH, and Solana USDC micropayments on Base',
        description_for_model: 'Six tiers of paid API access ($0.01–$9,999). Supports USDC, ETH, and Solana USDC. Call /.well-known/x402 first, then retry with PAYMENT-SIGNATURE or X-SOLANA-SIGNATURE header.',
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
        const paymentRequired = buildPaymentRequired(request.url, tier.getAmount(env), env.VAULT_ADDRESS, tier.asset || env.USDC_ADDRESS || USDC_BASE, tier.description, tier.getEthAmount(env));
        return payment402(paymentRequired);
      }
      
      // Check for Solana payment
      const solanaSignature = request.headers.get('X-SOLANA-SIGNATURE');
      if (solanaSignature) {
        const solanaAmount = tier.getAmount(env);
        const result = await verifySolanaUsdcTransfer(solanaSignature, solanaAmount, env.VAULT_ADDRESS, env);
        
        if (!result.isValid) {
          return Response.json({ error: result.error || 'Solana payment verification failed' }, { status: 400 });
        }
        
        // Record Solana payment
        ctx.waitUntil(
          (async () => {
            try {
              env.ANALYTICS?.writeDataPoint({
                blobs: [result.payer || 'unknown', tier.path, tier.description],
                doubles: [Number(solanaAmount) / 1_000_000],
                indexes: [result.payer || 'unknown'],
              });
            } catch (e) {
              console.error('[solana-analytics] failed:', e);
            }
          })(),
        );
        
        const body = await request.json().catch(() => ({}));
        return Response.json({
          success: true,
          tier: tier.path.replace('/api/', ''),
          result: tier.description,
          input: body,
          payer: result.payer,
          charged_usd6: solanaAmount,
          charged_eth_wei: '0',
          payment_asset: 'USDC_SOLANA',
          solana_signature: solanaSignature,
        });
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
