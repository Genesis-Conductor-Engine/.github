# Plan: wQFLOP real liquidity generation

**Goal focus:** Generate **real** (WETH-backed) liquidity for the Aerodrome wQFLOP/WETH pool — not paper TVL.  
**Parent goals:** `goal/flywheel-10k-eth-apparatus` (capital path), revenue/`$2,184` reframe, Tier-0 gas unlock.  
**Repo for code:** `/Users/igorholt/wQFLOP` (dedicated git root).  
**Pool:** `0x4aBC6D796cd036b6f1E433A97F9784a00f90C53e` (Aerodrome volatile, Base).  
**Token:** wQFLOP `0x69262A2D7c92c074729823B654fE7E4Cdb749747`.

---

## Reality (measured 2026-08-07)

| Fact | Value |
|------|--------|
| DexPaprika `liquidity_usd` | **≈ $3.59** (real) |
| WETH reserve (order of magnitude) | ~1e-4 ETH |
| wQFLOP reserve | paper-scale (huge supply side) |
| x402 facilitator | **`mode=cdp`** (healthy) |
| Gas (hot vault / main) | **~0 / 0 ETH** — cannot seed LP or settle without refuel |
| Nominal TVL narratives ($598k) | **INVALID** — paper |

**Definition of win:** increase **real** pool TVL (WETH side + measured `liquidity_usd`) and/or install a fail-closed pipeline that can only add liquidity when funded + armed. Not minting more wQFLOP into an empty pool.

---

## Global Constraints

1. **Never treat paper wQFLOP supply or nominal TVL as liquid.** All reports must separate `real_liquidity_usd` vs `paper_wqflop_reserve`.
2. **No broadcast of fund-moving txs** unless `WQFLOP_LP_ARM=1` **and** dry-run is false **and** a non-compromised key path is documented. Default = dry-run / read-only.
3. **No new deps** beyond existing stack (node, cast optional, fetch). Prefer pure JS + public RPC.
4. **Do not print private keys, mnemonics, or secret env values.**
5. **Facilitator already CDP** — do not “fix” by breaking mode; only verify and document.
6. **Gas gate:** any live seed path must abort if hot vault ETH &lt; `MIN_GAS_ETH` (default `0.003`).
7. Commits: Conventional Commits on `wQFLOP` repo only for code; home-repo docs may be separate commit if allowlisted.
8. Tests required for pure logic; integration scripts may dry-run without network if mocked.

---

## Architecture (liquidity flywheel)

```
x402 settle (CDP, USDC → payTo) ──► accumulate real USDC
        │
        ▼ (only when gas + ARM)
  swap USDC→WETH (or receive WETH) ──► addLiquidity wQFLOP/WETH (Aerodrome)
        │
        ▼
  truth meter: real_liquidity_usd ↑  (DexPaprika + getReserves)
```

Until gas/refuel exists, **ship the meter + fail-closed seed tool + goal wiring**. Live LP add remains **BLOCKED** on human TREASURY/MetaMask refuel (document, do not fake).

---

## Task 1: Liquidity truth module + CLI

**Files:**
- Create: `wQFLOP/liquidity/truth.mjs` (pure helpers + main)
- Create: `wQFLOP/liquidity/constants.mjs` (addresses, floors)

**Requirements:**
1. Constants: pool, wQFLOP, WETH, USDC, hot vault `0x60C4…`, root treasury `0x54E2…`, router optional.
2. Pure functions (exportable / testable without network when injected):
   - `formatWei(wei, decimals=18) → string`
   - `classifyLiquidity({ liquidityUsd, wethReserveWei, minWethWei }) → { status: "DEGENERATE"|"THIN"|"OK", reason }`
   - `paperRatio({ wqflopReserve, wethReserve }) → number|null` (null if weth=0)
3. Async `measureLiquidity({ rpcUrl, fetchImpl })` returns JSON:
   ```json
   {
     "ts": "ISO",
     "pool": "0x4aBC…",
     "real_liquidity_usd": number|null,
     "weth_reserve_wei": "…",
     "wqflop_reserve_wei": "…",
     "status": "DEGENERATE|THIN|OK",
     "gas": { "hot_vault_eth": "…", "main_eth": "…", "low": true },
     "facilitator": { "mode": "cdp|public|unknown", "ok": boolean|null },
     "note": "paper TVL invalid; real = WETH-backed only"
   }
   ```
4. CLI: `node liquidity/truth.mjs` prints JSON to stdout; exit 0 always for read-only (exit 2 only on unrecoverable parse errors).
5. Network: Base public RPC + DexPaprika pool endpoint (UA `wqflop-liquidity-truth/1.0`); tolerate DexPaprika fail (null real_liquidity_usd, still report reserves via eth_call if possible).
6. eth_call for `getReserves()`, `token0()`; map WETH side correctly.

