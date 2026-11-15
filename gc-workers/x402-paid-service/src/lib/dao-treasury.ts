/**
 * DAO-governed treasury and profitability engine.
 *
 * Three layers:
 *   1. Multi-chain revenue collection (Base USDC, Polygon USDC, Solana USDC, ETH)
 *   2. DAO parameter governance (pricing, splits, treasury ops)
 *   3. Profitability tracking (revenue vs costs, break-even, MRR)
 *
 * The DAO is lightweight and KV-backed: parameters live in Cloudflare KV
 * and are updatable by an on-chain Governor vote or admin multisig.
 * This keeps the Worker stateless while the governance layer is upgradeable.
 */

// ── Multi-chain treasury addresses ──────────────────────────────────

export const TREASURY = {
  base: {
    hot: '0x87392243E196FCa85702B74343a57973294b0e5E',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 8453,
    network: 'eip155:8453',
  },
  polygon: {
    hot: '0x87392243E196FCa85702B74343a57973294b0e5E',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    chainId: 137,
    network: 'eip155:137',
  },
  solana: {
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    network: 'solana:mainnet',
  },
} as const;

// ── DAO parameter schema ────────────────────────────────────────────

export interface DaoParams {
  version: number;
  updatedAt: string;
  updatedBy: 'admin' | 'governor' | 'multisig';

  pricing: {
    discovery: { usd6: string; ethWei: string };
    pro: { usd6: string; ethWei: string };
    inference: { usd6: string; ethWei: string };
    specialized: { usd6: string; ethWei: string };
    founders: { usd6: string; ethWei: string };
    sourceExclusive: { usd6: string; ethWei: string };
    sponsor: { usd6: string; ethWei: string };
  };

  revenueSplit: {
    treasuryBps: number;   // basis points to treasury (e.g., 7000 = 70%)
    operationsBps: number; // basis points to operations (e.g., 2000 = 20%)
    daoRewardBps: number;  // basis points to DAO token holders (e.g., 1000 = 10%)
  };

  chains: {
    base: boolean;
    polygon: boolean;
    solana: boolean;
  };

  solana: {
    treasuryTokenAccount: string;
    rpcUrl: string;
  };

  governance: {
    proposalThreshold: number;
    votingPeriodBlocks: number;
    quorumBps: number;
    timelockSeconds: number;
  };
}

export const DEFAULT_DAO_PARAMS: DaoParams = {
  version: 1,
  updatedAt: '2026-11-15T00:00:00Z',
  updatedBy: 'admin',

  pricing: {
    discovery:       { usd6: '10000',       ethWei: '5000000000000' },
    pro:             { usd6: '1000000',     ethWei: '500000000000000' },
    inference:       { usd6: '10000000',    ethWei: '5000000000000000' },
    specialized:     { usd6: '100000000',   ethWei: '50000000000000000' },
    founders:        { usd6: '4999000000',  ethWei: '2499500000000000000' },
    sourceExclusive: { usd6: '9999000000',  ethWei: '4999500000000000000' },
    sponsor:         { usd6: '100000',      ethWei: '50000000000000' },
  },

  revenueSplit: {
    treasuryBps: 7000,
    operationsBps: 2000,
    daoRewardBps: 1000,
  },

  chains: {
    base: true,
    polygon: true,
    solana: true,
  },

  solana: {
    treasuryTokenAccount: '',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  },

  governance: {
    proposalThreshold: 1000,
    votingPeriodBlocks: 50400,   // ~7 days on Base (2s blocks)
    quorumBps: 400,              // 4%
    timelockSeconds: 86400,      // 24h
  },
};

// ── KV integration ──────────────────────────────────────────────────

const DAO_PARAMS_KEY = 'dao:params:v1';

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export async function loadDaoParams(kv: KVNamespaceLike): Promise<DaoParams> {
  const raw = await kv.get(DAO_PARAMS_KEY);
  if (!raw) return DEFAULT_DAO_PARAMS;
  try {
    return JSON.parse(raw) as DaoParams;
  } catch {
    return DEFAULT_DAO_PARAMS;
  }
}

export async function saveDaoParams(
  kv: KVNamespaceLike,
  params: DaoParams,
): Promise<void> {
  await kv.put(DAO_PARAMS_KEY, JSON.stringify(params));
}

// ── Profitability model ─────────────────────────────────────────────

export interface CostStructure {
  cloudflareWorkerMonthly: number;   // $0 free tier, $5 paid
  domainAnnual: number;              // ~$10/yr
  gasPerSettlement: number;          // ~$0.001–0.01 on Base
  alchemyRpcMonthly: number;        // $0 free tier
  shopifyMonthly: number;           // $0 if using lite plan
  totalMonthly: number;
}

