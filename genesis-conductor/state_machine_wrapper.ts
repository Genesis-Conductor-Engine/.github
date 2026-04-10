/**
 * Genesis Conductor — State Machine Wrapper
 * Thermodynamic profitability gate + atomic QFLOP wrap execution
 *
 * BUG001 FIX: provider declared at module scope (was undefined)
 * BUG002 FIX: evaluateState() called with await (was silent fire-and-forget)
 * BUG003 FIX: executeAtomicWrap() fully implemented with ethers.Contract
 * BUG004 FIX: ETH/WEI naming consistent — all raw BigInt vars suffixed _wei, all display vars _eth
 */

import { ethers } from "ethers";
// @ts-ignore — .mjs shared module
import { getGasPrice } from "./lib/gas-oracle.mjs";

// ── Constants (Conductor's Handbook v1.0) ──────────────────────────────────
const WQFLOP_ETH_PER_QFLOP   = 6e-9;          // 6x10^-9 ETH per QFLOP
const FEE_RATE                = 0.01;           // 1% fee capture
const SAFETY_MARGIN           = 1.5;            // feeCaptureETH >= gasCost x 1.5
const ESTIMATED_GAS_LIMIT     = 150_000n;       // gas units per wrap tx
const SIGNAL_THRESHOLD        = 1_500_000;      // QFLOP — min to enter evaluation
const BATCH_TARGET            = 3_600_000;      // QFLOP — target batch size
const THERMAL_LIMIT_C         = 89.6;           // C max
const CASCADE_TRIGGER         = 0.75;           // tension_gradient threshold

// ── BUG001 FIX: Provider declared at module scope ─────────────────────────
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";
const L2_RPC_URL = process.env.L2_RPC_URL;
if (!L2_RPC_URL) throw new Error("L2_RPC_URL env var required");

const provider = new ethers.JsonRpcProvider(L2_RPC_URL);  // was undefined

// ── Signer + Contract (for executeAtomicWrap) ─────────────────────────────
const WALLET_PRIVATE_KEY      = process.env.WALLET_PRIVATE_KEY ?? "";
const WQFLOP_CONTRACT_ADDRESS = process.env.WQFLOP_CONTRACT_ADDRESS ?? "";

// Minimal ABI: wrap(uint256 amount) function on the wQFLOP ERC-20 contract
const WQFLOP_ABI = [
  "function wrap(uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "event Wrapped(address indexed account, uint256 amount, uint256 fee)",
];

// ── Types ─────────────────────────────────────────────────────────────────
interface D1Binding {
  prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } };
}

export interface QFLOPEvent {
  cycleId:        string;
  qflopProduced:  number;
  qflopCumulative: number;
  pendingBalance: number;   // QFLOP units pending wrap
  thermalC:       number;
  tensionGradient: number;
  timestamp:      number;
}

export interface WrapResult {
  txHash:         string;
  qflopWrapped:   number;
  feeCaptureEth:  number;   // BUG004: was feeCaptureETH mixed with WEI
  gasCostEth:     number;   // BUG004: consistent _eth suffix for display
  profitEth:      number;
  block:          number;
}

// ── State ─────────────────────────────────────────────────────────────────
type MachineState = "IDLE" | "ACCUMULATING" | "EVALUATING" | "EXECUTING" | "FAULT";

let state: MachineState    = "IDLE";
let accumulatedQflop        = 0;
let lastStateTransition     = Date.now();

// ── BUG001 FIX: verifyThermodynamicYield uses module-scope provider ────────
export async function verifyThermodynamicYield(pendingBalance: number, db?: D1Binding): Promise<boolean> {
  if (pendingBalance < SIGNAL_THRESHOLD) return false;

  // Fetch live L2 gas data via Etherscan oracle (falls back to provider.getFeeData() internally)
  const gasData        = await getGasPrice(ETHERSCAN_API_KEY, db, provider);
  const baseFee_wei    = BigInt(Math.round(gasData.fastGasPrice * 1e9));
  const gasCost_wei    = baseFee_wei * ESTIMATED_GAS_LIMIT;
  const gasCost_eth    = Number(gasCost_wei) / 1e18;  // BUG004: _eth for display

  // Thermodynamic gate: feeCaptureETH >= gasCostETH x SAFETY_MARGIN
  const feeCapture_eth = pendingBalance * WQFLOP_ETH_PER_QFLOP * FEE_RATE;  // BUG004: _eth
  const gate_open      = feeCapture_eth >= gasCost_eth * SAFETY_MARGIN;

  console.log(JSON.stringify({
    event:           "thermodynamic_gate",
    pending_qflop:   pendingBalance,
    fee_capture_eth: feeCapture_eth.toFixed(9),   // BUG004: unified naming
    gas_cost_eth:    gasCost_eth.toFixed(9),
    safety_margin:   SAFETY_MARGIN,
    gate_open,
    base_fee_gwei:   gasData.fastGasPrice,
    gas_source:      "etherscan",
  }));

  return gate_open;
}

