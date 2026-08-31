import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMeteringReceipt,
  deliverTier,
  fetchOnchainEnrichment,
  type TierDeliveryContext,
} from './tier-delivery';

const PAYER = '0x60C4499870f115664d7FfD8411b023DBEf3377d9';
const OTHER = '0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8';

function ctx(over: Partial<TierDeliveryContext> = {}): TierDeliveryContext {
  return {
    tierPath: '/api/pro',
    body: {},
    payer: PAYER,
    amountUsd6: '1000000',
    settlementTx: '0xabc',
    alchemyKey: undefined,
    now: () => '2026-08-23T03:00:00.000Z',
    nonce: () => 'deadbeef',
    ...over,
  };
}

describe('buildMeteringReceipt', () => {
  it('records what was actually billed, not a marketing string', () => {
    const r = buildMeteringReceipt({
      tier: 'pro',
      amountUsd6: '1000000',
      units: 3,
      payer: PAYER,
      settlementTx: '0xabc',
      now: () => '2026-08-23T03:00:00.000Z',
      nonce: () => 'deadbeef',
    });
    expect(r.tier).toBe('pro');
    expect(r.units).toBe(3);
    expect(r.charged_usd6).toBe('1000000');
    expect(r.charged_usd).toBe('1.00');
    // unit price = total / units, carried at 6dp so an agent can audit it
    expect(r.unit_price_usd6).toBe('333333');
    expect(r.payer).toBe(PAYER);
    expect(r.settlement_tx).toBe('0xabc');
    expect(r.issued_at).toBe('2026-08-23T03:00:00.000Z');
    expect(r.receipt_id).toContain('deadbeef');
  });

  it('does not claim a real ETH payment was $0.00', () => {
    // requestedEth passes amountUsd6 '0'. Stating charged_usd "0.00" on a payment
    // that actually happened is the one thing a receipt must never do.
    const r = buildMeteringReceipt({
      tier: 'pro',
      amountUsd6: '0',
      units: 3,
      payer: PAYER,
      settlementTx: '0xabc',
      asset: 'ETH',
      amountRaw: '500000000000000',
      now: () => '2026-08-23T03:00:00.000Z',
      nonce: () => 'deadbeef',
    });
    expect(r.payment_asset).toBe('ETH');
    expect(r.charged_raw).toBe('500000000000000');
    // The USD fields must not assert a false zero for a non-USDC settlement.
    expect(r.charged_usd).not.toBe('0.00');
    expect(r.charged_usd).toBeNull();
    expect(r.charged_usd6).toBeNull();
  });

  it('generates a distinct receipt id even when crypto is unavailable', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      ids.add(buildMeteringReceipt({
        tier: 'pro',
        amountUsd6: '1000000',
        units: 1,
        payer: PAYER,
        settlementTx: `0x${i}`,
        now: () => `2026-08-23T03:00:0${i}.000Z`,
      }).receipt_id);
    }
    expect(ids.size).toBe(3);
  });

  it('never divides by zero when no billable units were produced', () => {
    const r = buildMeteringReceipt({
      tier: 'pro',
      amountUsd6: '1000000',
      units: 0,
      payer: PAYER,
      settlementTx: null,
      now: () => '2026-08-23T03:00:00.000Z',
      nonce: () => 'feed',
    });
    expect(r.units).toBe(0);
    expect(r.unit_price_usd6).toBe('0');
    expect(r.settlement_tx).toBeNull();
  });
});

