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

`VAULT_ADDRESS` / x402 `payTo` is `0x7cb8…`. Working capital sits in settlement `0x9378…`. Incoming paid API revenue does not automatically recapitalize the 54k USDC book.

Do not merge the whole `chore/gitignore-gemini-gha-creds` branch to ship this — cherry-pick the worker commit.
