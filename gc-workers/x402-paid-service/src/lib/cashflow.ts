/**
 * Internal cashflow / ROI surface.
 * Balances are public on-chain facts. Window PnL comes from the
 * 2026-08-09..2026-08-15 settlement USDC report. Vendor lines are
 * status, not invented invoices.
 * ralphloop: n=3n/2+1 to keep 10x the profit cashflow (LIVE revenue actuation)
 */

export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
export const WETH_BASE = '0x4200000000000000000000000000000000000006';
export const WQFLOP_BASE = '0x69262A2D7c92c074729823B654fE7E4Cdb749747';
export const PUBLIC_BASE_RPC = 'https://mainnet.base.org';
export const PUBLIC_ETH_RPC = 'https://ethereum.publicnode.com';
export const PUBLIC_ARB_RPC = 'https://arb1.arbitrum.io/rpc';
export const SNAPSHOT_KEY = 'cashflow:snapshot';
export const LEDGER_KEY = 'cashflow:ledger';
export const LEDGER_MAX = 200;
export const FALLBACK_ETH_USD = 1877.49;

/** Native USDC only. Same CSW address on each chain; not agent-signable. */
export const SETTLEMENT_USDC_CHAINS = [
  { id: 'base', name: 'Base', token: USDC_BASE, rpcs: [PUBLIC_BASE_RPC, 'https://1rpc.io/base'] },
  { id: 'ethereum', name: 'Ethereum', token: USDC_ETH, rpcs: [PUBLIC_ETH_RPC, 'https://cloudflare-eth.com'] },
  { id: 'arbitrum', name: 'Arbitrum', token: USDC_ARB, rpcs: ['https://arbitrum-one.publicnode.com', PUBLIC_ARB_RPC, 'https://1rpc.io/arb', 'https://arbitrum.drpc.org'] },
] as const;

export const FLEET = [
  { id: 'treasury', role: 'Root treasury (locked)', address: '0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75' },
  { id: 'settlement', role: 'Settlement / working capital (CSW, ETH+Base+Arb)', address: '0x937897fe19F675c96a71078820F21cA9bD637180' },
  { id: 'hot', role: 'HOT_X402 / LP owner', address: '0x60C4499870f115664d7FfD8411b023DBEf3377d9' },
  { id: 'payto', role: 'x402 VAULT_ADDRESS (payTo = HOT)', address: '0x60C4499870f115664d7FfD8411b023DBEf3377d9' },
  { id: 'main', role: 'x402 MAIN_WALLET (signer)', address: '0x967a9C352a87D3a72baa7aD10632A7276101dBc9' },
] as const;

/** From docs/superpowers/plans/2026-08-15-settlement-usdc-outflow.md */
export const SETTLEMENT_WINDOW = {
  start: '2026-08-09T00:00:00Z',
  end: '2026-08-15T10:21:00Z',
  opening_prose_usdc: 61745,
  sum_in_usdc: 100159.196218,
  sum_out_usdc: 109912.157537,
  net_usdc: -9752.961319,
  live_close_usdc: 54428.773194,
  implied_close_usdc: 51992.038681,
  residual_usdc: 2436.734513,
  transfer_count: 3258,
  source: 'dune:erc20_base.evt_Transfer',
} as const;

export const VENDORS = [
  {
    id: 'alchemy',
    name: 'Alchemy',
    status: 'live_rpc',
    category: 'opex_rpc',
    note: 'New API key installed 2026-08-15 (Worker secrets ALCHEMY_API_KEY + ALCHEMY_BASE_RPC_URL). Live Base RPC recovered. Dollar invoice still only payable in the Alchemy billing UI — no on-chain payTo.',
    settle_url: 'https://dashboard.alchemy.com/settings/billing',
    amount_usd: null,
  },
] as const;

export type Direction = 'in' | 'out';

export interface LedgerEvent {
  ts: string;
  source: string;
  direction: Direction;
  asset: string;
  amount: number;
  tx?: string;
  from?: string;
  to?: string;
  note?: string;
}

export interface ChainUsdcSnap {
  id: string;
  name: string;
  usdc: number;
}