export interface RevenueProjection {
  tier: string;
  priceUsd: number;
  monthlyVolume: number;
  monthlyRevenue: number;
}

export interface ProfitabilityModel {
  costs: CostStructure;
  projections: RevenueProjection[];
  totalMonthlyRevenue: number;
  totalMonthlyCost: number;
  monthlyProfit: number;
  breakEvenCalls: Record<string, number>;
  annualizedRevenue: number;
  annualizedProfit: number;
}

const TIER_PRICES: Record<string, number> = {
  discovery: 0.01,
  pro: 1.00,
  inference: 10.00,
  specialized: 100.00,
  founders: 4999.00,
  sourceExclusive: 9999.00,
  sponsor: 0.10,
};

export function buildProfitabilityModel(
  monthlyVolumes: Record<string, number>,
  costs?: Partial<CostStructure>,
): ProfitabilityModel {
  const costStructure: CostStructure = {
    cloudflareWorkerMonthly: costs?.cloudflareWorkerMonthly ?? 0,
    domainAnnual: costs?.domainAnnual ?? 10,
    gasPerSettlement: costs?.gasPerSettlement ?? 0.005,
    alchemyRpcMonthly: costs?.alchemyRpcMonthly ?? 0,
    shopifyMonthly: costs?.shopifyMonthly ?? 0,
    totalMonthly: 0,
  };

  const totalCalls = Object.values(monthlyVolumes).reduce((a, b) => a + b, 0);
  costStructure.totalMonthly =
    costStructure.cloudflareWorkerMonthly +
    (costStructure.domainAnnual / 12) +
    (costStructure.gasPerSettlement * totalCalls) +
    costStructure.alchemyRpcMonthly +
    costStructure.shopifyMonthly;

  const projections: RevenueProjection[] = Object.entries(TIER_PRICES).map(
    ([tier, price]) => ({
      tier,
      priceUsd: price,
      monthlyVolume: monthlyVolumes[tier] ?? 0,
      monthlyRevenue: price * (monthlyVolumes[tier] ?? 0),
    }),
  );

  const totalMonthlyRevenue = projections.reduce((s, p) => s + p.monthlyRevenue, 0);

  const breakEvenCalls: Record<string, number> = {};
  for (const [tier, price] of Object.entries(TIER_PRICES)) {
    breakEvenCalls[tier] = price > 0
      ? Math.ceil(costStructure.totalMonthly / price)
      : Infinity;
  }

  return {
    costs: costStructure,
    projections,
    totalMonthlyRevenue,
    totalMonthlyCost: costStructure.totalMonthly,
    monthlyProfit: totalMonthlyRevenue - costStructure.totalMonthly,
    breakEvenCalls,
    annualizedRevenue: totalMonthlyRevenue * 12,
    annualizedProfit: (totalMonthlyRevenue - costStructure.totalMonthly) * 12,
  };
}

// ── Revenue split calculator ────────────────────────────────────────

export interface RevenueSplit {
  grossUsd: number;
  treasuryUsd: number;
  operationsUsd: number;
  daoRewardUsd: number;
}

export function splitRevenue(grossUsd: number, params: DaoParams): RevenueSplit {
  const { treasuryBps, operationsBps, daoRewardBps } = params.revenueSplit;
  return {
    grossUsd,
    treasuryUsd: (grossUsd * treasuryBps) / 10000,
    operationsUsd: (grossUsd * operationsBps) / 10000,
    daoRewardUsd: (grossUsd * daoRewardBps) / 10000,
  };
}

// ── Solana treasury setup ───────────────────────────────────────────

export interface SolanaRpcProvider {
  call(method: string, params: unknown[]): Promise<unknown>;
}

export async function verifySolanaTokenAccount(
  rpc: SolanaRpcProvider,
  tokenAccount: string,
  expectedMint: string,
): Promise<{ valid: boolean; balance: bigint; error?: string }> {
  try {
    const result = await rpc.call('getAccountInfo', [
      tokenAccount,
      { encoding: 'jsonParsed' },
    ]) as {
      value?: {
        data?: {
          parsed?: {
            info?: {
              mint?: string;
              tokenAmount?: { amount?: string };
            };
          };
        };
      };
    };

    const info = result?.value?.data?.parsed?.info;
    if (!info) return { valid: false, balance: 0n, error: 'Account not found' };
    if (info.mint !== expectedMint) {
      return { valid: false, balance: 0n, error: `Wrong mint: ${info.mint}` };
    }

    const balance = BigInt(info.tokenAmount?.amount ?? '0');
    return { valid: true, balance };
  } catch (e) {
    return { valid: false, balance: 0n, error: String(e) };
  }
}

