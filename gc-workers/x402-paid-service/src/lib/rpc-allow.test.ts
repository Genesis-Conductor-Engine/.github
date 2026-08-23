import { describe, expect, it } from 'vitest';
import { isAllowedAlchemyRpcUrl, isAllowedCdpBaseRpcUrl } from './rpc-allow';

describe('rpc allowlists', () => {
  it('accepts Alchemy g.alchemy.com and x402 gateway', () => {
    expect(isAllowedAlchemyRpcUrl('https://base-mainnet.g.alchemy.com/v2/x')).toBe(true);
    expect(isAllowedAlchemyRpcUrl('https://x402.alchemy.com/base-mainnet/v2')).toBe(true);
    expect(isAllowedAlchemyRpcUrl('https://base.llamarpc.com')).toBe(false);
  });

  it('accepts only CDP developer Base RPC host + path', () => {
    expect(isAllowedCdpBaseRpcUrl('https://api.developer.coinbase.com/rpc/v1/base/tok')).toBe(true);
    expect(isAllowedCdpBaseRpcUrl('https://api.developer.coinbase.com/rpc/v1/eth/tok')).toBe(false);
    expect(isAllowedCdpBaseRpcUrl('http://api.developer.coinbase.com/rpc/v1/base/tok')).toBe(false);
    expect(isAllowedCdpBaseRpcUrl('https://evil.example/rpc/v1/base/tok')).toBe(false);
  });
});
