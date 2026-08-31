import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  FLEET,
  SETTLEMENT_USDC_CHAINS,
  SETTLEMENT_WINDOW,
  SNAPSHOT_KEY,
  USDC_ARB,
  USDC_BASE,
  USDC_ETH,
  VENDORS,
  appendLedger,
  buildCashflowHtml,
  computeRoi,
  parseDexPoolCount,
  parseDexTokenPrice,
  parseWebhook,
  refreshSnapshot,
  resolveCashflowSnapshot,
  sumChainUsdc,
  type CashflowSnapshot,
} from './cashflow';

describe('settlement multichain USDC', () => {
  it('lists native USDC on Ethereum, Base, and Arbitrum for the CSW', () => {
    expect(SETTLEMENT_USDC_CHAINS.map((c) => c.id)).toEqual(['base', 'ethereum', 'arbitrum']);
    expect(SETTLEMENT_USDC_CHAINS.find((c) => c.id === 'base')?.token).toBe(USDC_BASE);
    expect(SETTLEMENT_USDC_CHAINS.find((c) => c.id === 'ethereum')?.token).toBe(USDC_ETH);
    expect(SETTLEMENT_USDC_CHAINS.find((c) => c.id === 'arbitrum')?.token).toBe(USDC_ARB);
    expect(FLEET.find((w) => w.id === 'settlement')?.address).toBe(
      '0x937897fe19F675c96a71078820F21cA9bD637180',
    );
  });

  it('sums per-chain USDC into working capital', () => {
    expect(sumChainUsdc([
      { usdc: 53651.098082 },
      { usdc: 106863.872238 },
      { usdc: 54437.421675 },
    ])).toBeCloseTo(214952.391995, 6);
    expect(sumChainUsdc([{ usdc: Number.NaN }, { usdc: 1 }])).toBe(1);
  });
});

describe('computeRoi', () => {
  it('matches the settlement window identities and negative observed ROI', () => {
    const roi = computeRoi(SETTLEMENT_WINDOW.live_close_usdc);
    expect(roi.period_net_usdc).toBe(SETTLEMENT_WINDOW.net_usdc);
    expect(roi.period_roi_on_prose_open).toBeCloseTo(
      SETTLEMENT_WINDOW.net_usdc / SETTLEMENT_WINDOW.opening_prose_usdc,
      8,
    );
    expect(roi.implied_true_open_usdc).toBeCloseTo(
      SETTLEMENT_WINDOW.opening_prose_usdc + SETTLEMENT_WINDOW.residual_usdc,
      6,
    );
    expect(roi.period_roi_on_implied_open).toBeLessThan(0);
    expect(roi.flywheel).toHaveLength(3);
    expect(roi.flywheel[1].future_usdc).toBeGreaterThan(roi.working_capital_usdc);
  });
});

describe('parseWebhook', () => {
  it('classifies Alchemy ADDRESS_ACTIVITY against the fleet', () => {
    const settlement = FLEET.find((w) => w.id === 'settlement')!.address;
    const events = parseWebhook({
      type: 'ADDRESS_ACTIVITY',
      event: {
        activity: [
          { fromAddress: settlement, toAddress: '0x44b86c7200000000000000000000000000000001', value: 99.7, asset: 'USDC', hash: '0xabc', category: 'token' },
          { fromAddress: '0x1111111111111111111111111111111111111111', toAddress: settlement, value: 10, asset: 'USDC', hash: '0xdef', category: 'token' },
        ],
      },
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ source: 'alchemy', direction: 'out', amount: 99.7, asset: 'USDC' });
    expect(events[1]).toMatchObject({ direction: 'in', amount: 10 });
  });

  it('accepts the generic treasury event shape', () => {
    const events = parseWebhook({
      source: 'manual',
      direction: 'out',
      asset: 'USDC',
      amount: 25,
      note: 'alchemy invoice placeholder',
    });
    expect(events).toEqual([expect.objectContaining({ direction: 'out', amount: 25, source: 'manual' })]);
  });

  it('records gas_low alerts from the existing cron webhook', () => {
    const events = parseWebhook({
      alert: 'gas_low',
      vault: '0.000000 ETH',
      main: '0.000001 ETH',
      threshold: '0.002000 ETH',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'gas_monitor', asset: 'ETH', direction: 'out' });
    expect(events[0].note).toContain('gas_low');
  });

  it('returns empty for unknown payloads', () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ hello: true })).toEqual([]);
  });
});

