/**
 * Alchemy HTTPS / WSS URL builders. The key is interpolated only at call
 * time from a secret binding — never logged, never returned to clients.
 */

export const ALCHEMY_ROLLUP_NETWORKS = [
  'eth-mainnet',
  'base-mainnet',
  'arb-mainnet',
] as const;

export type AlchemyRollupNetwork = (typeof ALCHEMY_ROLLUP_NETWORKS)[number];

export const ALCHEMY_SOLANA_NETWORK = 'solana-mainnet' as const;

export const USDC_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c1b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export function assertAlchemyKey(key: string | undefined): string {
  const k = key?.trim();
  if (!k) throw new Error('ALCHEMY_API_KEY is not configured');
  return k;
}

export function alchemyHttps(network: string, key: string): string {
  return `https://${network}.g.alchemy.com/v2/${assertAlchemyKey(key)}`;
}

export function alchemyWss(network: string, key: string): string {
  return `wss://${network}.g.alchemy.com/v2/${assertAlchemyKey(key)}`;
}

export function alchemyNftV3(network: string, key: string): string {
  return `https://${network}.g.alchemy.com/nft/v3/${assertAlchemyKey(key)}`;
}

export function alchemyDataV1(key: string): string {
  return `https://api.g.alchemy.com/data/v1/${assertAlchemyKey(key)}`;
}

export function alchemyPricesV1(key: string): string {
  return `https://api.g.alchemy.com/prices/v1/${assertAlchemyKey(key)}`;
}

/** Filtered USDC Transfer logs for a fleet of addresses (swarm, not network-wide). */
export function fleetUsdcLogSubscribe(usdc: string, addresses: string[]) {
  const topics: Array<string | null | string[]> = [USDC_TRANSFER_TOPIC];
  return {
    method: 'eth_subscribe' as const,
    params: [
      'logs',
      {
        address: usdc,
        topics,
      },
    ],
    addresses: addresses.map((a) => a.toLowerCase()),
    note: 'Client-side filter the from/to topics against the fleet; do not subscribe network-wide pending txs.',
  };
}
