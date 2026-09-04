/**
 * USDC-metered ERC-4337 v0.6 UserOp sponsorship quote.
 *
 * The Worker never signs and never broadcasts. After x402 settlement it
 * validates the UserOp shape, enforces an EntryPoint deposit cap, and returns
 * a quote. Broadcasting requires an out-of-band bundler signer — not VAULT /
 * HOT / MAIN_WALLET (HOT is payTo-only; MAIN is rotated).
 */

/** Canonical ERC-4337 v0.6 EntryPoint (same address on Base 8453 as Ethereum). */
export const ENTRY_POINT_V06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

/** Default cap: 0.05 ETH. Do not fund the paymaster deposit above this from treasury. */
export const DEFAULT_DEPOSIT_CAP_WEI = 50_000_000_000_000_000n;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]*$/;
const UINT_RE = /^(0x[0-9a-fA-F]+|[0-9]+)$/;

export interface SponsorEnv {
  PAYMASTER_ADDRESS?: string;
  PAYMASTER_DEPOSIT_CAP_WEI?: string;
}

export interface UserOpV06 {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  signature: string;
}

export interface SponsorshipQuote {
  sponsorship_status: 'quoted_not_broadcast' | 'invalid_userop';
  network: 'eip155:8453';
  entry_point: string;
  paymaster: string | null;
  deposit_cap_wei: string;
  estimated_max_cost_wei: string;
  within_cap: boolean;
  worker_signs: false;
  broadcast: false;
  reason?: string;
  user_op?: UserOpV06;
}

function parseUint(v: unknown): bigint | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return BigInt(Math.floor(v));
  if (typeof v !== 'string' || !UINT_RE.test(v)) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

function parseHex(v: unknown, opts: { emptyOk?: boolean } = {}): string | null {
  if (typeof v !== 'string') return null;
  if (v === '0x' && opts.emptyOk) return v;
  if (!HEX_RE.test(v) || v.length % 2 !== 0) return null;
  return v;
}

function parseAddress(v: unknown): string | null {
  if (typeof v !== 'string' || !ADDR_RE.test(v)) return null;
  return v;
}

export function parseUserOp(input: unknown): { ok: true; userOp: UserOpV06 } | { ok: false; reason: string } {
  if (input === null || typeof input !== 'object') {
    return { ok: false, reason: 'body must be a JSON object with a v0.6 userOp' };
  }
  const raw = input as Record<string, unknown>;
  const src = (raw.userOp && typeof raw.userOp === 'object' ? raw.userOp : raw) as Record<string, unknown>;

  const sender = parseAddress(src.sender);
  if (!sender) return { ok: false, reason: 'userOp.sender must be a 20-byte address' };

  const fields = [
    'nonce',
    'callGasLimit',
    'verificationGasLimit',
    'preVerificationGas',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
  ] as const;
  const nums: Record<string, string> = {};
  for (const f of fields) {
    const n = parseUint(src[f]);
    if (n === null) return { ok: false, reason: `userOp.${f} must be a uint` };
    nums[f] = n.toString();
  }

  const initCode = parseHex(src.initCode ?? '0x', { emptyOk: true });
  const callData = parseHex(src.callData ?? '0x', { emptyOk: true });
  const paymasterAndData = parseHex(src.paymasterAndData ?? '0x', { emptyOk: true });
  const signature = parseHex(src.signature ?? '0x', { emptyOk: true });
  if (!initCode || !callData || !paymasterAndData || !signature) {
    return { ok: false, reason: 'userOp initCode/callData/paymasterAndData/signature must be even-length hex' };
  }

  return {
    ok: true,
    userOp: {
      sender,
      nonce: nums.nonce,
      initCode,
      callData,
      callGasLimit: nums.callGasLimit,
      verificationGasLimit: nums.verificationGasLimit,
      preVerificationGas: nums.preVerificationGas,
      maxFeePerGas: nums.maxFeePerGas,
      maxPriorityFeePerGas: nums.maxPriorityFeePerGas,
      paymasterAndData,
      signature,
    },
  };
}

export function estimateMaxCostWei(userOp: UserOpV06): bigint {
  const call = BigInt(userOp.callGasLimit);
  const ver = BigInt(userOp.verificationGasLimit);
  const pre = BigInt(userOp.preVerificationGas);
  const fee = BigInt(userOp.maxFeePerGas);
  return (call + ver + pre) * fee;
}

export function depositCapWei(env: SponsorEnv): bigint {
  if (!env.PAYMASTER_DEPOSIT_CAP_WEI) return DEFAULT_DEPOSIT_CAP_WEI;
  const n = parseUint(env.PAYMASTER_DEPOSIT_CAP_WEI);
  if (n === null || n <= 0n) return DEFAULT_DEPOSIT_CAP_WEI;
  return n;
}

export function quoteSponsorship(input: unknown, env: SponsorEnv = {}): SponsorshipQuote {
  const cap = depositCapWei(env);
  const paymaster = parseAddress(env.PAYMASTER_ADDRESS ?? '') ?? null;
  const parsed = parseUserOp(input);

  if (!parsed.ok) {
    return {
      sponsorship_status: 'invalid_userop',
      network: 'eip155:8453',
      entry_point: ENTRY_POINT_V06,
      paymaster,
      deposit_cap_wei: cap.toString(),
      estimated_max_cost_wei: '0',
      within_cap: false,
      worker_signs: false,
      broadcast: false,
      reason: parsed.reason,
    };
  }

  const maxCost = estimateMaxCostWei(parsed.userOp);
  const within = maxCost <= cap;
  return {
    sponsorship_status: 'quoted_not_broadcast',
    network: 'eip155:8453',
    entry_point: ENTRY_POINT_V06,
    paymaster,
    deposit_cap_wei: cap.toString(),
    estimated_max_cost_wei: maxCost.toString(),
    within_cap: within,
    worker_signs: false,
    broadcast: false,
    reason: within
      ? 'USDC settled. UserOp quoted against the 0.05 ETH default deposit cap. Worker does not sign or broadcast; fund EntryPoint.depositTo(paymaster) out of band and submit via a bundler.'
      : `estimated maxCost ${maxCost} wei exceeds deposit cap ${cap} wei`,
    user_op: parsed.userOp,
  };
}