**Verify:** `node liquidity/truth.mjs | jq .status` works offline with mocked fetch in tests; live run prints status.

---

## Task 2: Unit tests for truth helpers

**Files:**
- Create: `wQFLOP/liquidity/truth.test.mjs` (node:test or existing test runner)

**Requirements:**
1. `classifyLiquidity`: DEGENERATE when wethReserve &lt; min; THIN when real_liquidity_usd &lt; 50; OK when ≥ 50 and weth above floor.
2. `paperRatio`: large when wqflop huge and weth tiny; null when weth 0.
3. `formatWei` edge cases.
4. No network required for these tests.
5. Add npm script `"test:liquidity": "node --test liquidity/truth.test.mjs"` in `wQFLOP/package.json` if package.json exists.

**Verify:** `npm run test:liquidity` (or `node --test …`) all pass.

---

## Task 3: Fail-closed seed-from-revenue dry-run

**Files:**
- Create: `wQFLOP/liquidity/seed_lp_dryrun.mjs`
- Create: `wQFLOP/liquidity/SEED_RUNBOOK.md` (short human runbook)

**Requirements:**
1. Default mode: **dry-run** — compute recommended `addWethWei` / paired wQFLOP estimate from target `real_liquidity_usd` delta (env `TARGET_TVL_USD` default 100); print plan JSON; **no RPC writes**.
2. Abort with exit 78 if:
   - `WQFLOP_LP_ARM` ≠ `1`, or
   - measured hot vault ETH &lt; `MIN_GAS_ETH` (0.003), or
   - status is DEGENERATE without explicit `ALLOW_DEGENERATE_SEED=1`
3. Never import private keys. If live path is stubbed, it must throw `"live seed not implemented in this task — use Foundry AddLiquidity after arm + key rotation"`.
4. SEED_RUNBOOK.md steps: (1) truth meter (2) rotate keys if compromised (3) refuel gas (4) acquire WETH (5) Foundry/AddLiquidity or future live script (6) re-run truth.
5. Reference existing retired zap tombstone — do not revive unprotected zap.

**Verify:** `node liquidity/seed_lp_dryrun.mjs` exits 78 without ARM; with `WQFLOP_LP_ARM=1` and mocked low gas exits 78; dry-run JSON prints with ARM=1 and mocked sufficient gas if injection allows — or document that live gas check causes 78 until refuel.

---

## Task 4: Goal pack + flywheel layer honesty

**Files:**
- Create: `docs/superpowers/plans/GOAL_WQFLOP_LIQUIDITY.md` (under home docs — goal ID `goal/wqflop-liquidity-generation`)
- Update: `alby-hub/flywheel-config.json` → `layers.wqflop_liquidity` with:
  - pool, measured note, real_vs_paper doctrine, truth_cli path, seed_cli path, status `not_reached` until real_liquidity_usd ≥ 100
  - link facilitator cdp ok, gas low
- Patch: `docs/superpowers/plans/INCOMPLETE_GOALS_INVENTORY_2026-07-21.md` Tier 0 row for wQFLOP real liquidity

**Requirements:**
1. Goal pack states acceptance: `real_liquidity_usd ≥ 100` OR explicit human accept of lower floor; paper never counts.
2. Status `not_reached` with blockers: gas, key rotation, capital for WETH side.
3. No secrets in JSON.

**Verify:** files exist; flywheel-config validates as JSON; goal ID present.

---

## Task 5: Wire README entry in wQFLOP monorepo

**Files:**
- Update: `wQFLOP/README.md` (short section) OR create `wQFLOP/liquidity/README.md`

**Requirements:**
1. Document commands: truth, test:liquidity, seed dry-run.
2. Explicit “paper TVL is invalid”.
3. Point to SEED_RUNBOOK and GOAL pack.

**Verify:** README section renders; links relative.

---

## Out of scope (do not implement)

- Live AddLiquidity broadcast / Foundry deploy of new pools
- Minting wQFLOP to fake TVL
- Key rotation (human)
- TREASURY unlock / MetaMask refuel (human)
- Research.gov federal goal work
- Reviving retired `zap_eth_to_wqflop.mjs` unprotected path

---

## Execution notes for SDD

- Work primarily in `/Users/igorholt/wQFLOP` branch `feat/wqflop-real-liquidity` (create from main).
- Docs under home repo only for Task 4 — commit if allowlisted, else leave as WIP files.
- After all tasks: final review; status goal remains `not_reached` until real TVL moves on-chain.
