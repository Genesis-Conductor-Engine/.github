/**
 * Genesis Conductor — Exhaust-Wallet Runner
 * Executes wQFLOP wraps until gas wallet is drained.
 *
 * Usage:
 *   node exhaust_wallet.mjs          (uses .env defaults)
 *   GAS_RESERVE_WEI=2000000000000000 node exhaust_wallet.mjs
 *
 * Env vars (all optional — defaults set below):
 *   WALLET_PRIVATE_KEY      — signer key
 *   L2_RPC_URL              — defaults to Base mainnet public RPC
 *   WQFLOP_CONTRACT_ADDRESS — defaults to deployed contract
 *   BATCH_QFLOP             — QFLOP per wrap (default 3600000)
 *   GAS_RESERVE_WEI         — keep this much ETH as floor (default 2000000000000000 = 0.002 ETH)
 *
 * Wallet:   0x05bBe7C3713Bb9529f8307FB09620f504f2E758F (rotated 2026-03-28)
 * Contract: 0x69262A2D7c92c074729823B654fE7E4Cdb749747 (Base mainnet)
 * Treasury: 0x9545e2439c5c75d3aA723AcaC1AA6B0fa1DB6956
 */

import { ethers } from "/usr/local/lib/node_modules/ethers/lib.esm/index.js";
import { writeFileSync, appendFileSync, readFileSync, existsSync } from "fs";
import { getGasPrice } from "./lib/gas-oracle.mjs";

