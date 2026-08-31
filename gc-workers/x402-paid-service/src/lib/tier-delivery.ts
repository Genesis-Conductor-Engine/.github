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
 *
 * Two rules follow from "the caller already paid" and are enforced below:
 *   1. Every upstream call is time-bounded. A hung dependency must not hold a
 *      paid response open; it degrades instead.
 *   2. Nothing derived from an upstream error reaches the client unredacted.
 *      `alchemyHttps()` embeds ALCHEMY_API_KEY in the URL, and fetch failures
 *      routinely stringify the URL they were given.
 */
import { runRtptpa, type RtptpaEvt } from './rtptpa';
import { ALCHEMY_ROLLUP_NETWORKS, alchemyHttps } from './alchemy/urls';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Base mainnet is where this service settles, so it is the enrichment default. */
const ENRICHMENT_NETWORK = 'base-mainnet';
const MAX_TRANSFERS = 10;
/** Post-settlement budget for any single upstream call. */
const UPSTREAM_TIMEOUT_MS = 8000;

// ── Redaction ────────────────────────────────────────────────────────────────

/**
 * Strip anything key-bearing from a string bound for the client. The key is
 * removed by value, and any Alchemy endpoint is removed wholesale because the
 * key rides in its path.
 */
function redact(message: string, key: string | undefined): string {
  let out = message;
  if (key && key.length > 0) out = out.split(key).join('***');
  out = out.replace(/https?:\/\/[^\s'"]*alchemy\.com[^\s'"]*/gi, '<alchemy-endpoint>');
  return out;
}

// ── Metering receipt ─────────────────────────────────────────────────────────

export interface MeteringReceipt {
  receipt_id: string;
  tier: string;
  units: number;
  /** Null when settlement was not in USDC — see charged_raw. */
  unit_price_usd6: string | null;
  charged_usd6: string | null;
  charged_usd: string | null;
  /** Amount actually settled, in the base units of payment_asset. */
  charged_raw: string | null;
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
  /** Raw settled amount (wei for ETH, 6dp for USDC). */
  amountRaw?: string;
  now?: () => string;
  nonce?: () => string;
}

let nonceCounter = 0;

function defaultNonce(): string {
  try {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Must still be unique per receipt: a constant here would collapse every
    // receipt_id in the fleet onto the same value.
    nonceCounter += 1;
    return `n${Date.now().toString(36)}${nonceCounter.toString(36)}`;
  }
}

function usd6ToDisplay(amountUsd6: string): string {
  const n = Number(amountUsd6);
  if (!Number.isFinite(n)) return '0.00';
  // Truncate rather than round: a receipt must never overstate the charge.
  return (Math.floor(n / 10_000) / 100).toFixed(2);
}

/**
 * A receipt an agent can audit: what it was charged, for how many units, and
 * which on-chain transaction settled it. This is the thing `/api/pro` sells —
 * "metered API access with per-call USDC billing" — made literal.
 *
 * For a non-USDC settlement the USD fields are null rather than "0.00": the
 * payment was real, and asserting a zero dollar charge would be a false record.
 */
export function buildMeteringReceipt(args: MeteringReceiptArgs): MeteringReceipt {
  const now = args.now ?? (() => new Date().toISOString());
  const nonce = args.nonce ?? defaultNonce;
  const asset = args.asset ?? 'USDC';
  const isUsdc = asset === 'USDC';
  const total = Number(args.amountUsd6);
  const units = Number.isFinite(args.units) && args.units > 0 ? Math.floor(args.units) : 0;
  // Integer division, floored: an agent re-deriving this must not see a value
  // that rounds up past what it was actually charged. Note units x unit_price
  // can be less than the total — the charge is a flat per-call fee, and units
  // describe the work delivered for it.
  const unitPrice = units > 0 && Number.isFinite(total) ? Math.floor(total / units) : 0;

  return {
    receipt_id: `rcpt-${args.tier}-${nonce()}`,
    tier: args.tier,
    units,
    unit_price_usd6: isUsdc ? String(unitPrice) : null,
    charged_usd6: isUsdc ? args.amountUsd6 : null,
    charged_usd: isUsdc ? usd6ToDisplay(args.amountUsd6) : null,
    charged_raw: args.amountRaw ?? (isUsdc ? args.amountUsd6 : null),
    payment_asset: asset,
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
  direction: 'in' | 'out';
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

interface RpcOutcome {
  result?: unknown;
  errorMessage?: string;
}

/**
 * One JSON-RPC call, time-bounded, with HTTP status honoured. A non-2xx reply
 * (expired key, quota breach) carries no JSON-RPC `error` member, so checking
 * only `body.error` would silently read as success with empty data.
 */
async function rpc(
  url: string,
  method: string,
  params: unknown[],
  key: string | undefined,
): Promise<RpcOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { errorMessage: `upstream HTTP ${resp.status}` };
    }
    const body = (await resp.json()) as { result?: unknown; error?: { message?: string } };
    if (body && typeof body === 'object' && body.error) {
      return { errorMessage: redact(body.error.message ?? 'upstream error', key) };
    }
    if (!body || !('result' in body)) {
      return { errorMessage: 'upstream returned no result' };
    }
    return { result: body.result };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'AbortError') {
      return { errorMessage: `upstream timed out after ${UPSTREAM_TIMEOUT_MS}ms` };
    }
    return { errorMessage: redact(String(e), key) };
  } finally {
    clearTimeout(timer);
  }
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

function collectTransfers(
  result: unknown,
  direction: 'in' | 'out',
  into: Map<string, TransferRecord>,
): boolean {
  const list = asRecord(result).transfers;
  if (!Array.isArray(list)) return false;
  for (const entry of list.slice(0, MAX_TRANSFERS)) {
    const rec = asRecord(entry);
    const hash = String(rec.hash ?? '');
    // The same transfer can surface in both directions (self-sends); key by
    // hash so the buyer is not shown a duplicate.
    if (into.has(hash)) continue;
    into.set(hash, {
      hash,
      from: String(rec.from ?? ''),
      to: String(rec.to ?? ''),
      value: typeof rec.value === 'number' ? rec.value : null,
      asset: typeof rec.asset === 'string' ? rec.asset : null,
      block_num: typeof rec.blockNum === 'string' ? rec.blockNum : null,
      direction,
    });
  }
  return true;
}

/**
 * Multi-chain enrichment for one address. Never throws — an upstream outage
 * comes back as `degraded: true` with the reasons listed, because the caller
 * has already paid by the time this runs. Partial coverage counts as degraded:
 * an incomplete dataset must not be presented as a complete answer.
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
    return { ...base, errors: ['invalid address: expected 0x-prefixed 20-byte address'] };
  }
  const k = key?.trim();
  if (!k) {
    return { ...base, errors: ['ALCHEMY_API_KEY is not configured on this Worker'] };
  }

  const errors: string[] = [];
  const nativeBalances: NativeBalance[] = [];
  const tokenHoldings: TokenHolding[] = [];
  const transfers = new Map<string, TransferRecord>();

  for (const network of ALCHEMY_ROLLUP_NETWORKS) {
    const out = await rpc(alchemyHttps(network, k), 'eth_getBalance', [normalized, 'latest'], k);
    if (typeof out.result === 'string') {
      nativeBalances.push({ network, wei: out.result });
    } else {
      errors.push(`native_balance:${network}: ${out.errorMessage ?? 'no balance returned'}`);
    }
  }

  const balances = await rpc(
    alchemyHttps(ENRICHMENT_NETWORK, k),
    'alchemy_getTokenBalances',
    [normalized],
    k,
  );
  const balanceList = asRecord(balances.result).tokenBalances;
  if (Array.isArray(balanceList)) {
    for (const entry of balanceList) {
      const rec = asRecord(entry);
      if (typeof rec.contractAddress === 'string' && isNonZeroHex(rec.tokenBalance)) {
        tokenHoldings.push({
          network: ENRICHMENT_NETWORK,
          contract_address: rec.contractAddress.toLowerCase(),
          raw_balance: rec.tokenBalance,
        });
      }
    }
  } else {
    errors.push(`token_balances: ${balances.errorMessage ?? 'no balances returned'}`);
  }

  // Both directions: an "ERC-20 transfer history" that omits everything the
  // address sent is not the dataset this tier advertises.
  const transferQueries: { direction: 'in' | 'out'; params: Record<string, unknown> }[] = [
    { direction: 'in', params: { toAddress: normalized } },
    { direction: 'out', params: { fromAddress: normalized } },
  ];
  for (const q of transferQueries) {
    const out = await rpc(
      alchemyHttps(ENRICHMENT_NETWORK, k),
      'alchemy_getAssetTransfers',
      [{
        fromBlock: '0x0',
        toBlock: 'latest',
        category: ['erc20'],
        order: 'desc',
        maxCount: `0x${MAX_TRANSFERS.toString(16)}`,
        ...q.params,
      }],
      k,
    );
    if (!collectTransfers(out.result, q.direction, transfers)) {
      errors.push(`asset_transfers:${q.direction}: ${out.errorMessage ?? 'no transfers returned'}`);
    }
  }

  return {
    ...base,
    networks: [...ALCHEMY_ROLLUP_NETWORKS],
    native_balances: nativeBalances,
    token_holdings: tokenHoldings,
    recent_transfers: [...transfers.values()],
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
  /** Raw settled amount in the asset's base units. */
  amountRaw?: string;
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

function requestedAddress(body: unknown, payer: string): string | null {
  const rec = asRecord(body);
  const candidate = rec.address;
  if (typeof candidate === 'string') {
    // An explicitly supplied but malformed address is an error, not a cue to
    // silently enrich somebody else's address on the buyer's dime.
    return ADDRESS_RE.test(candidate) ? candidate : null;
  }
  return ADDRESS_RE.test(payer ?? '') ? payer : null;
}

/**
 * Decides what a settled call returns. Guarantees a value for every tier and
 * never rejects — see the module header for why that matters here.
 */
export async function deliverTier(ctx: TierDeliveryContext): Promise<TierDelivery> {
  const tier = tierName(ctx.tierPath);
  const receiptFor = (units: number) =>
    buildMeteringReceipt({
      tier,
      amountUsd6: ctx.amountUsd6,
      units,
      payer: ctx.payer,
      settlementTx: ctx.settlementTx,
      asset: ctx.asset,
      amountRaw: ctx.amountRaw,
      now: ctx.now,
      nonce: ctx.nonce,
    });

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
    // A paid call is at least one billable unit even if the job degraded.
    const receipt = receiptFor(units > 0 ? units : 1);
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
    if (!address) {
      enrichment = {
        address: '',
        networks: [],
        native_balances: [],
        token_holdings: [],
        recent_transfers: [],
        generated_at: new Date().toISOString(),
        source: 'alchemy',
        degraded: true,
        errors: [
          'no valid address to enrich: supply {"address":"0x..."} in the request body',
        ],
      };
    } else {
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
          errors: [redact(String(e), ctx.alchemyKey)],
        };
      }
    }
    const units =
      enrichment.native_balances.length +
      enrichment.token_holdings.length +
      enrichment.recent_transfers.length;
    const receipt = receiptFor(units > 0 ? units : 1);
    return {
      kind: 'onchain_enrichment',
      // Surfaced at the top of the payload so a buyer sees an incomplete answer
      // without having to dig into the enrichment object.
      result: { receipt, degraded: enrichment.degraded, enrichment },
    };
  }

  // Licence tiers are fulfilled out of band (Shopify); the descriptor is the
  // correct payload there, not a substitute for a missing compute product.
  return { kind: 'descriptor', result: ctx.description ?? tier };
}