export interface WalletSnap {
  id: string;
  role: string;
  address: string;
  eth: number;
  usdc: number;
  usd: number;
  /** Present on the settlement CSW: native USDC per chain. */
  chains?: ChainUsdcSnap[];
}

export function sumChainUsdc(chains: readonly { usdc: number }[]): number {
  return chains.reduce((s, c) => s + (Number.isFinite(c.usdc) ? c.usdc : 0), 0);
}

export interface WqflopMark {
  priced: boolean;
  price_usd: number | null;
  liquidity_usd: number | null;
  pools: number;
  note: string;
}

export interface MarketMarks {
  eth_source: 'dexpaprika' | 'coinpaprika' | 'fallback';
  wqflop: WqflopMark;
}

export interface CashflowSnapshot {
  generated_at: string;
  eth_usd: number;
  wallets: WalletSnap[];
  priced_usd: number;
  working_capital_usdc: number;
  window: typeof SETTLEMENT_WINDOW;
  roi: RoiModel;
  vendors: typeof VENDORS;
  ledger: LedgerEvent[];
  assumptions: string[];
  freshness?: 'live' | 'cached';
  marks?: MarketMarks;
}

export interface RoiModel {
  period_net_usdc: number;
  period_roi_on_prose_open: number;
  implied_true_open_usdc: number;
  period_roi_on_implied_open: number;
  working_capital_usdc: number;
  /** Speculative weekly-compound scenarios. Not observed. */
  flywheel: { weekly_rate: number; weeks: number; future_usdc: number; label: string }[];
}

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export function computeRoi(workingCapitalUsdc: number): RoiModel {
  const w = SETTLEMENT_WINDOW;
  const proseRoi = w.net_usdc / w.opening_prose_usdc;
  const impliedOpen = w.opening_prose_usdc + w.residual_usdc;
  const impliedRoi = w.net_usdc / impliedOpen;
  const weeks = 12;
  const flywheel = [0.005, 0.02, 0.05].map((weekly_rate) => ({
    weekly_rate,
    weeks,
    future_usdc: workingCapitalUsdc * (1 + weekly_rate) ** weeks,
    label: `${(weekly_rate * 100).toFixed(1)}%/wk × ${weeks}w (model, not observed)`,
  }));
  return {
    period_net_usdc: w.net_usdc,
    period_roi_on_prose_open: proseRoi,
    implied_true_open_usdc: impliedOpen,
    period_roi_on_implied_open: impliedRoi,
    working_capital_usdc: workingCapitalUsdc,
    flywheel,
  };
}

export function parseWebhook(body: unknown): LedgerEvent[] {
  if (!body || typeof body !== 'object') return [];
  const rec = body as Record<string, unknown>;

  if (rec.type === 'ADDRESS_ACTIVITY' && rec.event && typeof rec.event === 'object') {
    const ev = rec.event as Record<string, unknown>;
    const activity = Array.isArray(ev.activity) ? ev.activity : [];
    const out: LedgerEvent[] = [];
    for (const raw of activity) {
      if (!raw || typeof raw !== 'object') continue;
      const a = raw as Record<string, unknown>;
      const from = String(a.fromAddress || a.from || '');
      const to = String(a.toAddress || a.to || '');
      const asset = String(a.asset || 'UNKNOWN');
      const amount = Number(a.value ?? a.amount ?? 0);
      const direction = classifyDirection(from, to);
      if (!direction) continue;
      out.push({
        ts: new Date().toISOString(),
        source: 'alchemy',
        direction,
        asset,
        amount: Number.isFinite(amount) ? amount : 0,
        tx: typeof a.hash === 'string' ? a.hash : undefined,
        from,
        to,
        note: typeof a.category === 'string' ? a.category : 'ADDRESS_ACTIVITY',
      });
    }
    return out;
  }

  if (rec.alert === 'gas_low') {
    return [{
      ts: new Date().toISOString(),
      source: 'gas_monitor',
      direction: 'out',
      asset: 'ETH',
      amount: 0,
      note: `gas_low vault=${String(rec.vault ?? '')} main=${String(rec.main ?? '')} threshold=${String(rec.threshold ?? '')}`,
    }];
  }

  if (typeof rec.asset === 'string' && (rec.direction === 'in' || rec.direction === 'out')) {
    return [{
      ts: typeof rec.ts === 'string' ? rec.ts : new Date().toISOString(),
      source: typeof rec.source === 'string' ? rec.source : 'manual',
      direction: rec.direction,
      asset: rec.asset,
      amount: Number(rec.amount ?? 0) || 0,
      tx: typeof rec.tx === 'string' ? rec.tx : undefined,
      from: typeof rec.from === 'string' ? rec.from : undefined,
      to: typeof rec.to === 'string' ? rec.to : undefined,
      note: typeof rec.note === 'string' ? rec.note : undefined,
    }];
  }

  return [];
}