// ── Load .env if present ──────────────────────────────────────────────────
const envPath = new URL(".env", import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ── Config ────────────────────────────────────────────────────────────────
const L2_RPC_URL    = process.env.L2_RPC_URL              ?? "https://mainnet.base.org";
const CONTRACT_ADDR = process.env.WQFLOP_CONTRACT_ADDRESS ?? "0x69262A2D7c92c074729823B654fE7E4Cdb749747";
const PRIVATE_KEY   = process.env.WALLET_PRIVATE_KEY      ?? "";
const BATCH_QFLOP   = Number(process.env.BATCH_QFLOP      ?? 3_600_000);
const GAS_LIMIT          = 150_000n;
const GAS_RESERVE        = BigInt(process.env.GAS_RESERVE_WEI  ?? "2000000000000000"); // 0.002 ETH floor
const ETH_PRICE_USD      = 1985.15;  // used for projection output only
const ETHERSCAN_API_KEY  = process.env.ETHERSCAN_API_KEY ?? "";

const WQFLOP_ABI = [
  "function wrap(uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "event Wrapped(address indexed account, uint256 amount, uint256 fee)",
];

// ── Constants (Conductor's Handbook §2.2) ────────────────────────────────
const WQFLOP_ETH_PER_QFLOP = 6e-9;
const FEE_RATE             = 0.01;
const SAFETY_MARGIN        = 1.5;

// ── Output log ────────────────────────────────────────────────────────────
const LOG_PATH    = "./exhaust_run_log.jsonl";
const REPORT_PATH = "./exhaust_run_report.txt";

function log(obj) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
  appendFileSync(LOG_PATH, line + "\n");
  console.log(line);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!PRIVATE_KEY) {
    console.error("ERROR: WALLET_PRIVATE_KEY env var required");
    console.error("Run: WALLET_PRIVATE_KEY=0x<key> node exhaust_wallet.mjs");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(L2_RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDR, WQFLOP_ABI, wallet);

  const walletAddr = wallet.address;
  const startBalance_wei = await provider.getBalance(walletAddr);
  const startBalance_eth = Number(startBalance_wei) / 1e18;
  const network = await provider.getNetwork();

  log({
    event:          "exhaust_run_start",
    wallet:         walletAddr,
    chain_id:       network.chainId.toString(),
    start_balance_wei: startBalance_wei.toString(),
    start_balance_eth: startBalance_eth.toFixed(9),
    start_balance_usd: (startBalance_eth * ETH_PRICE_USD).toFixed(2),
    batch_qflop:    BATCH_QFLOP,
    contract:       CONTRACT_ADDR,
  });

  // ── Summary accumulators ────────────────────────────────────────────────
  let wrapCount       = 0;
  let totalQflop      = 0;
  let totalGasUsed_wei = 0n;
  let totalFeeCapture_eth = 0;
  const wrapHashes    = [];
  const startTime     = Date.now();
  let consecutiveErrors = 0;

  // ── Explicit nonce management (prevents "already known" race) ────────────
  let nonce = await provider.getTransactionCount(walletAddr, 'pending');
  log({ event: "nonce_init", nonce, wallet: walletAddr });

  // ── Wrap loop ────────────────────────────────────────────────────────────
  while (true) {
    const balance_wei = await provider.getBalance(walletAddr);
    // Use Etherscan gas oracle for gate calculation (falls back to provider.getFeeData() internally)
    const gasData      = await getGasPrice(ETHERSCAN_API_KEY, null, provider);
    const gasPrice_wei = BigInt(Math.round(gasData.fastGasPrice * 1e9));
    const gasCost_wei  = gasPrice_wei * GAS_LIMIT;
    const gasCost_eth  = Number(gasCost_wei) / 1e18;
    // Still fetch provider fee data for EIP-1559 tx submission params
    const feeData      = await provider.getFeeData();

    // Thermodynamic gate: does wrap pay for itself?
    const feeCapture_eth = BATCH_QFLOP * WQFLOP_ETH_PER_QFLOP * FEE_RATE;
    const gateOpen = feeCapture_eth >= gasCost_eth * SAFETY_MARGIN;

    if (!gateOpen) {
      log({
        event:     "gate_closed",
        reason:    `feeCapture=${feeCapture_eth.toFixed(9)} ETH < gasCost=${gasCost_eth.toFixed(9)} × ${SAFETY_MARGIN}`,
        wrap_num:  wrapCount,
        balance_eth: (Number(balance_wei) / 1e18).toFixed(9),
      });
      break;
    }

    // Insufficient gas for next wrap
    if (balance_wei < gasCost_wei + GAS_RESERVE) {
      log({
        event:       "wallet_drained",
        balance_wei: balance_wei.toString(),
        gas_needed:  (gasCost_wei + GAS_RESERVE).toString(),
        wrap_num:    wrapCount,
      });
      break;
    }

    // Execute wrap
    const amount_wei = ethers.parseUnits(String(BATCH_QFLOP), 18);
    let tx, receipt;
    try {
      tx = await contract.wrap(amount_wei, {
        gasLimit:             GAS_LIMIT,
        nonce:                nonce,
        maxFeePerGas:         feeData.maxFeePerGas    ?? undefined,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
      });
      nonce++;

      log({
        event:      "wrap_submitted",
        wrap_num:   wrapCount + 1,
        tx_hash:    tx.hash,
        qflop:      BATCH_QFLOP,
        gas_price_gwei: Number(gasPrice_wei) / 1e9,
        balance_before_eth: (Number(balance_wei) / 1e18).toFixed(9),
      });

      receipt = await tx.wait(1);

      const gasUsed_wei  = receipt.gasUsed * receipt.gasPrice;
      const gasUsed_eth  = Number(gasUsed_wei) / 1e18;

      wrapCount++;
      totalQflop          += BATCH_QFLOP;
      totalGasUsed_wei    += gasUsed_wei;
      totalFeeCapture_eth += feeCapture_eth;
      wrapHashes.push(tx.hash);

      log({
        event:          "wrap_confirmed",
        wrap_num:       wrapCount,
        tx_hash:        receipt.hash,
        block:          receipt.blockNumber,
        gas_used:       receipt.gasUsed.toString(),
        gas_used_eth:   gasUsed_eth.toFixed(9),
        fee_capture_eth: feeCapture_eth.toFixed(9),
        net_eth:        (feeCapture_eth - gasUsed_eth).toFixed(9),
        cumulative_qflop: totalQflop,
      });

    } catch (err) {
      log({ event: "wrap_error", wrap_num: wrapCount, error: err.message });
      if (err.message?.includes("insufficient funds") || err.code === "INSUFFICIENT_FUNDS") {
        log({ event: "wallet_drained_on_error", wrap_num: wrapCount });
        break;
      }
      if (err.message?.includes("already known") || err.message?.includes("nonce too low")) {
        nonce++;
        log({ event: "nonce_collision", wrap_num: wrapCount, new_nonce: nonce, action: "continuing" });
        consecutiveErrors = 0;
        continue;
      }
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        log({ event: "aborting_on_error", consecutive_errors: consecutiveErrors });
        break;
      }
      log({ event: "wrap_error_retrying", wrap_num: wrapCount, attempt: consecutiveErrors });
      await new Promise(r => setTimeout(r, 1000 * consecutiveErrors));
      continue;
    }
    consecutiveErrors = 0;

  }

  // ── Final report ─────────────────────────────────────────────────────────
  const endBalance_wei  = await provider.getBalance(walletAddr);
  const endBalance_eth  = Number(endBalance_wei) / 1e18;
  const totalGasCost_eth = Number(totalGasUsed_wei) / 1e18;
  const netProfit_eth    = totalFeeCapture_eth - totalGasCost_eth;
  const netProfit_usd    = netProfit_eth * ETH_PRICE_USD;
  const duration_min     = (Date.now() - startTime) / 60000;

  const report = `
══════════════════════════════════════════════════════
  GENESIS CONDUCTOR — EXHAUST-WALLET RUN COMPLETE
══════════════════════════════════════════════════════
  Wallet         : ${walletAddr}
  Duration       : ${duration_min.toFixed(1)} min
  ──────────────────────────────────────────────────
  Wraps executed : ${wrapCount}
  Total QFLOP    : ${totalQflop.toLocaleString()}
  ──────────────────────────────────────────────────
  Start balance  : ${startBalance_eth.toFixed(9)} ETH  ($${(startBalance_eth * ETH_PRICE_USD).toFixed(2)})
  End balance    : ${endBalance_eth.toFixed(9)} ETH  ($${(endBalance_eth * ETH_PRICE_USD).toFixed(2)})
  Gas spent      : ${totalGasCost_eth.toFixed(9)} ETH  ($${(totalGasCost_eth * ETH_PRICE_USD).toFixed(2)})
  ──────────────────────────────────────────────────
  Gross revenue  : ${totalFeeCapture_eth.toFixed(9)} ETH  ($${(totalFeeCapture_eth * ETH_PRICE_USD).toFixed(2)})
  Net profit     : ${netProfit_eth.toFixed(9)} ETH  ($${netProfit_usd.toFixed(2)})
  Margin         : ${totalFeeCapture_eth > 0 ? ((netProfit_eth / totalFeeCapture_eth) * 100).toFixed(2) : 0}%
══════════════════════════════════════════════════════
  Log            : ${LOG_PATH}
  TX hashes      : ${wrapHashes.length} wraps on Base L2
══════════════════════════════════════════════════════
`;

  console.log(report);
  writeFileSync(REPORT_PATH, report);

  log({
    event:             "exhaust_run_complete",
    wraps:             wrapCount,
    total_qflop:       totalQflop,
    gross_revenue_eth: totalFeeCapture_eth.toFixed(9),
    gas_cost_eth:      totalGasCost_eth.toFixed(9),
    net_profit_eth:    netProfit_eth.toFixed(9),
    net_profit_usd:    netProfit_usd.toFixed(2),
    margin_pct:        totalFeeCapture_eth > 0 ? ((netProfit_eth / totalFeeCapture_eth) * 100).toFixed(2) : "0",
    duration_min:      duration_min.toFixed(1),
    tx_hashes:         wrapHashes,
  });
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