// ── BUG002 FIX: evaluateState awaited ─────────────────────────────────────
export async function onQflopPostingDetected(event: QFLOPEvent, db?: D1Binding): Promise<void> {
  // Thermal guard
  if (event.thermalC > THERMAL_LIMIT_C) {
    console.warn(`[FAULT] Thermal limit exceeded: ${event.thermalC}C > ${THERMAL_LIMIT_C}C`);
    state = "FAULT";
    return;
  }

  accumulatedQflop += event.qflopProduced;

  if (state === "IDLE" || state === "ACCUMULATING") {
    state = accumulatedQflop >= SIGNAL_THRESHOLD ? "EVALUATING" : "ACCUMULATING";
  }

  if (state === "EVALUATING") {
    // BUG002 FIX: await added — errors now surface instead of being swallowed
    await evaluateState(event, db);  // was: evaluateState(event) — no await
  }
}

async function evaluateState(event: QFLOPEvent, db?: D1Binding): Promise<void> {
  // Seismic gate: reject if tension_gradient exceeds cascade_trigger
  if (event.tensionGradient >= CASCADE_TRIGGER) {
    console.log(`[FRACTURE] tension_gradient ${event.tensionGradient.toFixed(4)} >= ${CASCADE_TRIGGER} — holding`);
    return;
  }

  const shouldWrap = await verifyThermodynamicYield(event.pendingBalance, db);

  if (!shouldWrap) {
    console.log(`[GATE_CLOSED] pendingBalance=${event.pendingBalance} QFLOP — profitability gate blocked`);
    return;
  }

  state = "EXECUTING";
  try {
    const result = await executeAtomicWrap(event.pendingBalance, db);
    console.log(JSON.stringify({ event: "wrap_executed", ...result }));
    accumulatedQflop = Math.max(0, accumulatedQflop - event.pendingBalance);
    state = accumulatedQflop >= BATCH_TARGET ? "EVALUATING" : "ACCUMULATING";
  } catch (err) {
    console.error("[WRAP_FAILED]", err);
    state = "FAULT";
  }
}

// ── BUG003 FIX: executeAtomicWrap implemented ─────────────────────────────
export async function executeAtomicWrap(pendingBalance: number, db?: D1Binding): Promise<WrapResult> {
  if (!WALLET_PRIVATE_KEY) throw new Error("WALLET_PRIVATE_KEY env var required for live execution");
  if (!WQFLOP_CONTRACT_ADDRESS) throw new Error("WQFLOP_CONTRACT_ADDRESS env var required");

  const signer   = new ethers.Wallet(WALLET_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(WQFLOP_CONTRACT_ADDRESS, WQFLOP_ABI, signer);

  // Convert QFLOP units to contract units (1 QFLOP = 1 wQFLOP = 1e18 base units)
  const amount_wei = ethers.parseUnits(String(Math.floor(pendingBalance)), 18);  // BUG004: _wei suffix

  // Re-verify gate using Etherscan oracle (falls back to provider.getFeeData() internally)
  const gasData      = await getGasPrice(ETHERSCAN_API_KEY, db, provider);
  const baseFee_wei  = BigInt(Math.round(gasData.fastGasPrice * 1e9));        // BUG004: _wei
  const gasCost_wei  = baseFee_wei * ESTIMATED_GAS_LIMIT;                     // BUG004: _wei
  const gasCost_eth  = Number(gasCost_wei) / 1e18;                            // BUG004: _eth

  // Re-verify gate with live gas before sending tx
  const feeCapture_eth = pendingBalance * WQFLOP_ETH_PER_QFLOP * FEE_RATE;  // BUG004: _eth
  if (feeCapture_eth < gasCost_eth * SAFETY_MARGIN) {
    throw new Error(
      `Gate closed at execution time: feeCapture=${feeCapture_eth.toFixed(9)} ETH < gasCost=${gasCost_eth.toFixed(9)} ETH x ${SAFETY_MARGIN}`
    );
  }

  // Fetch provider fee data for EIP-1559 tx submission params (maxFeePerGas, maxPriorityFeePerGas)
  const feeData = await provider.getFeeData();

  const tx = await contract.wrap(amount_wei, {
    gasLimit: ESTIMATED_GAS_LIMIT,
    maxFeePerGas: feeData.maxFeePerGas ?? undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
  });

  const receipt = await tx.wait(1);  // wait 1 confirmation

  return {
    txHash:        receipt.hash,
    qflopWrapped:  pendingBalance,
    feeCaptureEth: feeCapture_eth,    // BUG004: _eth, not _ETH or feeCaptureWei
    gasCostEth:    gasCost_eth,       // BUG004: _eth
    profitEth:     feeCapture_eth - gasCost_eth,
    block:         receipt.blockNumber,
  };
}

// ── Getters ───────────────────────────────────────────────────────────────
export function getMachineState(): MachineState { return state; }
export function getAccumulatedQflop(): number   { return accumulatedQflop; }
export function resetFault(): void {
  if (state === "FAULT") { state = "IDLE"; accumulatedQflop = 0; }
}