function classifyDirection(from: string, to: string): Direction | null {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  const ours = new Set(FLEET.map((w) => w.address.toLowerCase()));
  const fromOurs = ours.has(f);
  const toOurs = ours.has(t);
  if (fromOurs && !toOurs) return 'out';
  if (toOurs && !fromOurs) return 'in';
  if (fromOurs && toOurs) return 'out';
  return null;
}

export async function loadLedger(kv: KvLike | undefined): Promise<LedgerEvent[]> {
  if (!kv) return [];
  const raw = await kv.get(LEDGER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as LedgerEvent[] : [];
  } catch {
    return [];
  }
}

export async function appendLedger(kv: KvLike | undefined, events: LedgerEvent[]): Promise<LedgerEvent[]> {
  const prev = await loadLedger(kv);
  const next = [...events, ...prev].slice(0, LEDGER_MAX);
  if (kv) await kv.put(LEDGER_KEY, JSON.stringify(next));
  return next;
}

export async function loadSnapshot(kv: KvLike | undefined): Promise<CashflowSnapshot | null> {
  if (!kv) return null;
  const raw = await kv.get(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CashflowSnapshot;
  } catch {
    return null;
  }
}

function padAddr(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

async function rpc(url: string, method: string, params: unknown[]): Promise<string> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await resp.json()) as { result?: string; error?: { message: string } };
  if (!json.result) throw new Error(json.error?.message ?? `rpc ${method} failed`);
  return json.result;
}

export function parseDexTokenPrice(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null;
  const rec = json as Record<string, unknown>;
  const fromSummary = rec.summary && typeof rec.summary === 'object'
    ? (rec.summary as Record<string, unknown>).price_usd
    : undefined;
  const raw = fromSummary ?? rec.price_usd;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

export function parseDexPoolCount(json: unknown): number {
  if (!json || typeof json !== 'object') return 0;
  const rec = json as Record<string, unknown>;
  if (Array.isArray(rec.results)) return rec.results.length;
  if (Array.isArray(rec.pools)) return rec.pools.length;
  return 0;
}

async function fetchJson(url: string, ms = 2500): Promise<unknown> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'gc-cashflow/1.0' },
    signal: AbortSignal.timeout(ms),
  });
  if (!resp.ok) throw new Error(`http ${resp.status} ${url}`);
  return resp.json();
}

export async function fetchEthUsd(): Promise<number> {
  const json = await fetchJson('https://api.coinpaprika.com/v1/tickers/eth-ethereum') as {
    quotes?: { USD?: { price?: number } };
  };
  const price = json.quotes?.USD?.price;
  if (!price) throw new Error('eth price missing');
  return price;
}