// ── DAO proposal types ──────────────────────────────────────────────

export type ProposalAction =
  | { type: 'update_pricing'; tier: keyof DaoParams['pricing']; usd6: string; ethWei: string }
  | { type: 'update_split'; treasuryBps: number; operationsBps: number; daoRewardBps: number }
  | { type: 'toggle_chain'; chain: 'base' | 'polygon' | 'solana'; enabled: boolean }
  | { type: 'set_solana_treasury'; tokenAccount: string }
  | { type: 'update_governance'; field: keyof DaoParams['governance']; value: number };

export interface Proposal {
  id: string;
  proposer: string;
  actions: ProposalAction[];
  description: string;
  createdAt: string;
  votesFor: number;
  votesAgainst: number;
  status: 'pending' | 'active' | 'passed' | 'rejected' | 'executed' | 'expired';
  executionTime?: string;
}

export function applyProposalActions(
  params: DaoParams,
  actions: ProposalAction[],
): DaoParams {
  const updated = structuredClone(params);
  for (const action of actions) {
    switch (action.type) {
      case 'update_pricing':
        updated.pricing[action.tier] = { usd6: action.usd6, ethWei: action.ethWei };
        break;
      case 'update_split':
        if (action.treasuryBps + action.operationsBps + action.daoRewardBps !== 10000) {
          throw new Error('Split must sum to 10000 bps');
        }
        updated.revenueSplit = {
          treasuryBps: action.treasuryBps,
          operationsBps: action.operationsBps,
          daoRewardBps: action.daoRewardBps,
        };
        break;
      case 'toggle_chain':
        updated.chains[action.chain] = action.enabled;
        break;
      case 'set_solana_treasury':
        updated.solana.treasuryTokenAccount = action.tokenAccount;
        break;
      case 'update_governance':
        (updated.governance as Record<string, number>)[action.field] = action.value;
        break;
    }
  }
  updated.version += 1;
  updated.updatedAt = new Date().toISOString();
  updated.updatedBy = 'governor';
  return updated;
}

// ── Path to $2,184 ──────────────────────────────────────────────────

export interface AccumulationPath {
  currentUsd: number;
  targetUsd: number;
  gapUsd: number;
  scenarios: Array<{
    name: string;
    description: string;
    callsNeeded: Record<string, number>;
    timeToGoalDays: number;
  }>;
}

export function computeAccumulationPath(
  currentUsd: number,
  targetUsd: number,
): AccumulationPath {
  const gapUsd = targetUsd - currentUsd;

  return {
    currentUsd,
    targetUsd,
    gapUsd,
    scenarios: [
      {
        name: 'discovery-only',
        description: 'All revenue from $0.01 discovery calls',
        callsNeeded: { discovery: Math.ceil(gapUsd / 0.01) },
        timeToGoalDays: Math.ceil(gapUsd / 0.01 / 100), // 100 calls/day
      },
      {
        name: 'pro-mix',
        description: '10 pro calls/day + 50 discovery calls/day',
        callsNeeded: { pro: 10, discovery: 50 },
        timeToGoalDays: Math.ceil(gapUsd / (10 * 1.0 + 50 * 0.01)),
      },
      {
        name: 'inference-boost',
        description: '5 inference calls/day + 10 pro + 100 discovery',
        callsNeeded: { inference: 5, pro: 10, discovery: 100 },
        timeToGoalDays: Math.ceil(gapUsd / (5 * 10.0 + 10 * 1.0 + 100 * 0.01)),
      },
      {
        name: 'one-founder',
        description: 'Single founders license sale ($4,999)',
        callsNeeded: { founders: 1 },
        timeToGoalDays: 1,
      },
      {
        name: 'specialized-steady',
        description: '1 specialized call/day ($100)',
        callsNeeded: { specialized: 1 },
        timeToGoalDays: Math.ceil(gapUsd / 100),
      },
    ],
  };
}

// ── Scenario: realistic first-month profitability ───────────────────

export function realisticFirstMonthModel(): ProfitabilityModel {
  return buildProfitabilityModel(
    {
      discovery: 500,      // smoke tests and integration testing
      pro: 30,             // early adopters
      inference: 5,        // AI agent workloads
      specialized: 2,      // data queries
      founders: 0,         // unlikely month 1
      sourceExclusive: 0,  // unlikely month 1
      sponsor: 50,         // UserOp quotes
    },
    {
      cloudflareWorkerMonthly: 0,  // free tier
      domainAnnual: 10,
      gasPerSettlement: 0.005,
      alchemyRpcMonthly: 0,       // free tier
      shopifyMonthly: 0,
    },
  );
}
