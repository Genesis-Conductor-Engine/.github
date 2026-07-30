# Liquid-Asset Accelerant — Consolidated Reality Map & Gated Launch Plan
_Generated 2026-06-28 · all numbers measured on-chain (Base mainnet, CDP RPC + publicnode cross-check) · ETH spot $1,555.145_

> **Mandate:** launch the non-sim Base / Polygon / Optimism liquid-asset accelerant.
> **Method:** 7-domain read-only audit (4 completed before the session limit; 3 finished inline). No transactions were broadcast. No secrets were read.

---

## 1. The honest headline

There is **no large pile of liquid value to "accelerate."** The real, withdrawable total across every wallet, LP, and vault is **≈ $13.3** — not the ~$598k the wQFLOP TVL implies (that figure is paper).

The accelerant is therefore **not** "move a fortune across chains." It is **"activate the revenue infrastructure"** — make the already-deployed paid endpoints actually capable of capturing real money, on multiple chains, discoverably. Today they **cannot capture a single payment** because of a facilitator misconfiguration (see Blocker #1).

| Bucket | Real liquid USD | Confidence |
|---|---|---|
| VAULT `0x2aF0…a1B8` (0.0016526 ETH + 2.1431 USDC) | $4.71 | measured |
| MAIN `0x60C4…77d9` (0.0016878 ETH + 0.0371 USDC) | $2.66 | measured |
| gc-payment-engine vault `0xB6D9…1F08` (0.10 USDC) | $0.10 | measured |
| wQFLOP/WETH LP burn (94.76% of ~0.0039 WETH) | ~$5.79 | measured |
| **TOTAL REAL LIQUID** | **≈ $13.3** | **measured** |
| ~~wQFLOP nominal TVL~~ | ~~$598,000~~ → **$6 real** | paper |
| 25-wallet HD registry | **unmeasured** (compromised mnemonic; not derived) | unknown |

---

## 2. Consolidated component map

| Component | Chain | Status | Real $ | Launch-ready | Key blocker |
|---|---|---|---|---|---|
| x402-paid-service (6 tiers $0.01–$9,999) | Base 8453 | live-mainnet config | 0 captured | ❌ | **Runs `mode=public`; x402.org can't settle mainnet** |
| x402-express-service (4 routes) | Base Sepolia 84532 | testnet | 0 | ❌ | Testnet-only; local, not deployed |
| VAULT settlement wallet | Base 8453 | live | $4.71 | ⚠️ | Gas 0.00165 ETH < 0.002 threshold (`/health/gas` 503) |
| MAIN operating wallet (LP owner + signer) | Base 8453 | live | $2.66 | ❌ | **Signing key compromised + UNROTATED** |
| wQFLOP/WETH LP `0x4aBC…C53e` | Base 8453 | live | $5.79 real | ❌ | wQFLOP side is paper; no gauge/emissions |
| gc-payment-engine `0xB6D9…1F08` | Base 8453 | live | $0.10 | ❌ | Payment-proof accepts ANY hex; no ledger |
| Stripe checkout (Pro / Enterprise) | fiat | **LIVE (200)** | 0 captured | ✅ | Webhook secret registration only |
| Shopify high-tier SKUs | fiat | gated (402) | 0 | ❌ | Store/token-blocked; not buyable |
| Revenue ledger (D1/Analytics) | — | exists, unwired | — | ❌ | No `writeDataPoint`; settlement fire-and-forget |
| Polygon / Optimism endpoints | 137 / 10 | **does not exist** | 0 | ❌ | Greenfield; zero config in repo |

---

## 3. The four blockers (in priority order)

1. **🔴 Facilitator misconfig — revenue front door is dead.** The live Worker reports `mode=public` → routes settlement to `x402.org/facilitator`, which supports **EVM testnet only** (base-sepolia). It advertises real mainnet USDC but **no payment on any tier can settle.** Root cause: `env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET` is falsy at runtime (secrets present by name in `wrangler secret list` but empty/mis-scoped in the deployed worker). _Reversible fix._

2. **🔴 Compromised, unrotated keys — unsafe to move funds.** MAIN private key, CDP API creds, and BACKFILL_MASTER_MNEMONIC are all flagged compromised with **no documented rotation**. `~/.x402-refuel.env` still holds the old `MAIN_PK` and is auto-sourced hourly to sign live txns. Any value moved through MAIN/VAULT can be swept. **Hard precondition before ANY fund movement.**

3. **🟠 No revenue ledger.** Captured payments are recorded nowhere (ANALYTICS binding never written; settle() is fire-and-forget with `.catch(console.error)`). Revenue can be received but not accounted for.

4. **🟠 Gas starvation.** VAULT 0.00165 ETH and MAIN 0.00169 ETH are both under the 0.002 ETH threshold; auto-refuel cannot self-heal (MAIN has 0.037 USDC vs 1.5 USDC swap minimum). Settlement txns may fail for lack of gas.

---

## 4. Multichain reality check ⚠️

The requested **Optimism** target is **not currently launchable.** The CDP x402 facilitator (the only one that settles EVM mainnet) supports:

| Chain | CAIP-2 | CDP facilitator | x402.org public |
|---|---|---|---|
| Base mainnet | eip155:8453 | ✅ | ❌ |
| **Polygon mainnet** | eip155:137 | ✅ | ❌ |
| Arbitrum mainnet | eip155:42161 | ✅ | ❌ |
| **Optimism mainnet** | eip155:10 | **❌ not supported** | ❌ |
| Base Sepolia | eip155:84532 | ✅ | ✅ |

→ Realistic multichain launch = **Base + Polygon (+ Arbitrum)**. Optimism would need the x402 facilitator to add it (out of our control), or a self-hosted facilitator. Substitute **Arbitrum** for Optimism if three-chain coverage is the goal.

---

## 5. Gated launch plan

### Preconditions (must complete first)
- **P1 — Rotate keys.** New MAIN wallet key; migrate live balances to the fresh address; rotate CDP API key + CDP RPC key (re-`secret put` via interactive stdin only); rotate BACKFILL_MASTER_MNEMONIC + re-derive the 25 HD wallets; repoint the hourly refuel cron. _Until P1, no fund moves._
- **P2 — Confirm CDP key validity** post-rotation (facilitator + RPC both depend on it).

### Reversible actions (safe — no fund movement; still a prod deploy → confirm)
- **R1** — Fix Blocker #1: ensure CDP secrets are present & non-empty in the deployed worker; redeploy; verify `/health/facilitator` flips to `mode=cdp`. _This alone revives the entire revenue front door._
- **R2** — Wire the revenue ledger: `ANALYTICS.writeDataPoint` on every settle + a D1 row (reuse gc-fleet-registry schema with `total_revenue`).
- **R3** — Fix the gc-payment-engine payment-proof TODO (real on-chain transfer/amount/token check) or disable that surface.
- **R4** — Add Polygon (eip155:137) as a second `accepts[]` network on each endpoint; deploy. (Arbitrum optional.)
- **R5** — Register endpoints in the x402 Bazaar (discovery extension) so other agents can find + pay.
- **R6** — Set `GAS_ALERT_WEBHOOK`; make the refuel loop server-driven.

### Irreversible actions (real money — each requires explicit approval)
- **I1** — Fund gas on the **new** (rotated) wallet: ~0.005 ETH. _Never fund the compromised key._
- **I2** — (Optional, low value) Burn the wQFLOP LP to recover ~$5.79 WETH — likely not worth gas + risk.
- **I3** — Bridge USDC to Polygon for that chain's gas/float once Polygon endpoints are live.

---

## 6. Recommendation

**First move = R1 (revive settlement), gated behind P1 (rotate the compromised CDP key).** Fixing the facilitator is the single highest-leverage, lowest-cost action: it converts a dead front door into a live, mainnet-settling, multi-tier payment service — with zero fund movement. Multichain (R4, Polygon) and discovery (R5) stack on top. Fund movement (I1–I3) stays gated until keys are rotated.

The accelerant's real output is **a live, discoverable, multi-chain paid-API revenue engine** — not the relocation of a $13 balance.