describe('fetchOnchainEnrichment', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('degrades instead of throwing when the Alchemy key is missing', async () => {
    const out = await fetchOnchainEnrichment(undefined, PAYER);
    expect(out.degraded).toBe(true);
    expect(out.address).toBe(PAYER.toLowerCase());
    expect(out.errors.join(' ')).toMatch(/ALCHEMY_API_KEY/);
  });

  it('rejects a malformed address without making a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchOnchainEnrichment('k', 'not-an-address');
    expect(out.degraded).toBe(true);
    expect(out.errors.join(' ')).toMatch(/address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns structured balances, holdings and transfers from live surfaces', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string | undefined;
      if (method === 'eth_getBalance') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x2386f26fc10000' }));
      }
      if (method === 'alchemy_getTokenBalances') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            address: PAYER,
            tokenBalances: [
              { contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', tokenBalance: '0x1f1cd' },
              { contractAddress: '0xdead', tokenBalance: '0x0' },
            ],
          },
        }));
      }
      if (method === 'alchemy_getAssetTransfers') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            transfers: [
              { hash: '0x1', from: OTHER, to: PAYER, value: 0.5, asset: 'USDC', blockNum: '0x10' },
            ],
          },
        }));
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }));
    }));

    const out = await fetchOnchainEnrichment('test-key', PAYER);
    expect(out.degraded).toBe(false);
    expect(out.address).toBe(PAYER.toLowerCase());
    expect(out.native_balances.length).toBeGreaterThan(0);
    expect(out.native_balances[0].wei).toBe('0x2386f26fc10000');
    // zero balances are noise for a paying agent — drop them
    expect(out.token_holdings).toHaveLength(1);
    expect(out.token_holdings[0].contract_address).toBe(
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    );
    expect(out.recent_transfers).toHaveLength(1);
    expect(out.recent_transfers[0].asset).toBe('USDC');
  });

  // Pre-deploy review findings. Each of these shipped as a real defect in the
  // first cut of this module.
  it('treats a non-2xx Alchemy response as a failure, not as empty data', async () => {
    // An expired key or a quota breach returns HTTP 401/429 with a non-JSON-RPC
    // body. Previously rpc() ignored the status, found no `error.message`, and
    // reported degraded:false — the $100 tier claiming success while delivering
    // nothing.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
    ));
    const out = await fetchOnchainEnrichment('expired-key', PAYER);
    expect(out.degraded).toBe(true);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.errors.join(' ')).toMatch(/401/);
  });

  it('never reflects the Alchemy API key back to the paying caller', async () => {
    // alchemyHttps() embeds the key in the URL, and some fetch failures stringify
    // the URL. Anything echoed into errors[] goes straight to an anonymous caller.
    const SECRET = 'supersecretkey123';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`connect ECONNREFUSED ${String(input)}`);
    }));
    const out = await fetchOnchainEnrichment(SECRET, PAYER);
    expect(out.degraded).toBe(true);
    expect(out.errors.length).toBeGreaterThan(0);
    const blob = JSON.stringify(out);
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain('g.alchemy.com');
  });

  it('bounds every upstream call so a hung Alchemy cannot strand a paid request', async () => {
    // The caller has already been charged by the time this runs; an upstream that
    // never answers must not hold the response open forever.
    const seen: (AbortSignal | undefined)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }));
    }));
    await fetchOnchainEnrichment('test-key', PAYER);
    expect(seen.length).toBeGreaterThan(0);
    for (const sig of seen) expect(sig).toBeInstanceOf(AbortSignal);
  });

  it('reports partial coverage as degraded rather than as a complete answer', async () => {
    // A network that answers with neither a result nor an error message used to
    // push nothing, leaving degraded:false on an incomplete dataset.
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.method === 'eth_getBalance') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1 }));
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
    }));
    const out = await fetchOnchainEnrichment('test-key', PAYER);
    expect(out.degraded).toBe(true);
  });

  it('returns transfers in both directions, not just inbound', async () => {
    // A $100 "recent ERC-20 transfers" dataset that silently omits everything the
    // address sent is not the product that was advertised.
    const directions: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.method === 'alchemy_getAssetTransfers') {
        const p = body.params[0] ?? {};
        directions.push(p.toAddress ? 'in' : 'out');
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { transfers: [{ hash: p.toAddress ? '0xin' : '0xout', from: OTHER, to: PAYER, value: 1, asset: 'USDC', blockNum: '0x1' }] },
        }));
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }));
    }));
    const out = await fetchOnchainEnrichment('test-key', PAYER);
    expect(directions).toContain('in');
    expect(directions).toContain('out');
    expect(out.recent_transfers.map((t) => t.hash)).toEqual(
      expect.arrayContaining(['0xin', '0xout']),
    );
  });

  it('never throws when every upstream surface fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const out = await fetchOnchainEnrichment('test-key', PAYER);
    expect(out.degraded).toBe(true);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.address).toBe(PAYER.toLowerCase());
  });
});

describe('deliverTier', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('still delivers rtptpa on the $0.01 smoke-test tier', async () => {
    const d = await deliverTier(ctx({ tierPath: '/api/execute', amountUsd6: '10000' }));
    expect(d.kind).toBe('rtptpa');
    expect(d.rtptpa?.record_type).toBe('rtpTPA_arbitration');
    expect(d.result).toBe(d.rtptpa);
  });

  it('still delivers rtptpa on the inference tier', async () => {
    const d = await deliverTier(ctx({ tierPath: '/api/inference', amountUsd6: '10000000' }));
    expect(d.kind).toBe('rtptpa');
    expect(d.rtptpa?.record_type).toBe('rtpTPA_arbitration');
  });

  it('delivers real metered execution on /api/pro, not the tier description', async () => {
    const d = await deliverTier(ctx({ tierPath: '/api/pro' }));
    expect(d.kind).toBe('metered_execution');
    const result = d.result as { receipt: { tier: string; units: number }; execution: unknown };
    expect(result.receipt.tier).toBe('pro');
    expect(result.receipt.units).toBeGreaterThan(0);
    expect(result.execution).toBeTruthy();
    expect(typeof d.result).not.toBe('string');
  });

  it('delivers on-chain enrichment on /api/specialized, not the tier description', async () => {
    const d = await deliverTier(ctx({ tierPath: '/api/specialized', amountUsd6: '100000000' }));
    expect(d.kind).toBe('onchain_enrichment');
    const result = d.result as { enrichment: { address: string }; receipt: { tier: string } };
    // no Alchemy key in this ctx, so it degrades — but it must still be structured data
    expect(result.enrichment.address).toBe(PAYER.toLowerCase());
    expect(result.receipt.tier).toBe('specialized');
    expect(typeof d.result).not.toBe('string');
  });

  it('enriches a caller-supplied address instead of the payer when asked', async () => {
    const d = await deliverTier(ctx({
      tierPath: '/api/specialized',
      body: { address: OTHER },
    }));
    const result = d.result as { enrichment: { address: string } };
    expect(result.enrichment.address).toBe(OTHER.toLowerCase());
  });

  it('returns a descriptor for tiers that have no compute product', async () => {
    const d = await deliverTier(ctx({ tierPath: '/api/founders', amountUsd6: '4999000000' }));
    expect(d.kind).toBe('descriptor');
  });

  it('never throws after settlement, even on a hostile body', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const d = await deliverTier(ctx({ tierPath: '/api/pro', body: circular }));
    expect(d.kind).toBe('metered_execution');
  });
});
