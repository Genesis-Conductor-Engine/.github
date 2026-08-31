# Goal: wQFLOP real liquidity generation

**ID:** `goal/wqflop-liquidity-generation`  
**Status:** `not_reached`  
**Priority:** Tier 0 — capital path (feeds flywheel + revenue credibility)  
**Opened:** 2026-08-07  
**Focus parent:** SDD plan `2026-08-07-wqflop-liquidity-generation.md`

---

## One-line intent

Increase **real, WETH-backed** liquidity in the Aerodrome wQFLOP/WETH pool on Base — never paper TVL.

---

## Pool / token

| Item | Address |
|------|---------|
| Pool (Aerodrome volatile) | `0x4aBC6D796cd036b6f1E433A97F9784a00f90C53e` |
| wQFLOP | `0x69262A2D7c92c074729823B654fE7E4Cdb749747` |
| WETH | `0x4200000000000000000000000000000000000006` |

---

## Acceptance (must all hold)

1. `real_liquidity_usd` (DexPaprika or equivalent measured) **≥ 100**  
   *or* human-written exception with lower floor and dated rationale.
2. WETH reserve **≥ 0.001 ETH** (non-DEGENERATE).
3. Reports never present nominal TVL / totalSupply×price as “liquidity.”
4. Any seed path is **fail-closed** (ARM + gas gate; no unprotected zap).

---

## Current state (2026-08-07)

| Metric | Value |
|--------|--------|
| real_liquidity_usd | **≈ $3.59** |
| Facilitator | **cdp** (ok) |
| Hot vault gas | **≪ 0.003 ETH** (starved) |
| Tooling | truth CLI + dry-run seed + tests **shipped** (`wQFLOP/liquidity/`) |

**Blockers (human):** key rotation (if still compromised), TREASURY/MetaMask gas refuel, real WETH capital for LP add.

---

## Agent tooling (do not skip)

```bash
cd ~/wQFLOP
npm run test:liquidity
npm run liquidity:truth
WQFLOP_LP_ARM=1 npm run liquidity:seed-dryrun   # expects refuse until gas
```

Runbook: `wQFLOP/liquidity/SEED_RUNBOOK.md`

---

## Related goals

| Goal | Relation |
|------|----------|
| `goal/flywheel-10k-eth-apparatus` | Real LP is a Base-layer capital sink after revenue |
| Revenue / $2,184 reframe | x402 CDP settle → USDC → WETH → LP |
| Gas / treasury unlock | Unblocks live seed |

---

## Status history

| Date | Note |
|------|------|
| 2026-08-07 | Goal opened; truth/seed tooling SDD; status **not_reached** |
