/** HTTPS Alchemy Base RPC (or x402 gateway). */
export function isAllowedAlchemyRpcUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (
      url.hostname === 'x402.alchemy.com' ||
      url.hostname.endsWith('.g.alchemy.com')
    );
  } catch {
    return false;
  }
}

/** CDP Node Base mainnet: https://api.developer.coinbase.com/rpc/v1/base/<token> */
export function isAllowedCdpBaseRpcUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && url.hostname === 'api.developer.coinbase.com'
      && url.pathname.startsWith('/rpc/v1/base/')
      && url.pathname.length > '/rpc/v1/base/'.length;
  } catch {
    return false;
  }
}
