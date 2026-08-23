/**
 * What a settled x402 payment actually buys.
 *
 * Before this module, `/api/pro` ($1) and `/api/specialized` ($100) returned
 * `tier.description` — the marketing blurb — as the paying agent's `result`.
 * An agent that pays $100 and receives its own advertisement back does not pay
 * twice, and the tiers are advertised in the public Bazaar discovery document.
 *
 * Every function here runs AFTER settlement is confirmed, so nothing in this
 * file may throw: the caller has already been charged, and an exception would
 * turn a paid request into a 500 with no refund path. Failures degrade into
 * structured, auditable output instead.
 */
import { runRtptpa, type RtptpaEvt } from './rtptpa';
import { ALCHEMY_ROLLUP_NETWORKS, alchemyHttps } from './alchemy/urls';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Base mainnet is where this service settles, so it is the enrichment default. */
const ENRICHMENT_NETWORK = 'base-mainnet';
const MAX_TRANSFERS = 10;

// ── Metering receipt ─────────────────────────────────────────────────────────

export interface MeteringReceipt {
  receipt_id: string;
  tier: string;
  units: number;
  unit_price_usd6: string;
  charged_usd6: string;
  charged_usd: string;
  /** ETH-settled calls carry their raw amount in the response envelope, not here. */
  payment_asset: string;
  payer: string;
  settlement_tx: string | null;
  issued_at: string;
}

export interface MeteringReceiptArgs {
  tier: string;
  amountUsd6: string;
  units: number;
  payer: string;
  settlementTx: string | null;
  asset?: string;
  now?: () => string;
  nonce?: () => string;
}

function defaultNonce(): string {
  try {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'nononce';
  }
}

function usd6ToDisplay(amountUsd6: string): string {
  const n = Number(amountUsd6);
  if (!Number.isFinite(n)) return '0.00';
  return (n / 1_000_000).toFixed(2);
}

/**
 * A receipt an agent can audit: what it was charged, for how many units, and
 * which on-chain transaction settled it. This is the thing `/api/pro` sells —
 * "metered API access with per-call USDC billing" — made literal.
 */
export function buildMeteringReceipt(args: MeteringReceiptArgs): MeteringReceipt {
  const now = args.now ?? (() => new Date().toISOString());
  const nonce = args.nonce ?? defaultNonce;
  const total = Number(args.amountUsd6);
  const units = Number.isFinite(args.units) && args.units > 0 ? Math.floor(args.units) : 0;
  // Integer division, floored: an agent re-deriving this must not see a value
  // that rounds up past what it was actually charged.
  const unitPrice = units > 0 && Number.isFinite(total) ? Math.floor(total / units) : 0;

  return {
    receipt_id: `rcpt-${args.tier}-${nonce()}`,
    tier: args.tier,
    units,
    unit_price_usd6: String(unitPrice),
    charged_usd6: args.amountUsd6,
    charged_usd: usd6ToDisplay(args.amountUsd6),
    payment_asset: args.asset ?? 'USDC',
    payer: args.payer,
    settlement_tx: args.settlementTx,
    issued_at: now(),
  };
}

// ── On-chain enrichment ──────────────────────────────────────────────────────

export interface NativeBalance {
  network: string;
  wei: string;
}

export interface TokenHolding {
  network: string;
  contract_address: string;
  raw_balance: string;
}

export interface TransferRecord {
  hash: string;
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  block_num: string | null;
}

export interface EnrichmentResult {
  address: string;
  networks: string[];
  native_balances: NativeBalance[];
  token_holdings: TokenHolding[];
  recent_transfers: TransferRecord[];
  generated_at: string;
  source: 'alchemy';
  degraded: boolean;
  errors: string[];
}

async function rpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<{ result?: unknown; error?: { message?: string } }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await resp.json()) as { result?: unknown; error?: { message?: string } };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Hex balances of all-zero carry no information for a buyer — drop them. */
function isNonZeroHex(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const stripped = v.replace(/^0x/, '').replace(/^0+/, '');
  return stripped.length > 0;
}