export async function fetchMarketMarks(): Promise<{ eth_usd: number; marks: MarketMarks }> {
  const unpriced: WqflopMark = {
    priced: false,
    price_usd: null,
    liquidity_usd: null,
    pools: 0,
    note: 'DexPaprika lists wQFLOP on Base but reports 0 pools and no price_usd — paper supply, not a mark.',
  };

  const [weth, wqflopToken, wqflopPools, paprika] = await Promise.allSettled([
    fetchJson(`https://api.dexpaprika.com/networks/base/tokens/${WETH_BASE.toLowerCase()}`),
    fetchJson(`https://api.dexpaprika.com/networks/base/tokens/${WQFLOP_BASE.toLowerCase()}`),
    fetchJson(`https://api.dexpaprika.com/networks/base/pools/search?token_address=${WQFLOP_BASE.toLowerCase()}&limit=5`),
    fetchEthUsd(),
  ]);

  const wethPx = weth.status === 'fulfilled' ? parseDexTokenPrice(weth.value) : null;
  const wqPx = wqflopToken.status === 'fulfilled' ? parseDexTokenPrice(wqflopToken.value) : null;
  const pools = wqflopPools.status === 'fulfilled' ? parseDexPoolCount(wqflopPools.value) : 0;
  const paprikaPx = paprika.status === 'fulfilled' ? paprika.value : null;

  let eth_usd = FALLBACK_ETH_USD;
  let eth_source: MarketMarks['eth_source'] = 'fallback';
  if (wethPx) {
    eth_usd = wethPx;
    eth_source = 'dexpaprika';
  } else if (paprikaPx) {
    eth_usd = paprikaPx;
    eth_source = 'coinpaprika';
  }

  const wqflop: WqflopMark = wqPx
    ? { priced: true, price_usd: wqPx, liquidity_usd: null, pools, note: 'DexPaprika spot — still not working capital.' }
    : { ...unpriced, pools };

  return { eth_usd, marks: { eth_source, wqflop } };
}

