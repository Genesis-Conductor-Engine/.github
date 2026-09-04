/**
 * ChainSafe Canton x402 merchant rail.
 * Spec: @chainsafe/x402-client FacilitatorClient — GET /v2/supported (public),
 * POST /v2/verify and /v2/settle (Bearer). Does not replace the CDP/EVM path.
 */

export const CHAINSAFE_FACILITATOR_DEFAULT = 'https://api-x402.chainsafe.io';
export const CHAINSAFE_ALLOWED_HOSTS = new Set(['api-x402.chainsafe.io']);
export const CANTON_SCHEME = 'exact-canton';
const CANTON_TTL_MS = 300_000;

export interface ChainSafeEnv {
  FACILITATOR_URL?: string;
  FACILITATOR_API_KEY?: string;
  NETWORK_ID?: string;
  MERCHANT_PARTY?: string;
  AMULET_ADMIN?: string;
  CHAINSAFE_FACILITATOR_URL?: string;
  CHAINSAFE_FACILITATOR_API_KEY?: string;
  CHAINSAFE_NETWORK_ID?: string;
  CHAINSAFE_MERCHANT_PARTY?: string;
  CHAINSAFE_AMULET_ADMIN?: string;
}

export interface ChainSafeConfig {
  url: string;
  apiKey: string;
  network: string;
  payTo: string;
  amuletAdmin: string;
}

export interface CantonAccept {
  scheme: typeof CANTON_SCHEME;
  network: string;
  maxAmountRequired: string;
  asset: { instrumentId: { id: 'Amulet'; admin: string } };
  payTo: string;
  resource: string;
  description?: string;
  nonce: string;
  validBefore: string;
  maxTimeoutSeconds: number;
}

export function isAllowedChainsafeFacilitatorUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && CHAINSAFE_ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function resolveChainSafeConfig(env: ChainSafeEnv): ChainSafeConfig | undefined {
  const url = (env.CHAINSAFE_FACILITATOR_URL || env.FACILITATOR_URL || CHAINSAFE_FACILITATOR_DEFAULT).trim();
  const apiKey = (env.CHAINSAFE_FACILITATOR_API_KEY || env.FACILITATOR_API_KEY || '').trim();
  const network = (env.CHAINSAFE_NETWORK_ID || env.NETWORK_ID || '').trim();
  const payTo = (env.CHAINSAFE_MERCHANT_PARTY || env.MERCHANT_PARTY || '').trim();
  const amuletAdmin = (env.CHAINSAFE_AMULET_ADMIN || env.AMULET_ADMIN || '').trim();
  if (!apiKey || !network || !payTo || !amuletAdmin) return undefined;
  if (!network.startsWith('canton:')) return undefined;
  if (!isAllowedChainsafeFacilitatorUrl(url)) return undefined;
  return { url: url.replace(/\/$/, ''), apiKey, network, payTo, amuletAdmin };
}

/** USDC 6-decimal minor units → decimal string used as Canton Coin sticker. */
export function usdc6ToDecimal(usdc6: string): string {
  const n = BigInt(usdc6);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac === 0n ? '' : `.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
  return `${neg ? '-' : ''}${whole.toString()}${fracStr}`;
}

export function isCantonNetwork(network: unknown): boolean {
  return typeof network === 'string' && network.startsWith('canton:');
}

export function isCantonRequirements(req: unknown): req is CantonAccept {
  if (!req || typeof req !== 'object') return false;
  const r = req as Record<string, unknown>;
  return r.scheme === CANTON_SCHEME || isCantonNetwork(r.network);
}

export function buildCantonAccept(
  cfg: ChainSafeConfig,
  usdc6: string,
  resource: string,
  description: string,
  nowMs = Date.now(),
  nonce = crypto.randomUUID(),
): CantonAccept {
  return {
    scheme: CANTON_SCHEME,
    network: cfg.network,
    maxAmountRequired: usdc6ToDecimal(usdc6),
    asset: { instrumentId: { id: 'Amulet', admin: cfg.amuletAdmin } },
    payTo: cfg.payTo,
    resource,
    description,
    nonce,
    validBefore: new Date(nowMs + CANTON_TTL_MS).toISOString(),
    maxTimeoutSeconds: 60,
  };
}

function assetAdmin(req: Record<string, unknown>): string | undefined {
  const asset = req.asset;
  if (!asset || typeof asset !== 'object') return undefined;
  const instrumentId = (asset as Record<string, unknown>).instrumentId;
  if (!instrumentId || typeof instrumentId !== 'object') return undefined;
  const admin = (instrumentId as Record<string, unknown>).admin;
  return typeof admin === 'string' ? admin : undefined;
}

function assetId(req: Record<string, unknown>): string | undefined {
  const asset = req.asset;
  if (!asset || typeof asset !== 'object') return undefined;
  const instrumentId = (asset as Record<string, unknown>).instrumentId;
  if (!instrumentId || typeof instrumentId !== 'object') return undefined;
  const id = (instrumentId as Record<string, unknown>).id;
  return typeof id === 'string' ? id : undefined;
}

/** Echoed client requirements must not underpay or retarget the merchant. */
export function cantonPolicyAllows(echoed: unknown, advertised: CantonAccept): boolean {
  if (!echoed || typeof echoed !== 'object') return false;
  const got = echoed as Record<string, unknown>;
  if (got.scheme !== advertised.scheme) return false;
  if (got.network !== advertised.network) return false;
  if (typeof got.payTo !== 'string' || got.payTo !== advertised.payTo) return false;
  if (assetId(got) !== 'Amulet' || assetAdmin(got) !== advertised.asset.instrumentId.admin) return false;
  const offered = typeof got.maxAmountRequired === 'string' ? got.maxAmountRequired : '';
  try {
    return Number(offered) >= Number(advertised.maxAmountRequired);
  } catch {
    return false;
  }
}

export interface CantonDecodedPayment {
  kind: 'canton';
  payload: unknown;
  requirements: unknown;
}

export function tryDecodeCantonPaymentHeader(headerValue: string): CantonDecodedPayment | undefined {
  let raw: string;
  try {
    raw = atob(headerValue);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const rec = parsed as Record<string, unknown>;
  if (!rec.payment || typeof rec.payment !== 'object') return undefined;
  if (!rec.requirements || typeof rec.requirements !== 'object') return undefined;
  if (!isCantonRequirements(rec.requirements)) return undefined;
  return { kind: 'canton', payload: rec.payment, requirements: rec.requirements };
}

export async function chainsafeFacilitatorPost(
  cfg: ChainSafeConfig,
  endpoint: 'verify' | 'settle',
  paymentPayload: unknown,
  paymentRequirements: unknown,
): Promise<Response> {
  const x402Version = (paymentPayload && typeof paymentPayload === 'object'
    && typeof (paymentPayload as Record<string, unknown>).x402Version === 'number')
    ? (paymentPayload as Record<string, unknown>).x402Version
    : 2;
  return fetch(`${cfg.url}/v2/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ x402Version, paymentPayload, paymentRequirements }),
  });
}

export async function chainsafeSupportedPing(cfg: Pick<ChainSafeConfig, 'url'>): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(`${cfg.url}/v2/supported`, { method: 'GET' });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