/**
 * Multi-chain enrichment for one address. Never throws — an upstream outage
 * comes back as `degraded: true` with the reasons listed, because the caller
 * has already paid by the time this runs.
 */
export async function fetchOnchainEnrichment(
  key: string | undefined,
  address: string,
): Promise<EnrichmentResult> {
  const normalized = typeof address === 'string' ? address.toLowerCase() : '';
  const base: EnrichmentResult = {
    address: normalized,
    networks: [],
    native_balances: [],
    token_holdings: [],
    recent_transfers: [],
    generated_at: new Date().toISOString(),
    source: 'alchemy',
    degraded: true,
    errors: [],
  };

  if (!ADDRESS_RE.test(address ?? '')) {
    return { ...base, errors: [`invalid address: expected 0x-prefixed 20-byte address`] };
  }
  const k = key?.trim();
  if (!k) {
    return { ...base, errors: ['ALCHEMY_API_KEY is not configured on this Worker'] };
  }

  const errors: string[] = [];
  const nativeBalances: NativeBalance[] = [];
  const tokenHoldings: TokenHolding[] = [];
  const transfers: TransferRecord[] = [];

  for (const network of ALCHEMY_ROLLUP_NETWORKS) {
    try {
      const json = await rpc(alchemyHttps(network, k), 'eth_getBalance', [normalized, 'latest']);
      if (typeof json.result === 'string') {
        nativeBalances.push({ network, wei: json.result });
      } else if (json.error?.message) {
        errors.push(`native_balance:${network}: ${json.error.message}`);
      }
    } catch (e) {
      errors.push(`native_balance:${network}: ${String(e)}`);
    }
  }

  try {
    const json = await rpc(alchemyHttps(ENRICHMENT_NETWORK, k), 'alchemy_getTokenBalances', [
      normalized,
    ]);
    const balances = asRecord(json.result).tokenBalances;
    if (Array.isArray(balances)) {
      for (const entry of balances) {
        const rec = asRecord(entry);
        if (typeof rec.contractAddress === 'string' && isNonZeroHex(rec.tokenBalance)) {
          tokenHoldings.push({
            network: ENRICHMENT_NETWORK,
            contract_address: rec.contractAddress.toLowerCase(),
            raw_balance: rec.tokenBalance,
          });
        }
      }
    } else if (json.error?.message) {
      errors.push(`token_balances: ${json.error.message}`);
    }
  } catch (e) {
    errors.push(`token_balances: ${String(e)}`);
  }

  try {
    const json = await rpc(alchemyHttps(ENRICHMENT_NETWORK, k), 'alchemy_getAssetTransfers', [
      {
        fromBlock: '0x0',
        toBlock: 'latest',
        toAddress: normalized,
        category: ['erc20'],
        order: 'desc',
        maxCount: `0x${MAX_TRANSFERS.toString(16)}`,
      },
    ]);
    const list = asRecord(json.result).transfers;
    if (Array.isArray(list)) {
      for (const entry of list.slice(0, MAX_TRANSFERS)) {
        const rec = asRecord(entry);
        transfers.push({
          hash: String(rec.hash ?? ''),
          from: String(rec.from ?? ''),
          to: String(rec.to ?? ''),
          value: typeof rec.value === 'number' ? rec.value : null,
          asset: typeof rec.asset === 'string' ? rec.asset : null,
          block_num: typeof rec.blockNum === 'string' ? rec.blockNum : null,
        });
      }
    } else if (json.error?.message) {
      errors.push(`asset_transfers: ${json.error.message}`);
    }
  } catch (e) {
    errors.push(`asset_transfers: ${String(e)}`);
  }

  return {
    ...base,
    networks: [...ALCHEMY_ROLLUP_NETWORKS],
    native_balances: nativeBalances,
    token_holdings: tokenHoldings,
    recent_transfers: transfers,
    degraded: errors.length > 0,
    errors,
  };
}

// ── Tier dispatch ────────────────────────────────────────────────────────────