async function rpcFirst(urls: string[], method: string, params: unknown[]): Promise<string> {
  let last: unknown;
  for (const url of urls) {
    try {
      return await rpc(url, method, params);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function refreshSnapshot(
  kv: KvLike | undefined,
  rpcUrl: string = PUBLIC_BASE_RPC,
): Promise<CashflowSnapshot> {
  let ethUsd = FALLBACK_ETH_USD;
  let marks: MarketMarks = {
    eth_source: 'fallback',
    wqflop: {
      priced: false,
      price_usd: null,
      liquidity_usd: null,
      pools: 0,
      note: 'DexPaprika wQFLOP mark unavailable this refresh.',
    },
  };
  try {
    const market = await fetchMarketMarks();
    ethUsd = market.eth_usd;
    marks = market.marks;
  } catch {
    // keep last-known mark
  }

  const prior = await loadSnapshot(kv);
  const rpcUrls = [...new Set([rpcUrl, PUBLIC_BASE_RPC, 'https://1rpc.io/base'])];
  const wallets: WalletSnap[] = await Promise.all(FLEET.map(async (w) => {
    let eth = 0;
    let usdc = 0;
    let chains: ChainUsdcSnap[] | undefined;
    try {
      const rawEth = await rpcFirst(rpcUrls, 'eth_getBalance', [w.address, 'latest']);
      eth = Number(BigInt(rawEth)) / 1e18;
    } catch { /* leave 0 */ }
    if (w.id === 'settlement') {
      const data = `0x70a08231${padAddr(w.address)}`;
      chains = await Promise.all(SETTLEMENT_USDC_CHAINS.map(async (chain) => {
        const urls = chain.id === 'base' ? [...new Set([...rpcUrls, ...chain.rpcs])] : [...chain.rpcs];
        // Some public RPCs answer 0x0 from the Worker egress. Try every URL
        // and keep the first positive native-USDC decode.
        let amount = 0;
        for (const url of urls) {
          try {
            const rawUsdc = await rpc(url, 'eth_call', [{ to: chain.token, data }, 'latest']);
            const decoded = Number(BigInt(rawUsdc)) / 1e6;
            if (Number.isFinite(decoded) && decoded > 0) {
              amount = decoded;
              break;
            }
          } catch { /* next url */ }
        }
        return { id: chain.id, name: chain.name, usdc: amount };
      }));
      const priorChains = prior?.wallets.find((x) => x.id === 'settlement')?.chains;
      chains = chains.map((c) => {
        if (c.usdc > 0) return c;
        const prev = priorChains?.find((p) => p.id === c.id);
        if (prev && prev.usdc > 0) return { ...c, usdc: prev.usdc };
        return c;
      });
      usdc = sumChainUsdc(chains);
    } else {
      try {
        const data = `0x70a08231${padAddr(w.address)}`;
        const rawUsdc = await rpcFirst(rpcUrls, 'eth_call', [{ to: USDC_BASE, data }, 'latest']);
        usdc = Number(BigInt(rawUsdc)) / 1e6;
      } catch { /* leave 0 */ }
    }
    return {
      id: w.id,
      role: w.role,
      address: w.address,
      eth,
      usdc,
      usd: eth * ethUsd + usdc,
      ...(chains ? { chains } : {}),
    };
  }));

  const rpcLive = wallets.some((w) => w.eth > 0 || w.usdc > 0);
  if (!rpcLive) {
    if (prior && prior.priced_usd > 0) {
      return {
        ...prior,
        generated_at: new Date().toISOString(),
        eth_usd: ethUsd,
        ledger: await loadLedger(kv),
        assumptions: [
          ...prior.assumptions.filter((a) => !a.startsWith('RPC degraded')),
          'RPC degraded: showing last priced snapshot (Alchemy 429 / public RPC blocked from Worker).',
        ],
      };
    }
    const stale: Record<string, { eth: number; usdc: number; chains?: ChainUsdcSnap[] }> = {
      treasury: { eth: 14.667072, usdc: 709.662404 },
      settlement: {
        eth: 0,
        usdc: 214952.391995,
        chains: [
          { id: 'base', name: 'Base', usdc: 53651.098082 },
          { id: 'ethereum', name: 'Ethereum', usdc: 106863.872238 },
          { id: 'arbitrum', name: 'Arbitrum', usdc: 54437.421675 },
        ],
      },
      hot: { eth: 0.000001068, usdc: 2.037103 },
      payto: { eth: 0.000001068, usdc: 2.037103 },
      main: { eth: 0, usdc: 0 },
    };
    for (const w of wallets) {
      const s = stale[w.id];
      if (!s) continue;
      w.eth = s.eth;
      w.usdc = s.usdc;
      w.usd = s.eth * ethUsd + s.usdc;
      if (s.chains) w.chains = s.chains;
    }
  }

  const priced = wallets.reduce((s, w) => s + w.usd, 0);
  const settlement = wallets.find((w) => w.id === 'settlement');
  const working = settlement?.usdc ?? SETTLEMENT_WINDOW.live_close_usdc;
  const ledger = await loadLedger(kv);
  const snap: CashflowSnapshot = {
    generated_at: new Date().toISOString(),
    eth_usd: ethUsd,
    wallets,
    priced_usd: priced,
    working_capital_usdc: working,
    window: SETTLEMENT_WINDOW,
    roi: computeRoi(working),
    vendors: VENDORS,
    ledger,
    freshness: 'live',
    marks,
    assumptions: [
      ...(rpcLive ? [] : ['RPC degraded: last operator-verified snapshot used for balances.']),
      `ETH mark: ${marks.eth_source} spot (fallback ${FALLBACK_ETH_USD} if fetch fails).`,
      `USDC = $1. ${marks.wqflop.note}`,
      'Window PnL is Base settlement USDC only (Dune 2026-08-09..15). Working capital sums native USDC on Ethereum + Base + Arbitrum for the same CSW.',
      'Opening 61,745 is prose; residual +2,436.73 implies a higher true open.',
      'Flywheel rates are models, not observed returns.',
      'Alchemy invoice amount unknown — dollar bill is dashboard-only; Worker RPC is live.',
      'x402 payTo is HOT 0x60C4499870f115664d7FfD8411b023DBEf3377d9. Settlement 0x9378… is a Coinbase Smart Wallet (same 806-byte code on ETH/Base/Arb), not agent-signable. WETH/USDT dust is not in working capital.',
    ],
  };
  if (kv) await kv.put(SNAPSHOT_KEY, JSON.stringify(snap));
  return snap;
}

export async function resolveCashflowSnapshot(
  kv: KvLike | undefined,
  rpcUrl: string,
  waitUntil?: (promise: Promise<unknown>) => void,
  forceRefresh = false,
): Promise<{ snap: CashflowSnapshot; cache: 'hit' | 'miss' }> {
  if (forceRefresh) {
    const snap = await refreshSnapshot(kv, rpcUrl);
    return { snap, cache: 'miss' };
  }
  const cached = await loadSnapshot(kv);
  if (cached && cached.priced_usd > 0) {
    if (waitUntil) {
      waitUntil(
        refreshSnapshot(kv, rpcUrl).catch((e) => {
          console.error('[cashflow] background refresh failed:', e);
        }),
      );
    }
    return { snap: { ...cached, freshness: 'cached' }, cache: 'hit' };
  }
  const snap = await refreshSnapshot(kv, rpcUrl);
  return { snap, cache: 'miss' };
}

export function buildCashflowHtml(snap: CashflowSnapshot, hostname: string): string {
  const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const num = (n: number, d = 4) => n.toLocaleString('en-US', { maximumFractionDigits: d });
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const rows = snap.wallets.map((w) => {
    const chainDl = (w.chains && w.chains.length)
      ? `<dl>${w.chains.map((c) => `<dt>${escapeHtml(c.name)} USDC</dt><dd>${num(c.usdc, 2)}</dd>`).join('')}</dl>`
      : '';
    return `
    <article class="card">
      <h3>${escapeHtml(w.role)}</h3>
      <p class="addr"><code>${w.address}</code></p>
      <dl>
        <dt>ETH</dt><dd>${num(w.eth, 6)}</dd>
        <dt>USDC</dt><dd>${num(w.usdc, 2)}</dd>
        <dt>USD</dt><dd>${usd(w.usd)}</dd>
      </dl>
      ${chainDl}
    </article>`;
  }).join('');
  const vendorRows = snap.vendors.map((v) => `
    <tr>
      <td>${escapeHtml(v.name)}</td>
      <td><span class="pill ${v.status === 'live_rpc' ? 'ok' : 'warn'}">${escapeHtml(v.status)}</span></td>
      <td>${v.amount_usd == null ? 'unknown' : usd(v.amount_usd)}</td>
      <td>${escapeHtml(v.note)} <a href="${escapeHtml(v.settle_url)}">settle</a></td>
    </tr>`).join('');
  const fly = snap.roi.flywheel.map((f) => `
    <tr><td>${escapeHtml(f.label)}</td><td>${usd(f.future_usdc)}</td></tr>`).join('');
  const ledger = snap.ledger.slice(0, 25).map((e) => `
    <tr>
      <td>${escapeHtml(e.ts)}</td>
      <td>${escapeHtml(e.source)}</td>
      <td>${e.direction}</td>
      <td>${escapeHtml(e.asset)}</td>
      <td>${num(e.amount, 6)}</td>
      <td><code>${escapeHtml((e.tx || '').slice(0, 18))}</code></td>
    </tr>`).join('') || '<tr><td colspan="6">No webhook events yet. POST /webhooks/treasury</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GC Cashflow — internal ROI</title>
  <meta name="description" content="Genesis Conductor working-capital, vendor settlement, and window ROI.">
  <style>
    :root { color-scheme: dark; --bg:#0c0f14; --fg:#e8edf5; --muted:#93a0b5; --card:#151b24; --line:#243044; --good:#3dd68c; --bad:#ff6b6b; --warn:#f5c14a; }
    * { box-sizing: border-box; }
    body { margin:0; font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--fg); }
    header, main { max-width: 1100px; margin: 0 auto; padding: 1.25rem; }
    h1 { font-size: clamp(1.4rem, 3vw, 2rem); margin: 0 0 .3rem; }
    .sub { color: var(--muted); }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .75rem; margin: 1rem 0 1.5rem; }
    .kpi { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: .9rem 1rem; }
    .kpi b { display:block; font-size: 1.35rem; }
    .neg { color: var(--bad); } .pos { color: var(--good); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .75rem; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: .9rem 1rem; container-type: inline-size; }
    @container (max-width: 18rem) { .card dl { grid-template-columns: 1fr; } }
    .card h3 { margin: 0 0 .35rem; font-size: 1rem; }
    .addr { color: var(--muted); font-size: .8rem; overflow-wrap: anywhere; }
    dl { display:grid; grid-template-columns: repeat(3, 1fr); gap:.4rem; margin:.4rem 0 0; }
    dt { color: var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.04em; }
    dd { margin:0; font-variant-numeric: tabular-nums; }
    table { width:100%; border-collapse: collapse; background: var(--card); border-radius: 12px; overflow: hidden; }
    th, td { text-align:left; padding:.55rem .7rem; border-bottom: 1px solid var(--line); font-size:.9rem; }
    th { color: var(--muted); font-weight: 600; }
    .pill { padding:.1rem .45rem; border-radius: 999px; font-size:.8rem; }
    .pill.warn { background: #3a2e10; color: var(--warn); }
    .pill.ok { background: #123524; color: var(--good); }
    a { color: #8cb4ff; }
    section { margin: 1.6rem 0; }
    .defer { content-visibility: auto; contain-intrinsic-size: auto 24rem; }
  </style>
</head>
<body>
  <header>
    <h1 id="lcp">Internal cashflow &amp; ROI</h1>
    <p class="sub">Generated ${escapeHtml(snap.generated_at)} · ${escapeHtml(snap.freshness ?? 'live')} · ETH ${usd(snap.eth_usd)} (${escapeHtml(snap.marks?.eth_source ?? 'unknown')}) · host ${escapeHtml(hostname)}</p>
  </header>
  <main>
    <div class="kpis">
      <div class="kpi"><span>Priced book</span><b>${usd(snap.priced_usd)}</b></div>
      <div class="kpi"><span>Working capital</span><b>${usd(snap.working_capital_usdc)}</b></div>
      <div class="kpi"><span>Window net USDC</span><b class="${snap.roi.period_net_usdc < 0 ? 'neg' : 'pos'}">${usd(snap.roi.period_net_usdc)}</b></div>
      <div class="kpi"><span>ROI on prose open</span><b class="neg">${pct(snap.roi.period_roi_on_prose_open)}</b></div>
    </div>

    <section>
      <h2>Wallets</h2>
      <div class="grid">${rows}</div>
    </section>

    <section class="defer">
      <h2>Market sensors</h2>
      <p class="sub">wQFLOP ${escapeHtml(snap.marks?.wqflop.priced ? 'priced' : 'unpriced')} · pools ${snap.marks?.wqflop.pools ?? 0} · ${escapeHtml(snap.marks?.wqflop.note ?? 'no mark')}</p>
    </section>

    <section class="defer">
      <h2>Vendor settlement</h2>
      <table>
        <thead><tr><th>Vendor</th><th>Status</th><th>Amount</th><th>Notes</th></tr></thead>
        <tbody>${vendorRows}</tbody>
      </table>
    </section>

    <section class="defer">
      <h2>Observed window (settlement USDC)</h2>
      <p class="sub">${escapeHtml(snap.window.start)} → ${escapeHtml(snap.window.end)} · ${snap.window.transfer_count} transfers · ${escapeHtml(snap.window.source)}</p>
      <table>
        <tbody>
          <tr><th>Opening (prose)</th><td>${usd(snap.window.opening_prose_usdc)}</td></tr>
          <tr><th>In / Out</th><td>${usd(snap.window.sum_in_usdc)} / ${usd(snap.window.sum_out_usdc)}</td></tr>
          <tr><th>Residual vs live</th><td>${usd(snap.window.residual_usdc)}</td></tr>
          <tr><th>ROI on implied open ${usd(snap.roi.implied_true_open_usdc)}</th><td class="neg">${pct(snap.roi.period_roi_on_implied_open)}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="defer">
      <h2>Flywheel model (not observed)</h2>
      <p class="sub">If working capital compounded weekly for 12 weeks. Hypothesis only — Abraham test, do not treat as forecast.</p>
      <table><thead><tr><th>Scenario</th><th>Future USDC</th></tr></thead><tbody>${fly}</tbody></table>
    </section>

    <section class="defer">
      <h2>Auto-webhook ledger</h2>
      <p class="sub">POST <code>/webhooks/treasury</code> (Alchemy ADDRESS_ACTIVITY or <code>{direction,asset,amount}</code>). Optional header <code>X-Treasury-Hook</code>.</p>
      <table>
        <thead><tr><th>Time</th><th>Source</th><th>Dir</th><th>Asset</th><th>Amount</th><th>Tx</th></tr></thead>
        <tbody>${ledger}</tbody>
      </table>
    </section>

    <section class="defer">
      <h2>Assumptions</h2>
      <ul>${snap.assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
      <p><a href="/api/cashflow">JSON</a> · <a href="/hot-fund">Fund HOT (100 USDC Base)</a> · <a href="/">x402 tiers</a></p>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
