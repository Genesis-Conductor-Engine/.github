/**
 * wQFLOP → USDC swap routing via Aerodrome and Uniswap V3 on Base.
 *
 * Two paths:
 *   Direct:  wQFLOP → USDC  (if Aerodrome or UniV3 pool exists)
 *   2-hop:   wQFLOP → WETH → USDC  (Aerodrome for illiquid leg, UniV3 for liquid leg)
 *
 * Also exposes pool-creation helpers so liquidity can be seeded.
 */

// ── Base mainnet addresses ──────────────────────────────────────────
export const WQFLOP = '0x69262A2D7c92C074729823b654fe7e4cdb749747' as const;
export const USDC   = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
export const WETH   = '0x4200000000000000000000000000000000000006' as const;

export const AERO_ROUTER  = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1bEB874E43' as const;
export const AERO_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' as const;

export const UNIV3_ROUTER  = '0x2626664c2603336E57B271c5C0b26F421741e481' as const;
export const UNIV3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' as const;

export const BASE_CHAIN_ID = 8453;

// ── Selector helpers ────────────────────────────────────────────────

function selector(sig: string): string {
  // keccak256 of the canonical signature — we hardcode the ones we need
  const sigs: Record<string, string> = {
    'approve(address,uint256)': '0x095ea7b3',
    'balanceOf(address)': '0x70a08231',
    'allowance(address,address)': '0xdd62ed3e',
    'getPool(address,address,bool)': '0x7600135a',
    'getPool(address,address,uint24)': '0x1698ee82',
    'createPool(address,address,bool)': '0x36bf95a0',
    'totalSupply()': '0x18160ddd',
    'decimals()': '0x313ce567',
  };
  return sigs[sig] ?? '0x00000000';
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace('0x', '').padStart(64, '0');
}