describe('appendLedger', () => {
  it('prepends events and caps length', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
    };
    const first = await appendLedger(kv, [{
      ts: '2026-08-15T00:00:00Z', source: 't', direction: 'in', asset: 'USDC', amount: 1,
    }]);
    expect(first).toHaveLength(1);
    const many = Array.from({ length: 250 }, (_, i) => ({
      ts: `2026-08-15T00:00:${String(i).padStart(2, '0')}Z`,
      source: 't',
      direction: 'in' as const,
      asset: 'USDC',
      amount: i,
    }));
    const next = await appendLedger(kv, many);
    expect(next).toHaveLength(200);
    expect(next[0].amount).toBe(0);
  });
});

describe('DexPaprika parsers', () => {
  it('reads price_usd from summary and ignores missing marks', () => {
    expect(parseDexTokenPrice({ summary: { price_usd: 1877.4 } })).toBeCloseTo(1877.4);
    expect(parseDexTokenPrice({ symbol: 'wQFLOP', summary: { price_usd: null } })).toBeNull();
    expect(parseDexTokenPrice(null)).toBeNull();
    expect(parseDexTokenPrice({ price_usd: 12 })).toBeCloseTo(12);
  });

  it('counts DexPaprika search results as pools', () => {
    expect(parseDexPoolCount({ results: [{ id: 'a' }, { id: 'b' }] })).toBe(2);
    expect(parseDexPoolCount({ results: [] })).toBe(0);
    expect(parseDexPoolCount({ pools: [{ id: 'legacy' }] })).toBe(1);
    expect(parseDexPoolCount(null)).toBe(0);
  });
});

describe('resolveCashflowSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function memoryKv(seed?: Record<string, string>) {
    const store = new Map<string, string>(Object.entries(seed ?? {}));
    return {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
    };
  }

  function seededSnap(): CashflowSnapshot {
    return {
      generated_at: '2026-08-15T12:00:00.000Z',
      eth_usd: 1800,
      wallets: [],
      priced_usd: 81993.9,
      working_capital_usdc: 53743.74,
      window: SETTLEMENT_WINDOW,
      roi: computeRoi(53743.74),
      vendors: [...VENDORS],
      ledger: [],
      assumptions: ['seed'],
      freshness: 'live',
      marks: {
        eth_source: 'coinpaprika',
        wqflop: { priced: false, price_usd: null, liquidity_usd: null, pools: 0, note: 'seed' },
      },
    };
  }

  it('keeps last-known Arb USDC when this refresh decodes 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('dexpaprika') || url.includes('coinpaprika')) {
        return Response.json({ quotes: { USD: { price: 1800 } }, summary: { price_usd: 1800 }, results: [] });
      }
      const body = String(init?.body ?? '{}');
      const to = (() => {
        try { return (JSON.parse(body) as { params?: { to?: string }[] }).params?.[0]?.to; } catch { return undefined; }
      })();
      if (to && to.toLowerCase() === USDC_ARB.toLowerCase()) {
        return Response.json({ result: '0x0' });
      }
      if (to && to.toLowerCase() === USDC_BASE.toLowerCase()) {
        return Response.json({ result: '0x' + (53651_098082).toString(16) });
      }
      if (to && to.toLowerCase() === USDC_ETH.toLowerCase()) {
        return Response.json({ result: '0x' + (106863_872238).toString(16) });
      }
      return Response.json({ result: '0x0' });
    }));
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
    };
    await kv.put(SNAPSHOT_KEY, JSON.stringify({
      ...seededSnap(),
      wallets: [{
        id: 'settlement',
        role: 's',
        address: FLEET.find((w) => w.id === 'settlement')!.address,
        eth: 0,
        usdc: 214952.391995,
        usd: 214952.391995,
        chains: [
          { id: 'base', name: 'Base', usdc: 1 },
          { id: 'ethereum', name: 'Ethereum', usdc: 1 },
          { id: 'arbitrum', name: 'Arbitrum', usdc: 54437.421675 },
        ],
      }],
    }));
    const snap = await refreshSnapshot(kv, 'https://mainnet.base.org');
    const settlement = snap.wallets.find((w) => w.id === 'settlement');
    expect(settlement?.chains?.find((c) => c.id === 'arbitrum')?.usdc).toBeCloseTo(54437.421675, 4);
  });

  it('returns the KV snapshot immediately and refreshes in the background', async () => {
    const kv = memoryKv({ [SNAPSHOT_KEY]: JSON.stringify(seededSnap()) });
    const waitUntil = vi.fn();
    const { snap, cache } = await resolveCashflowSnapshot(kv, 'https://mainnet.base.org', waitUntil);
    expect(cache).toBe('hit');
    expect(snap.freshness).toBe('cached');
    expect(snap.generated_at).toBe('2026-08-15T12:00:00.000Z');
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('misses cache when no priced snapshot exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('dexpaprika.com') && url.includes('tokens/0x4200')) {
        return Response.json({ summary: { price_usd: 1900 } });
      }
      if (url.includes('dexpaprika.com')) {
        return Response.json({ summary: { price_usd: null }, results: [] });
      }
      if (url.includes('coinpaprika')) {
        return Response.json({ quotes: { USD: { price: 1910 } } });
      }
      return Response.json({ result: '0x0' });
    }));
    const { snap, cache } = await resolveCashflowSnapshot(memoryKv(), 'https://mainnet.base.org');
    expect(cache).toBe('miss');
    expect(snap.freshness).toBe('live');
    expect(snap.eth_usd).toBe(1900);
    expect(snap.marks.eth_source).toBe('dexpaprika');
    expect(snap.marks.wqflop.priced).toBe(false);
    expect(snap.marks.wqflop.pools).toBe(0);
  });
});

