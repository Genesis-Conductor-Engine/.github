import { afterEach, describe, expect, it, vi } from 'vitest';
import { fleetUsdcLogSubscribe, alchemyHttps, alchemyWss } from './urls';
import { probeAlchemySurfaces } from './client';

describe('alchemy urls', () => {
  it('builds https and wss without leaking into the key assertion', () => {
    expect(alchemyHttps('base-mainnet', 'test-key')).toBe(
      'https://base-mainnet.g.alchemy.com/v2/test-key',
    );
    expect(alchemyWss('solana-mainnet', 'test-key')).toBe(
      'wss://solana-mainnet.g.alchemy.com/v2/test-key',
    );
    expect(() => alchemyHttps('base-mainnet', '')).toThrow(/ALCHEMY_API_KEY/);
  });

  it('builds a fleet USDC log subscribe (not a network-wide pending swarm)', () => {
    const sub = fleetUsdcLogSubscribe(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      ['0x60C4499870f115664d7FfD8411b023DBEf3377d9'],
    );
    expect(sub.method).toBe('eth_subscribe');
    expect(sub.params[0]).toBe('logs');
    expect(sub.addresses[0]).toBe('0x60c4499870f115664d7ffd8411b023dbef3377d9');
  });
});

describe('probeAlchemySurfaces', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fails closed when the key is missing', async () => {
    const report = await probeAlchemySurfaces(undefined, '0x60C4499870f115664d7FfD8411b023DBEf3377d9');
    expect(report.ok).toBe(false);
    expect(report.key_configured).toBe(false);
  });

  it('marks each live surface from mocked Alchemy responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (() => {
        try {
          return (JSON.parse(String(init?.body ?? '{}')) as { method?: string }).method;
        } catch {
          return undefined;
        }
      })();
      if (url.includes('/nft/v3/')) {
        return Response.json({ ownedNfts: [] });
      }
      if (url.includes('/assets/tokens/by-address')) {
        return Response.json({ data: { tokens: [] } });
      }
      if (method === 'eth_blockNumber') return Response.json({ result: '0x1' });
      if (method === 'alchemy_getTokenBalances') return Response.json({ result: { tokenBalances: [] } });
      if (method === 'alchemy_getAssetTransfers') return Response.json({ result: { transfers: [] } });
      if (method === 'getHealth') return Response.json({ result: 'ok' });
      if (method === 'getSlot') return Response.json({ result: 123 });
      return Response.json({ result: null });
    }));
    const report = await probeAlchemySurfaces('test-key', '0x60C4499870f115664d7FfD8411b023DBEf3377d9');
    expect(report.key_configured).toBe(true);
    expect(report.ok).toBe(true);
    const names = report.probes.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining([
      'rollup_rpc:eth-mainnet',
      'rollup_rpc:base-mainnet',
      'rollup_rpc:arb-mainnet',
      'token_api',
      'transfers_api',
      'nft_api',
      'portfolio_api',
      'solana_rpc',
      'solana_slot',
      'swarm_wss',
      'webhooks',
    ]));
    expect(JSON.stringify(report)).not.toContain('test-key');
  });
});