function padUint256(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

function encodeCall(sel: string, ...args: string[]): string {
  return sel + args.join('');
}

// ── Types ───────────────────────────────────────────────────────────

export interface RpcProvider {
  call(to: string, data: string): Promise<string>;
  estimateGas(tx: { from: string; to: string; data: string; value?: string }): Promise<bigint>;
  sendTransaction?(tx: { to: string; data: string; value?: string }): Promise<string>;
}

export interface PoolStatus {
  exists: boolean;
  address: string;
  dex: 'aerodrome' | 'uniswapV3' | 'none';
  fee?: number; // UniV3 fee tier
}

export interface SwapRoute {
  path: 'direct-aero' | 'direct-univ3' | '2hop-aero-univ3' | 'none';
  pools: PoolStatus[];
  calldata?: string;
  to?: string;
  estimatedGas?: bigint;
}

// ── Pool queries ────────────────────────────────────────────────────

export async function getAerodromePool(
  rpc: RpcProvider,
  tokenA: string,
  tokenB: string,
  stable: boolean,
): Promise<PoolStatus> {
  const data = encodeCall(
    selector('getPool(address,address,bool)'),
    padAddress(tokenA),
    padAddress(tokenB),
    padUint256(stable ? 1n : 0n),
  );
  const result = await rpc.call(AERO_FACTORY, data);
  const addr = '0x' + result.slice(-40);
  const exists = addr !== '0x' + '0'.repeat(40);
  return { exists, address: exists ? addr : '', dex: exists ? 'aerodrome' : 'none' };
}

export async function getUniV3Pool(
  rpc: RpcProvider,
  tokenA: string,
  tokenB: string,
  fee: number,
): Promise<PoolStatus> {
  const data = encodeCall(
    selector('getPool(address,address,uint24)'),
    padAddress(tokenA),
    padAddress(tokenB),
    padUint256(BigInt(fee)),
  );
  const result = await rpc.call(UNIV3_FACTORY, data);
  const addr = '0x' + result.slice(-40);
  const exists = addr !== '0x' + '0'.repeat(40);
  return { exists, address: exists ? addr : '', dex: exists ? 'uniswapV3' : 'none', fee };
}

export async function getBalance(rpc: RpcProvider, token: string, owner: string): Promise<bigint> {
  const data = encodeCall(selector('balanceOf(address)'), padAddress(owner));
  const result = await rpc.call(token, data);
  return BigInt(result);
}

// ── Route discovery ─────────────────────────────────────────────────

const UNIV3_FEE_TIERS = [500, 3000, 10000] as const;

export async function findSwapRoute(rpc: RpcProvider): Promise<SwapRoute> {
  // 1. Check direct wQFLOP→USDC pools
  const aeroDirectVolatile = await getAerodromePool(rpc, WQFLOP, USDC, false);
  if (aeroDirectVolatile.exists) {
    return { path: 'direct-aero', pools: [aeroDirectVolatile] };
  }
  const aeroDirectStable = await getAerodromePool(rpc, WQFLOP, USDC, true);
  if (aeroDirectStable.exists) {
    return { path: 'direct-aero', pools: [aeroDirectStable] };
  }

  for (const fee of UNIV3_FEE_TIERS) {
    const pool = await getUniV3Pool(rpc, WQFLOP, USDC, fee);
    if (pool.exists) return { path: 'direct-univ3', pools: [pool] };
  }

  // 2. Check 2-hop: wQFLOP→WETH (Aerodrome) then WETH→USDC (UniV3)
  const aeroWethVolatile = await getAerodromePool(rpc, WQFLOP, WETH, false);
  if (aeroWethVolatile.exists) {
    for (const fee of UNIV3_FEE_TIERS) {
      const wethUsdc = await getUniV3Pool(rpc, WETH, USDC, fee);
      if (wethUsdc.exists) {
        return { path: '2hop-aero-univ3', pools: [aeroWethVolatile, wethUsdc] };
      }
    }
  }

  // 3. Check Aerodrome wQFLOP→WETH stable
  const aeroWethStable = await getAerodromePool(rpc, WQFLOP, WETH, true);
  if (aeroWethStable.exists) {
    for (const fee of UNIV3_FEE_TIERS) {
      const wethUsdc = await getUniV3Pool(rpc, WETH, USDC, fee);
      if (wethUsdc.exists) {
        return { path: '2hop-aero-univ3', pools: [aeroWethStable, wethUsdc] };
      }
    }
  }

  // 4. Check UniV3 for both legs
  for (const fee1 of UNIV3_FEE_TIERS) {
    const leg1 = await getUniV3Pool(rpc, WQFLOP, WETH, fee1);
    if (leg1.exists) {
      for (const fee2 of UNIV3_FEE_TIERS) {
        const leg2 = await getUniV3Pool(rpc, WETH, USDC, fee2);
        if (leg2.exists) {
          return { path: '2hop-aero-univ3', pools: [leg1, leg2] };
        }
      }
    }
  }

  return { path: 'none', pools: [] };
}

// ── Calldata builders ───────────────────────────────────────────────

/** ERC-20 approve calldata */
export function buildApprove(spender: string, amount: bigint): string {
  return encodeCall(selector('approve(address,uint256)'), padAddress(spender), padUint256(amount));
}

/**
 * Aerodrome swapExactTokensForTokens calldata.
 * Routes is an array of (from, to, stable, factory) tuples.
 */
export function buildAeroSwap(
  amountIn: bigint,
  amountOutMin: bigint,
  routes: Array<{ from: string; to: string; stable: boolean }>,
  recipient: string,
  deadline: bigint,
): string {
  // swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)
  // selector: 0xcac88ea9
  const sel = '0xcac88ea9';
  const routesTuples = routes.map(r =>
    padAddress(r.from) +
    padAddress(r.to) +
    padUint256(r.stable ? 1n : 0n) +
    padAddress(AERO_FACTORY)
  );

  // ABI encode: amountIn, amountOutMin, offset-to-routes, recipient, deadline, routes.length, ...routes
  const routesOffset = padUint256(160n); // 5 * 32 bytes
  const routesLen = padUint256(BigInt(routes.length));
  const encoded = sel +
    padUint256(amountIn) +
    padUint256(amountOutMin) +
    routesOffset +
    padAddress(recipient) +
    padUint256(deadline) +
    routesLen +
    routesTuples.join('');
  return encoded;
}

/**
 * Uniswap V3 exactInputSingle calldata for a direct swap.
 */
export function buildUniV3SwapSingle(
  tokenIn: string,
  tokenOut: string,
  fee: number,
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
): string {
  // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
  // selector: 0x04e45aaf
  const sel = '0x04e45aaf';
  return sel +
    padAddress(tokenIn) +
    padAddress(tokenOut) +
    padUint256(BigInt(fee)) +
    padAddress(recipient) +
    padUint256(amountIn) +
    padUint256(amountOutMin) +
    padUint256(0n); // sqrtPriceLimitX96 = 0 (no limit)
}

/**
 * Uniswap V3 exactInput calldata for a multi-hop swap.
 * path is packed: tokenIn (20) + fee (3) + tokenMid (20) + fee (3) + tokenOut (20)
 */
export function buildUniV3SwapMultihop(
  tokenPath: string[],
  fees: number[],
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
): string {
  // exactInput((bytes,address,uint256,uint256))
  // selector: 0xb858183f
  const sel = '0xb858183f';

  // Build packed path: token0 (20 bytes) | fee0 (3 bytes) | token1 (20 bytes) | fee1 (3 bytes) | token2 (20 bytes)
  let path = '';
  for (let i = 0; i < tokenPath.length; i++) {
    path += tokenPath[i].toLowerCase().replace('0x', '');
    if (i < fees.length) {
      path += fees[i].toString(16).padStart(6, '0');
    }
  }
  const pathBytes = path;
  const pathLen = pathBytes.length / 2;

  // ABI encode struct: offset-to-path, recipient, amountIn, amountOutMin, pathLen, pathData (padded)
  const structOffset = padUint256(128n); // 4 * 32 bytes to start of dynamic data
  const pathLenHex = padUint256(BigInt(pathLen));
  const pathPadded = pathBytes.padEnd(Math.ceil(pathBytes.length / 64) * 64, '0');

  return sel +
    structOffset +
    padAddress(recipient) +
    padUint256(amountIn) +
    padUint256(amountOutMin) +
    pathLenHex +
    pathPadded;
}

// ── Pool creation (Aerodrome) ───────────────────────────────────────

export function buildAeroCreatePool(tokenA: string, tokenB: string, stable: boolean): string {
  return encodeCall(
    selector('createPool(address,address,bool)'),
    padAddress(tokenA),
    padAddress(tokenB),
    padUint256(stable ? 1n : 0n),
  );
}

/**
 * Full Aerodrome addLiquidity calldata.
 */
export function buildAeroAddLiquidity(
  tokenA: string,
  tokenB: string,
  stable: boolean,
  amountA: bigint,
  amountB: bigint,
  slippageBps: number,
  recipient: string,
  deadline: bigint,
): string {
  // addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address,uint256)
  // selector: 0x5a47ddc3
  const sel = '0x5a47ddc3';
  const minA = amountA * BigInt(10000 - slippageBps) / 10000n;
  const minB = amountB * BigInt(10000 - slippageBps) / 10000n;
  return sel +
    padAddress(tokenA) +
    padAddress(tokenB) +
    padUint256(stable ? 1n : 0n) +
    padUint256(amountA) +
    padUint256(amountB) +
    padUint256(minA) +
    padUint256(minB) +
    padAddress(recipient) +
    padUint256(deadline);
}

// ── Orchestrator ────────────────────────────────────────────────────

export interface SwapPlan {
  route: SwapRoute;
  approvals: Array<{ token: string; spender: string; amount: bigint; calldata: string }>;
  swap: { to: string; calldata: string };
}

/**
 * Build a complete swap plan: approvals + swap calldata.
 * Returns null if no route exists.
 */
export async function buildSwapPlan(
  rpc: RpcProvider,
  amountIn: bigint,
  sender: string,
  recipient: string,
): Promise<SwapPlan | null> {
  const route = await findSwapRoute(rpc);
  if (route.path === 'none') return null;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 min
  const approvals: SwapPlan['approvals'] = [];

  if (route.path === 'direct-aero') {
    const stable = false; // volatile pair for wQFLOP
    approvals.push({
      token: WQFLOP,
      spender: AERO_ROUTER,
      amount: amountIn,
      calldata: buildApprove(AERO_ROUTER, amountIn),
    });
    const swapData = buildAeroSwap(
      amountIn, 0n, // amountOutMin=0 for discovery; tighten for production
      [{ from: WQFLOP, to: USDC, stable }],
      recipient, deadline,
    );
    return { route, approvals, swap: { to: AERO_ROUTER, calldata: swapData } };
  }

  if (route.path === 'direct-univ3') {
    const fee = route.pools[0].fee!;
    approvals.push({
      token: WQFLOP,
      spender: UNIV3_ROUTER,
      amount: amountIn,
      calldata: buildApprove(UNIV3_ROUTER, amountIn),
    });
    const swapData = buildUniV3SwapSingle(WQFLOP, USDC, fee, recipient, amountIn, 0n);
    return { route, approvals, swap: { to: UNIV3_ROUTER, calldata: swapData } };
  }

  if (route.path === '2hop-aero-univ3') {
    const aeroPool = route.pools[0];
    const univ3Pool = route.pools[1];

    if (aeroPool.dex === 'aerodrome') {
      // Leg 1: wQFLOP → WETH via Aerodrome
      // Leg 2: WETH → USDC via Aerodrome (route through both in one tx)
      // Actually, Aerodrome router can handle multi-hop in one swapExactTokensForTokens
      approvals.push({
        token: WQFLOP,
        spender: AERO_ROUTER,
        amount: amountIn,
        calldata: buildApprove(AERO_ROUTER, amountIn),
      });

      // If second leg is UniV3, we need two separate swaps
      // First: wQFLOP → WETH via Aerodrome (to sender)
      // Then: WETH → USDC via UniV3 (to recipient)
      // But for simplicity, check if Aerodrome also has WETH→USDC
      const aeroWethUsdc = await getAerodromePool(rpc, WETH, USDC, false);
      if (aeroWethUsdc.exists) {
        // Both legs on Aerodrome — single tx multi-hop
        const swapData = buildAeroSwap(
          amountIn, 0n,
          [
            { from: WQFLOP, to: WETH, stable: false },
            { from: WETH, to: USDC, stable: false },
          ],
          recipient, deadline,
        );
        return { route, approvals, swap: { to: AERO_ROUTER, calldata: swapData } };
      }

      // Mixed routing: Aero leg 1, UniV3 leg 2 — needs intermediate approval
      // Swap wQFLOP→WETH on Aero (to self), then WETH→USDC on UniV3 (to recipient)
      // Return only the first leg; caller handles sequencing
      const swapData = buildAeroSwap(
        amountIn, 0n,
        [{ from: WQFLOP, to: WETH, stable: false }],
        sender, deadline,
      );
      return { route, approvals, swap: { to: AERO_ROUTER, calldata: swapData } };
    }

    // Both legs on UniV3 — use exactInput multi-hop
    approvals.push({
      token: WQFLOP,
      spender: UNIV3_ROUTER,
      amount: amountIn,
      calldata: buildApprove(UNIV3_ROUTER, amountIn),
    });
    const swapData = buildUniV3SwapMultihop(
      [WQFLOP, WETH, USDC],
      [univ3Pool.fee ?? 3000, route.pools[1].fee ?? 500],
      recipient, amountIn, 0n,
    );
    return { route, approvals, swap: { to: UNIV3_ROUTER, calldata: swapData } };
  }

  return null;
}

// ── Pool seeding plan ───────────────────────────────────────────────

export interface SeedPlan {
  createPool: { to: string; calldata: string } | null;
  approveA: { token: string; to: string; calldata: string };
  approveB: { token: string; to: string; calldata: string };
  addLiquidity: { to: string; calldata: string };
}

/**
 * Build a plan to create and seed an Aerodrome volatile pool for wQFLOP/WETH.
 * Caller provides the amounts of each token to deposit.
 */
export async function buildSeedPlan(
  rpc: RpcProvider,
  wqflopAmount: bigint,
  wethAmount: bigint,
  provider: string,
  slippageBps: number = 100, // 1%
): Promise<SeedPlan> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

  const existing = await getAerodromePool(rpc, WQFLOP, WETH, false);
  const createPool = existing.exists
    ? null
    : { to: AERO_FACTORY, calldata: buildAeroCreatePool(WQFLOP, WETH, false) };

  return {
    createPool,
    approveA: {
      token: WQFLOP,
      to: AERO_ROUTER,
      calldata: buildApprove(AERO_ROUTER, wqflopAmount),
    },
    approveB: {
      token: WETH,
      to: AERO_ROUTER,
      calldata: buildApprove(AERO_ROUTER, wethAmount),
    },
    addLiquidity: {
      to: AERO_ROUTER,
      calldata: buildAeroAddLiquidity(
        WQFLOP, WETH, false,
        wqflopAmount, wethAmount,
        slippageBps, provider, deadline,
      ),
    },
  };
}
