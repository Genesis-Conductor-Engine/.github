#!/usr/bin/env bash
# Auto-refuel: monitors vault + main wallet ETH on Base.
# Strategy:
#   1. Vault low, main OK → transfer ETH from main to vault
#   2. Both low, vault has USDC → swap USDC→WETH→ETH via Uniswap V3 using main wallet
#   3. All low → alert only
#
# Required env vars (never hardcode; load from .env or pass inline):
#   MAIN_PK        - private key of main wallet (0x60C4...) — for signing transactions
#
# Optional:
#   THRESHOLD_ETH  - refuel trigger per wallet (default: 0.002)
#   SWAP_USDC      - USDC atomic units to swap when both wallets low (default: 1500000 = $1.50)

set -euo pipefail

THRESHOLD="${THRESHOLD_ETH:-0.002}"
SWAP_USDC="${SWAP_USDC:-1500000}"
RPC="${BASE_RPC_URL:-https://base.llamarpc.com}"
RPC_FALLBACK="https://mainnet.base.org"
VAULT="0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8"
MAIN_WALLET="0x60C4499870f115664d7FfD8411b023DBEf3377d9"
USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
WETH="0x4200000000000000000000000000000000000006"
SWAP_ROUTER="0x2626664c2603336E57B271c5C0b26F421741e481"
POOL_FEE=500
HEALTH_URL="https://x402-paid-service.iholt.workers.dev/health/gas"
LOG="[auto-refuel $(date -u +%FT%TZ)]"

echo "$LOG checking via Worker gas health..."
HEALTH=$(curl -s "$HEALTH_URL" 2>/dev/null || echo '{"vault":"?","main":"?","low":false}')

IS_LOW=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('low') else 'false')" 2>/dev/null || echo "false")
echo "$LOG health: $HEALTH"

if [ "$IS_LOW" != "true" ]; then
  echo "$LOG wallets above threshold — nothing to do"
  exit 0
fi

# Require MAIN_PK for any action
if [ -z "${MAIN_PK:-}" ]; then
  echo "$LOG ERROR: MAIN_PK not set. Export it before running refuel." >&2
  exit 1
fi

# Get live balances via cast
get_wei() {
  cast balance "$1" --rpc-url "$RPC" 2>/dev/null || cast balance "$1" --rpc-url "$RPC_FALLBACK" 2>/dev/null || echo "0"
}
VAULT_WEI=$(get_wei "$VAULT")
MAIN_WEI=$(get_wei "$MAIN_WALLET")
THRESHOLD_WEI=$(python3 -c "print(int(float('$THRESHOLD') * 1e18))")

VAULT_LOW=$([ "$VAULT_WEI" -lt "$THRESHOLD_WEI" ] && echo "true" || echo "false")
MAIN_LOW=$([ "$MAIN_WEI" -lt "$THRESHOLD_WEI" ] && echo "true" || echo "false")

echo "$LOG vault=$(cast to-unit $VAULT_WEI ether) ETH (low=$VAULT_LOW)"
echo "$LOG main=$(cast to-unit $MAIN_WEI ether) ETH (low=$MAIN_LOW)"

# Strategy 1: vault low, main has headroom → transfer ETH main→vault
if [ "$VAULT_LOW" = "true" ] && [ "$MAIN_LOW" = "false" ]; then
  SEND=$(python3 -c "
main = $MAIN_WEI
vault = $VAULT_WEI
threshold = $THRESHOLD_WEI
# send enough to bring vault to threshold, keeping 0.0005 ETH in main
half = (main - int(5e14)) // 2
target_send = threshold - vault + int(2e14)  # add a small buffer
send = min(half, target_send)
print(max(0, send))
")
  if [ "$SEND" -gt 0 ]; then
    echo "$LOG transferring $SEND wei from main → vault..."
    cast send --private-key "$MAIN_PK" --rpc-url "$RPC" \
      --value "$SEND" "$VAULT" \
      --json 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print('tx:', d.get('transactionHash'), 'status:', d.get('status'))"
  else
    echo "$LOG main doesn't have enough headroom to transfer"
  fi
fi

# Strategy 2: both wallets low + vault has USDC → swap USDC→ETH using main wallet key
if [ "$VAULT_LOW" = "true" ] && [ "$MAIN_LOW" = "true" ]; then
  USDC_BAL=$(cast call "$USDC" "balanceOf(address)(uint256)" "$MAIN_WALLET" --rpc-url "$RPC" 2>/dev/null || echo "0")
  echo "$LOG both wallets low. main USDC: $USDC_BAL atomic"

  if [ "$USDC_BAL" -ge "$SWAP_USDC" ]; then
    echo "$LOG swapping $SWAP_USDC USDC → ETH via Uniswap V3..."
    DEADLINE=$(python3 -c "import time; print(int(time.time()) + 120)")

    # Approve USDC
    cast send --private-key "$MAIN_PK" --rpc-url "$RPC" \
      "$USDC" "approve(address,uint256)(bool)" "$SWAP_ROUTER" "$SWAP_USDC" \
      --gas-limit 60000 --json 2>&1 | grep -E '"transactionHash"|"status"'

    # Swap: exactInputSingle USDC→WETH
    cast send --private-key "$MAIN_PK" --rpc-url "$RPC" \
      "$SWAP_ROUTER" \
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))(uint256)" \
      "($USDC,$WETH,$POOL_FEE,$MAIN_WALLET,$SWAP_USDC,0,0)" \
      --gas-limit 200000 --json 2>&1 | grep -E '"transactionHash"|"status"'

    # Unwrap WETH
    WETH_BAL=$(cast call "$WETH" "balanceOf(address)(uint256)" "$MAIN_WALLET" --rpc-url "$RPC" 2>/dev/null || echo "0")
    if [ "$WETH_BAL" -gt 0 ]; then
      cast send --private-key "$MAIN_PK" --rpc-url "$RPC" \
        "$WETH" "withdraw(uint256)" "$WETH_BAL" \
        --gas-limit 60000 --json 2>&1 | grep -E '"transactionHash"|"status"'
    fi
  else
    echo "$LOG WARN: both wallets low and insufficient USDC ($USDC_BAL < $SWAP_USDC). Manual action needed." >&2
  fi
fi

echo "$LOG done. Final balances:"
echo "  vault: $(cast to-unit "$(get_wei $VAULT)" ether) ETH"
echo "  main:  $(cast to-unit "$(get_wei $MAIN_WALLET)" ether) ETH"
