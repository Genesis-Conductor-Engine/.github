/**
 * Internal cashflow / ROI surface.
 * Balances are public on-chain facts. Window PnL comes from the
 * 2026-08-09..2026-08-15 settlement USDC report. Vendor lines are
 * status, not invented invoices.
 */

export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const PUBLIC_BASE_RPC = 'https://mainnet.base.org';
export const SNAPSHOT_KEY = 'cashflow:snapshot';
export const LEDGER_KEY = 'cashflow:ledger';
export const LEDGER_MAX = 200;

export const FLEET = [
  { id: 'treasury', role: 'Root treasury (locked)', address: '0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75' },
  { id: 'settlement', role: 'Settlement / working capital', address: '0x937897fe19F675c96a71078820F21cA9bD637180' },
  { id: 'hot', role: 'HOT_X402 / LP owner', address: '0x60C4499870f115664d7FfD8411b023DBEf3377d9' },
  { id: 'payto', role: 'x402 VAULT_ADDRESS (payTo)', address: '0x7cb8D8C5Acfa704Fc5e37880CAA05dff71a57261' },
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
    status: 'unsettled_capacity',
    category: 'opex_rpc',
    note: 'Monthly compute-unit cap exceeded 2026-08-15 (HTTP 429). Gas monitor already falls back to BASE_RPC_URL. Invoice must be paid in the Alchemy billing UI — no on-chain payTo is published.',
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

export interface WalletSnap {
  id: string;
  role: string;
  address: string;
  eth: number;
  usdc: number;
  usd: number;
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

export async function fetchEthUsd(): Promise<number> {
  const resp = await fetch('https://api.coinpaprika.com/v1/tickers/eth-ethereum', {
    headers: { 'User-Agent': 'gc-cashflow/1.0' },
  });
  if (!resp.ok) throw new Error(`eth price http ${resp.status}`);
  const json = (await resp.json()) as { quotes?: { USD?: { price?: number } } };
  const price = json.quotes?.USD?.price;
  if (!price) throw new Error('eth price missing');
  return price;
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
  let ethUsd = 1877.49;
  try {
    ethUsd = await fetchEthUsd();
  } catch {
    // keep last-known mark
  }

  const rpcUrls = [...new Set([rpcUrl, PUBLIC_BASE_RPC, 'https://1rpc.io/base'])];
  const wallets: WalletSnap[] = [];
  for (const w of FLEET) {
    let eth = 0;
    let usdc = 0;
    try {
      const rawEth = await rpcFirst(rpcUrls, 'eth_getBalance', [w.address, 'latest']);
      eth = Number(BigInt(rawEth)) / 1e18;
    } catch { /* leave 0 */ }
    try {
      const data = `0x70a08231${padAddr(w.address)}`;
      const rawUsdc = await rpcFirst(rpcUrls, 'eth_call', [{ to: USDC_BASE, data }, 'latest']);
      usdc = Number(BigInt(rawUsdc)) / 1e6;
    } catch { /* leave 0 */ }
    wallets.push({
      id: w.id,
      role: w.role,
      address: w.address,
      eth,
      usdc,
      usd: eth * ethUsd + usdc,
    });
  }

  const rpcLive = wallets.some((w) => w.eth > 0 || w.usdc > 0);
  if (!rpcLive) {
    const prior = await loadSnapshot(kv);
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
    const stale: Record<string, { eth: number; usdc: number }> = {
      treasury: { eth: 14.666775, usdc: 709.662404 },
      settlement: { eth: 0, usdc: 54526.833194 },
      hot: { eth: 0.000001068, usdc: 0.037103 },
      payto: { eth: 0, usdc: 0 },
      main: { eth: 0, usdc: 0 },
    };
    for (const w of wallets) {
      const s = stale[w.id];
      if (!s) continue;
      w.eth = s.eth;
      w.usdc = s.usdc;
      w.usd = s.eth * ethUsd + s.usdc;
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
    assumptions: [
      ...(rpcLive ? [] : ['RPC degraded: Operator-verified 2026-08-15 snapshot used for balances (Alchemy 429 / public Base RPC blocked from Worker).']),
      'ETH mark: CoinPaprika spot (fallback 1877.49 if fetch fails).',
      'USDC = $1. wQFLOP / LP tokens are unpriced and excluded.',
      'Window PnL is settlement-wallet USDC only (Dune 2026-08-09..15).',
      'Opening 61,745 is prose; residual +2,436.73 implies a higher true open.',
      'Flywheel rates are models, not observed returns.',
      'Alchemy invoice amount unknown — status unsettled_capacity, not a dollar payable we can settle on-chain.',
      'x402 payTo (0x7cb8…) is a different address than settlement working capital (0x9378…).',
    ],
  };
  if (kv) await kv.put(SNAPSHOT_KEY, JSON.stringify(snap));
  return snap;
}

export function buildCashflowHtml(snap: CashflowSnapshot, hostname: string): string {
  const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const num = (n: number, d = 4) => n.toLocaleString('en-US', { maximumFractionDigits: d });
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const rows = snap.wallets.map((w) => `
    <article class="card">
      <h3>${escapeHtml(w.role)}</h3>
      <p class="addr"><code>${w.address}</code></p>
      <dl>
        <div><dt>ETH</dt><dd>${num(w.eth, 6)}</dd></div>
        <div><dt>USDC</dt><dd>${num(w.usdc, 2)}</dd></div>
        <div><dt>USD</dt><dd>${usd(w.usd)}</dd></div>
      </dl>
    </article>`).join('');
  const vendorRows = snap.vendors.map((v) => `
    <tr>
      <td>${escapeHtml(v.name)}</td>
      <td><span class="pill warn">${escapeHtml(v.status)}</span></td>
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
    .pill { padding:.1rem .45rem; border-radius: 999px; background: #3a2e10; color: var(--warn); font-size:.8rem; }
    a { color: #8cb4ff; }
    section { margin: 1.6rem 0; }
  </style>
</head>
<body>
  <header>
    <h1>Internal cashflow &amp; ROI</h1>
    <p class="sub">Generated ${escapeHtml(snap.generated_at)} · ETH ${usd(snap.eth_usd)} · host ${escapeHtml(hostname)}</p>
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

    <section>
      <h2>Vendor settlement</h2>
      <table>
        <thead><tr><th>Vendor</th><th>Status</th><th>Amount</th><th>Notes</th></tr></thead>
        <tbody>${vendorRows}</tbody>
      </table>
    </section>

    <section>
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

    <section>
      <h2>Flywheel model (not observed)</h2>
      <p class="sub">If working capital compounded weekly for 12 weeks. Hypothesis only — Abraham test, do not treat as forecast.</p>
      <table><thead><tr><th>Scenario</th><th>Future USDC</th></tr></thead><tbody>${fly}</tbody></table>
    </section>

    <section>
      <h2>Auto-webhook ledger</h2>
      <p class="sub">POST <code>/webhooks/treasury</code> (Alchemy ADDRESS_ACTIVITY or <code>{direction,asset,amount}</code>). Optional header <code>X-Treasury-Hook</code>.</p>
      <table>
        <thead><tr><th>Time</th><th>Source</th><th>Dir</th><th>Asset</th><th>Amount</th><th>Tx</th></tr></thead>
        <tbody>${ledger}</tbody>
      </table>
    </section>

    <section>
      <h2>Assumptions</h2>
      <ul>${snap.assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
      <p><a href="/api/cashflow">JSON</a> · <a href="/">x402 tiers</a></p>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
