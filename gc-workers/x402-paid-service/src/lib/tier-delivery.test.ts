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
