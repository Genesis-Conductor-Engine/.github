# Internal cashflow dashboard

Live Worker (Access bypass attached 2026-08-15):

- https://cashflow.genesisconductor.io/cashflow
- https://cashflow.genesisconductor.io/api/cashflow
- https://cashflow.genesisconductor.io/webhooks/treasury
- https://x402-paid-service.iholt.workers.dev/cashflow

Static snapshot (here.now): https://still-eagle-k5mn.here.now/

Access app `x402-cashflow` (`bea0e6d3-7776-42fb-af50-e7fdf9208874`) — bypass everyone. Default-deny 1050 without this app.

GAS_ALERT_WEBHOOK → `https://cashflow.genesisconductor.io/webhooks/treasury`

Worker routes:

- `GET /cashflow` — HTML dashboard
- `GET /api/cashflow` — JSON snapshot
- `POST /webhooks/treasury` — Alchemy `ADDRESS_ACTIVITY` or `{direction,asset,amount}`
- Cron (every 6h) refreshes the snapshot into existing KV `API_KEYS`

## Live book (2026-08-15T12:16Z snapshot)

Priced ~$83,270 · settlement 55,026 USDC · HOT/payTo 2.04 USDC · treasury 14.667 ETH + 710 USDC · MAIN 0 ETH. wQFLOP unpriced (DexPaprika 0 pools). Window ROI −15.8% on prose open 61,745.

## Observed ROI (settlement USDC, 2026-08-09 → 15)

- Opening (prose): 61,745
- Net: −9,752.96 (−15.8% on prose open)
- Residual vs live: +2,436.73 (true open closer to 64,182)
- Working capital now: live settlement USDC (re-read on each dashboard load)

Flywheel rows on the dashboard are **models**, not observed returns.

## Vendor settlement

Alchemy RPC is **live** again (new `alch_` key stored only as Worker secrets `ALCHEMY_API_KEY` + `ALCHEMY_BASE_RPC_URL` — not in git). Dollar invoice, if any, is still only payable in the Alchemy billing UI.

Notify/Address Activity still needs the **dashboard Notify auth token** (different from the RPC key). Create the hook in Alchemy → Address Activity → Base → fleet addresses → `https://cashflow.genesisconductor.io/webhooks/treasury`.

## Auto-webhook

Point an Alchemy Address Activity webhook (Base) at:

`https://<worker-host>/webhooks/treasury`

Watch: treasury, settlement, HOT, payTo, MAIN.

Optional Worker secret: `TREASURY_WEBHOOK_SECRET` → send as `X-Treasury-Hook`.

## Structural cashflow leak

`VAULT_ADDRESS` / x402 `payTo` is HOT `0x60C4…77d9` (signable). Working capital still sits in settlement `0x9378…` (Coinbase Smart Wallet, not agent-signable). Incoming paid API revenue now lands on HOT; the ~$53.7k USDC book does not move until a human sends it.

## 2026-08-15 LCP / sensors increment

- `GET /cashflow` and `GET /api/cashflow` serve the last KV snapshot first (`X-Cashflow-Cache: hit`) and refresh in `waitUntil`.
- ETH mark prefers DexPaprika Base WETH; CoinPaprika is fallback.
- wQFLOP is listed on DexPaprika with **0 pools / no price** — still unpriced. Do not treat paper TVL as working capital.
- Alby Hub `:8029` was down this session. Alchemy CLI 0.22 is monthly-capacity 429; Worker live RPC is the cashflow path.
- NemoClaw is installed on Darwin (`v0.0.17`) — do not onboard (Linux + GPU; diamondnode OFFLOAD).

Do not merge the whole `chore/gitignore-gemini-gha-creds` branch to ship this — cherry-pick the worker commit.