export type TierDeliveryKind =
  | 'rtptpa'
  | 'metered_execution'
  | 'onchain_enrichment'
  | 'descriptor';

export interface TierDeliveryContext {
  tierPath: string;
  body: unknown;
  payer: string;
  amountUsd6: string;
  settlementTx: string | null;
  /** Falls back to the tier description only for tiers with no compute product. */
  description?: string;
  /** 'USDC' or 'ETH' — recorded on the receipt so the figures cannot mislead. */
  asset?: string;
  alchemyKey?: string;
  now?: () => string;
  nonce?: () => string;
}

export interface TierDelivery {
  kind: TierDeliveryKind;
  result: unknown;
  /** Kept as a sibling field for backwards compatibility with existing clients. */
  rtptpa?: RtptpaEvt;
}

function tierName(path: string): string {
  return path.replace('/api/', '');
}

function requestedAddress(body: unknown, payer: string): string {
  const rec = asRecord(body);
  const candidate = rec.address;
  return typeof candidate === 'string' && ADDRESS_RE.test(candidate) ? candidate : payer;
}

/**
 * Decides what a settled call returns. Guarantees a value for every tier and
 * never rejects — see the module header for why that matters here.
 */
export async function deliverTier(ctx: TierDeliveryContext): Promise<TierDelivery> {
  const tier = tierName(ctx.tierPath);

  if (ctx.tierPath === '/api/execute' || ctx.tierPath === '/api/inference') {
    try {
      const rtptpa = await runRtptpa(ctx.body);
      return { kind: 'rtptpa', result: rtptpa, rtptpa };
    } catch (e) {
      return {
        kind: 'rtptpa',
        result: { error: 'rtptpa execution failed', detail: String(e) },
      };
    }
  }

  if (ctx.tierPath === '/api/pro') {
    let execution: RtptpaEvt | null = null;
    let executionError: string | null = null;
    try {
      execution = await runRtptpa(ctx.body);
    } catch (e) {
      executionError = String(e);
    }
    const units = execution?.data.input_prompts.length ?? 0;
    const receipt = buildMeteringReceipt({
      tier,
      amountUsd6: ctx.amountUsd6,
      // A paid call is at least one billable unit even if the job degraded.
      units: units > 0 ? units : 1,
      payer: ctx.payer,
      settlementTx: ctx.settlementTx,
      asset: ctx.asset,
      now: ctx.now,
      nonce: ctx.nonce,
    });
    return {
      kind: 'metered_execution',
      result: {
        receipt,
        execution,
        ...(executionError ? { execution_error: executionError } : {}),
      },
      ...(execution ? { rtptpa: execution } : {}),
    };
  }

  if (ctx.tierPath === '/api/specialized') {
    const address = requestedAddress(ctx.body, ctx.payer);
    let enrichment: EnrichmentResult;
    try {
      enrichment = await fetchOnchainEnrichment(ctx.alchemyKey, address);
    } catch (e) {
      enrichment = {
        address: address.toLowerCase(),
        networks: [],
        native_balances: [],
        token_holdings: [],
        recent_transfers: [],
        generated_at: new Date().toISOString(),
        source: 'alchemy',
        degraded: true,
        errors: [String(e)],
      };
    }
    const units =
      enrichment.native_balances.length +
      enrichment.token_holdings.length +
      enrichment.recent_transfers.length;
    const receipt = buildMeteringReceipt({
      tier,
      amountUsd6: ctx.amountUsd6,
      units: units > 0 ? units : 1,
      payer: ctx.payer,
      settlementTx: ctx.settlementTx,
      asset: ctx.asset,
      now: ctx.now,
      nonce: ctx.nonce,
    });
    return { kind: 'onchain_enrichment', result: { receipt, enrichment } };
  }

  // Licence tiers are fulfilled out of band (Shopify); the descriptor is the
  // correct payload there, not a substitute for a missing compute product.
  return { kind: 'descriptor', result: ctx.description ?? tier };
}
