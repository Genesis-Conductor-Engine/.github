# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**`AGENTS.md` (repo root) is the canonical, reconciled workspace map** — tracked-surface table, on-chain addresses, diamondnode paths, off-repo Desktop projects, GenesisDrive path gotchas. Read it for anything not covered below. This file covers only what is load-bearing and easy to get wrong.

## This repo is the home directory

`~/` itself is the git repo, with a **deny-all-then-allow** `.gitignore` (`/*`, then `!` allowlist entries). Consequences:

- A new top-level path needs **both** `!/path/` and `!/path/**` in `.gitignore` *before* `git add` will take it.
- Only `gc-workers/x402-paid-service/`, `gc-crew-mcp-bridge/`, and `intent-surface/` are allowlisted under `gc-workers/`. Dozens of sibling directories are local-only — edit freely, but git does not see them.
- Most work lives **outside** the tracked surface (`~/Desktop/*`, other clones, diamondnode). Absence from `git ls-files` does not mean absence from the machine.
- Stage explicitly. A broad `git add .` in a home-directory repo is how credentials leak; the allowlist is the only thing standing between you and that.

## Commands

```bash
# gc-workers/x402-paid-service — Worker + Node dual runtime
npm run dev            # wrangler dev :8787
npm run dev:node       # tsx watch src/server.ts (PORT default 8080)
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm run deploy         # wrangler deploy
npx wrangler deploy --dry-run    # validate config/build without shipping

# gc-workers/intent-surface
npm run check          # tsc --noEmit  (note: `check`, not `typecheck`)
npm run deploy:dry

# gc-workers/gc-crew-mcp-bridge (Python >=3.11)
PYTHONPATH=src python -m unittest discover -s tests -v

# scripts/claude-mine (stdlib only)
PYTHONPATH=. python -m unittest discover -s tests -v
```

Single test:

```bash
npx vitest run src/index.test.ts              # one file
npx vitest run -t "sends an alert"            # one test by name
PYTHONPATH=src python -m unittest tests.test_mod.TestClass.test_method
```

## x402-paid-service architecture

**One handler, two runtimes.** `src/index.ts` is the Cloudflare Worker (`fetch` + `scheduled`). `src/server.ts` imports that same default export and adapts Node `http` onto it — it is a thin shim, not a parallel implementation. Behavior changes belong in `index.ts` or they only ship to one runtime.

`src/lib/secrets.ts` resolves secrets runtime-agnostically: env/binding object first (the **only** source that works in a Worker), then `/run/secrets/<name>` (Podman), then `process.env`. It never reads the host `.vault`.

The `TIERS` array in `index.ts` is the single source for pricing, paths, and descriptions — the landing page, `/.well-known/x402`, and every 402 response are all derived from it. Add a tier there, not in the routes.

### Payment destination lives in two files

`payTo` is set in **both** `wrangler.toml` (`VAULT_ADDRESS`) and `bazaar-listing.json` (7 separate fields). `bazaar-listing.json` is the hand-maintained public discovery listing — it is what tells paying agents where to send money, and nothing generates it. **Changing one without the other silently routes real revenue to the old address.** Grep the full old address across the package after any rotation.

`VAULT_ADDRESS` / payTo is HOT `0x60C4499870f115664d7FfD8411b023DBEf3377d9` (signable via diamondnode `qflop-lp`). The Worker still never signs with it — the payer signs EIP-3009; the facilitator settles. An **empty HOT is not the resting state**; flywheel USDC should land here. Gas alerts still apply to signers (`MAIN_WALLET`, and HOT if it starts sending). Settlement working capital `0x9378…` is a Coinbase Smart Wallet — not agent-signable.

Settlement requires live `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` when `X402_FACILITATOR_MODE=cdp`; placeholders fail with `Invalid Ed25519 key length`.

### Cashflow dashboard (same Worker)

- Live: `https://cashflow.genesisconductor.io/cashflow` · `/api/cashflow` · `POST /webhooks/treasury`
- Access **Default-Deny** returns 1050 unless skip/app bypass (`x402-cashflow`) covers `*.genesisconductor.io` **and** `*.workers.dev`
- `GET /cashflow` is **snapshot-first** (KV hit + `waitUntil` refresh). Cold RPC fan-out was a 3–10s LCP; do not make the HTML wait on live RPC again
- Apex `genesisconductor.io` is **Vercel**, not this Worker

### Easy to get wrong (2026-08-15)

- **Dune Sim is gone** (HTTP 410 since 2026-08-01). Use Worker cashflow, Alchemy Worker RPC, Blockscout, or Dune SQL `erc20_base.evt_Transfer`
- Alchemy **CLI 0.22** ≠ skill 0.6 (`setup`/`gas`/`webhooks` missing). `alch_` RPC key ≠ Notify auth token. CLI can 429 monthly while Worker `ALCHEMY_BASE_RPC_URL` is live
- DexPaprika lists wQFLOP (`0x69262A2D…9747`) with **0 pools / no price** — paper, not working capital
- Alby Hub default `:8029` is often down; `hub-cli info` is not a command (`get-info` is)
- NemoClaw on this Mac is Darwin + no sandbox — do not `onboard` (diamondnode H(s)=OFFLOAD)
- Mixed branch `chore/gitignore-gemini-gha-creds` — cherry-pick cashflow commits; do not merge the whole branch to main

## Cloudflare

Reuse, never recreate: KV `API_KEYS` = `4c2c5ef0988742cc8fb98102681d9986`, D1 `ambient-db` = `56fc54e4-a04c-4f6d-b0af-048bdfa777d8`. Do not create new KV/D1 bindings without explicit approval.

After deploying anything needing secrets, use `wrangler secret put NAME` — never dummy values, never skip the auth check to make a deploy pass.

Per `copilot-instructions.md`, Workers ship SEO/discovery files in `public/`: `llms.txt`, `robots.txt`, `sitemap.xml`, `.well-known/mcp.json`, `.well-known/a2a.json`.

## Conventions

- Trust **executable** sources (package scripts, `wrangler.toml`, `deployment-*.json`) over prose when they disagree — including over `AGENTS.md` and this file.
- Conventional Commits (`feat:`, `chore:`, `security:`). Some remotes require signed commits — prefer a PR over a force-push.
- Old MAIN/vault keys are compromised (`x402-paid-service/LAUNCH_PLAN.md`). Never revive an address from chat history or a stale doc; read it from the deployed config.
- Never commit: secrets, `.env*`, private keys, Google live credentials, `~/.claude` transcripts, claude-mine outputs.