describe('buildCashflowHtml LCP', () => {
  it('marks the h1 as the LCP element and defers below-fold sections', () => {
    const html = buildCashflowHtml({
      generated_at: '2026-08-15T12:00:00.000Z',
      eth_usd: 1800,
      wallets: [],
      priced_usd: 1,
      working_capital_usdc: 1,
      window: SETTLEMENT_WINDOW,
      roi: computeRoi(1),
      vendors: [...VENDORS],
      ledger: [],
      assumptions: ['x402 payTo is HOT 0x60C4'],
      freshness: 'cached',
      marks: {
        eth_source: 'dexpaprika',
        wqflop: { priced: false, price_usd: null, liquidity_usd: null, pools: 0, note: 'unpriced' },
      },
    }, 'cashflow.genesisconductor.io');
    expect(html).toContain('id="lcp"');
    expect(html).toContain('content-visibility: auto');
    expect(html).toContain('cached');
    expect(html).toContain('wQFLOP');
    expect(html).not.toContain('0x7cb8');
  });

  it('renders Ethereum / Base / Arbitrum USDC on the settlement card', () => {
    const html = buildCashflowHtml({
      generated_at: '2026-08-15T20:00:00.000Z',
      eth_usd: 1800,
      wallets: [{
        id: 'settlement',
        role: 'Settlement / working capital (CSW, ETH+Base+Arb)',
        address: '0x937897fe19F675c96a71078820F21cA9bD637180',
        eth: 0,
        usdc: 214952.391995,
        usd: 214952.391995,
        chains: [
          { id: 'base', name: 'Base', usdc: 53651.098082 },
          { id: 'ethereum', name: 'Ethereum', usdc: 106863.872238 },
          { id: 'arbitrum', name: 'Arbitrum', usdc: 54437.421675 },
        ],
      }],
      priced_usd: 214952.391995,
      working_capital_usdc: 214952.391995,
      window: SETTLEMENT_WINDOW,
      roi: computeRoi(214952.391995),
      vendors: [...VENDORS],
      ledger: [],
      assumptions: ['Working capital sums native USDC on Ethereum + Base + Arbitrum'],
      freshness: 'live',
      marks: {
        eth_source: 'fallback',
        wqflop: { priced: false, price_usd: null, liquidity_usd: null, pools: 0, note: 'n/a' },
      },
    }, 'cashflow.genesisconductor.io');
    expect(html).toContain('Ethereum USDC');
    expect(html).toContain('Base USDC');
    expect(html).toContain('Arbitrum USDC');
    expect(html).toContain('106,863.87');
  });
});
