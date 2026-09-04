import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  CANTON_SCHEME,
  buildCantonAccept,
  cantonPolicyAllows,
  chainsafeFacilitatorPost,
  isAllowedChainsafeFacilitatorUrl,
  resolveChainSafeConfig,
  tryDecodeCantonPaymentHeader,
  usdc6ToDecimal,
} from './chainsafe-facilitator';

const cfg = {
  url: 'https://api-x402.chainsafe.io',
  apiKey: 'sk_live_test',
  network: 'canton:1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc',
  payTo: 'xai::122015e809ced13c4b349b3c705d510c7e03ae1fcec76630c42070e25953b5782cdf',
  amuletAdmin: 'DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc',
};

describe('usdc6ToDecimal', () => {
  it('converts sticker prices used by the tiers', () => {
    expect(usdc6ToDecimal('10000')).toBe('0.01');
    expect(usdc6ToDecimal('1000000')).toBe('1');
    expect(usdc6ToDecimal('4999000000')).toBe('4999');
    expect(usdc6ToDecimal('0')).toBe('0');
  });
});

describe('resolveChainSafeConfig', () => {
  it('requires merchant party, network, amulet admin, and api key', () => {
    expect(resolveChainSafeConfig({})).toBeUndefined();
    expect(resolveChainSafeConfig({ FACILITATOR_API_KEY: 'k' })).toBeUndefined();
  });

  it('accepts the operator env names and pins the ChainSafe host', () => {
    const resolved = resolveChainSafeConfig({
      FACILITATOR_URL: 'https://api-x402.chainsafe.io/',
      FACILITATOR_API_KEY: 'sk_live_test',
      NETWORK_ID: cfg.network,
      MERCHANT_PARTY: cfg.payTo,
      AMULET_ADMIN: cfg.amuletAdmin,
    });
    expect(resolved).toMatchObject({ url: 'https://api-x402.chainsafe.io', payTo: cfg.payTo });
  });

  it('rejects a non-ChainSafe facilitator URL', () => {
    expect(isAllowedChainsafeFacilitatorUrl('https://evil.example/x402')).toBe(false);
    expect(resolveChainSafeConfig({
      FACILITATOR_URL: 'https://evil.example',
      FACILITATOR_API_KEY: 'k',
      NETWORK_ID: cfg.network,
      MERCHANT_PARTY: cfg.payTo,
      AMULET_ADMIN: cfg.amuletAdmin,
    })).toBeUndefined();
  });
});

describe('buildCantonAccept + policy', () => {
  it('emits exact-canton Amulet requirements for the merchant party', () => {
    const accept = buildCantonAccept(cfg, '10000', 'https://example/api/execute', 'exec', 1_700_000_000_000, 'nonce-1');
    expect(accept).toMatchObject({
      scheme: CANTON_SCHEME,
      network: cfg.network,
      maxAmountRequired: '0.01',
      payTo: cfg.payTo,
      nonce: 'nonce-1',
      asset: { instrumentId: { id: 'Amulet', admin: cfg.amuletAdmin } },
    });
    expect(cantonPolicyAllows(accept, accept)).toBe(true);
    expect(cantonPolicyAllows({ ...accept, maxAmountRequired: '0.001' }, accept)).toBe(false);
    expect(cantonPolicyAllows({ ...accept, payTo: 'other::1' }, accept)).toBe(false);
  });
});

describe('tryDecodeCantonPaymentHeader', () => {
  it('reads the {payment, requirements} envelope', () => {
    const requirements = buildCantonAccept(cfg, '10000', 'https://x', 'd', 0, 'n');
    const payment = { x402Version: 2, scheme: CANTON_SCHEME, network: cfg.network, payload: { payer: 'p' } };
    const header = btoa(JSON.stringify({ payment, requirements }));
    const decoded = tryDecodeCantonPaymentHeader(header);
    expect(decoded?.kind).toBe('canton');
    expect(decoded?.payload).toMatchObject({ scheme: CANTON_SCHEME });
  });

  it('rejects an EVM-shaped envelope', () => {
    const header = btoa(JSON.stringify({ x402Version: 2, payload: {}, accepted: {} }));
    expect(tryDecodeCantonPaymentHeader(header)).toBeUndefined();
  });
});

describe('chainsafeFacilitatorPost', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /v2/verify with a Bearer key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ isValid: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await chainsafeFacilitatorPost(cfg, 'verify', { x402Version: 2 }, { nonce: 'n' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api-x402.chainsafe.io/v2/verify');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer sk_live_test');
    expect(JSON.parse(String(init.body))).toMatchObject({
      x402Version: 2,
      paymentRequirements: { nonce: 'n' },
    });
  });
});
