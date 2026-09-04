# AGENTS.md — Genesis Conductor Home Workspace

Home-directory git repo with deny-all-then-allow `.gitignore` (`/*` then `!` paths). Only allowlisted paths can be staged; most of `~/` is intentionally invisible to git.

## Session operating rules (all harnesses)

These apply to every agent session — Claude Code, Grok, Codex, Cursor, Gemini, Copilot, OpenCode, OpenClaw, and any other harness. Canonical copy: `~/.agents/session-operating-rules.md`.

### Truthfulness Over Optimism

Never report a finding from a still-running command or an unverified tool response. If an MCP or integration tool returns an empty confirmation, treat it as FAILED — re-run or fall back to a direct file write, and say so explicitly. Never invent URLs, citations, or contract addresses; if a source is unknown, mark it `[UNVERIFIED]`.

### Disk & Environment Preflight

Before any long build, package install, or test run: check free disk with `df -h /` and `df -h /tmp`. If `/private/tmp` exists (macOS), also check `df -h /private/tmp`. If under 5GB free, run `npm cache clean --force`, prune Docker, and report before proceeding. ENOSPC has silently broken shell and file-edit tools in past sessions.

### Async / non-blocking I/O

Every session is asynchronous. Never block the conversation, the event loop, or a parent agent on I/O.

- Start long commands (installs, builds, tests, deploys, SSH, compiles, downloads) in the background and keep working. Do not wait on them in the foreground.
- Never poll status tools in a loop. Use one sleep-then-check, or a single bounded timeout. Subagents must write their outputs to disk before returning.
- Every network and subprocess call must have a timeout. No unbounded `sleep`/retry loops, no blocking `subprocess` without a bound, no `curl` without `--max-time`.
- If a foreground command is still running after a few seconds, background it and continue.
- Checkpoint partial findings to disk after each phase so a session-limit hit does not lose work.

### Git Conventions

- Use separate `-m` flags for multi-line commit messages; heredoc/multi-line strings have failed repeatedly.
- Before committing, run `git log origin/main..HEAD --oneline` — if the branch carries unrelated commits, STOP and report rather than pushing.
- Scope commits narrowly; never commit files containing PII, clearance, or credential content.

### Contract Verification (Foundry/Base)

Always verify with relative source paths and matching compiler settings; absolute paths cause metadata-hash mismatches. Never use jq-based greps to determine verification status — query the explorer API directly and confirm per-contract. Base 8453 is the only chain with live deployments.

## Startup rules
1. Read this file, then any per-project `AGENTS.md` in the active tree.
2. Trust executable sources — package scripts, `wrangler.toml`, deployment JSON — over prose.
3. Never commit secrets, `.env*`, private keys, Google live credentials, `~/.claude` transcripts, mine outputs.
4. New top-level paths need `!/path/` + `!/path/**` in `.gitignore` before `git add` will take them.
5. `opencode.json` is not allowlisted — local OpenCode config only.

## Tracked surface
Verify with `git ls-files`. Allowlisted:
- Root meta: `AGENTS.md`, `LLMS.txt`/`llms.txt`, `copilot-instructions.md`, `vercel.json`, `azure.yaml`, `.gitignore`, `.gitmodules`
- `.github/` CODEOWNERS, agents, copilot-instructions, `yennefer-hourly-feed.yml` → `scripts/update_feed.py`
- `docs/` — goals, SDDs, runbooks; often uncommitted: `federal/`, `knowledge-nodes*`, `GOAL_*.md`
- `scripts/` `update_feed.py`, `claude-mine/`
- `gc-workers/` only `x402-paid-service/`, `gc-crew-mcp-bridge/`, `intent-surface/`
- Submodule `euler-cycle-attestor/lib/openzeppelin-contracts` only

Allowlisted but often uncommitted: `gc-workers/intent-surface/`, `docs/federal/`, `docs/knowledge-nodes/`, `GOAL_*.md`.

Other `~/gc-workers/*` dirs are local only — edit freely, do not assume git tracks them.

Legacy tracked exceptions (pre-.gitignore): `gc-workers/gc-16-capsule-bridge/public/llms.txt` and `gc-workers/gc-greg-hook/public/llms.txt` remain tracked despite not being in the allowlist.

## Active constraints
**goal/research-gov-kovach-gc-jv** not_reached
- Kovach Enterprises = prime · Genesis Conductor = research partner / JV gateway
- Never invent DUNS, SAM UEI, CAGE, clearance case #, FFL #. DUNS may exist in vault — never print.
- DUNS ≠ SAM Active — modern bids need UEI under Active SAM
- Pack: `docs/superpowers/plans/GOAL_RESEARCH_GOV_KOVACH_GC_JV.md` + `docs/federal/kovach-gc-jv/`
- Entity model: `docs/knowledge-nodes.md`

## Critical off-repo paths
- `~/Desktop/AutoFunnel/` → Pareto Engine → pareto.genesisconductor.io `deploy.sh`
- `~/Desktop/genesis-conductor-app/` → Seismic console + `contracts/deployment-*.json`
- `~/Desktop/openclaw/`, `~/Desktop/Diamond-V/` → OpenClaw / Q-Mem / Hardhat
- `~/Desktop/vibe remembered.txt` → Treasury lock directive + session notes
- `~/Pareto/skills/pareto-audit/` → `tests/verification_results.json` last PASS R_art=0.964
- GenesisDrive path contains U+202F narrow space: `~/Library/CloudStorage/GoogleDrive-holt.igor@gmail.com (4-7-26 5:04 AM)/My Drive (igor@genesisconductor.io)/GenesisDrive/` — use glob or `\u202f`. Same gotcha on Dropbox paths.

## Build & test — verified

### gc-workers/x402-paid-service
```bash
cd ~/gc-workers/x402-paid-service
npm run dev           # wrangler :8787
npm run dev:node      # tsx watch src/server.ts PORT default 8080
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run deploy        # wrangler deploy
```
Dual runtime: `src/index.ts` Worker shared with `src/server.ts` Node/Podman. Podman secrets at `/run/secrets/<name>` via `src/lib/secrets.ts`. `wrangler.toml`: `nodejs_compat`, cron `0 */6 * * *`, KV `API_KEYS` = `4c2c5ef0988742cc8fb98102681d9986`. `X402_FACILITATOR_MODE=cdp` needs live `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`. Do not create new KV/D1 without approval.

Cashflow (same Worker, Access bypass `x402-cashflow`):
- https://cashflow.genesisconductor.io/cashflow
- https://cashflow.genesisconductor.io/api/cashflow
- https://cashflow.genesisconductor.io/webhooks/treasury
- https://cashflow.genesisconductor.io/.well-known/mcp.json

Snapshot-first HTML (KV + `waitUntil` refresh). Dune Sim is sunset (410). Alchemy CLI may 429 while Worker `ALCHEMY_BASE_RPC_URL` is live. wQFLOP is unpriced on DexPaprika (0 pools).

### gc-workers/intent-surface
```bash
cd ~/gc-workers/intent-surface
npm run dev / deploy / deploy:dry / check  # check = tsc --noEmit
```
Route intent.genesisconductor.io, AI model `@cf/moonshotai/kimi-k2.7-code`, `html_handling = "none"` — do not fix trailing slash. Optional secret `CSID_ORIGIN` for THRML daemon tunnel.

### gc-workers/gc-crew-mcp-bridge
```bash
cd ~/gc-workers/gc-crew-mcp-bridge
PYTHONPATH=src python -m unittest discover -s tests -v
PYTHONPATH=src python -m gc_crew_mcp evolve-dry --goal-status partial --quality 0.7
```
Python ≥3.11, stdlib base. Extras: `pip install '.[crewai]' '.[mcp]' '.[logfire]'`

### scripts/claude-mine
```bash
cd ~/scripts/claude-mine
PYTHONPATH=. python -m unittest discover -s tests -v
PYTHONPATH=. python -m claude_mine session <session.jsonl> --out /tmp/out
```
Stdlib only. Never commit mine output or real `~/.claude` paths.

### Local-only stream-virtual-experience
```bash
python3 scripts/thrml-csid-daemon.py   # CSID :5192
python3 scripts/control-server.py      # control :5191
```
Default Space id `1RKZzzEXjXmKB`.

### Foundry ~/euler-cycle-attestor
```bash
forge test  # solc 0.8.24, via_ir, base RPC https://mainnet.base.org
```

## On-chain references
Source of truth files, prefer over memory:
- Euler `~/Desktop/genesis-conductor-app/contracts/deployment-euler.json`
- Stack `.../deployment-complete.json`
- x402 runtime `~/gc-workers/x402-paid-service/wrangler.toml`
- Ops labels `~/scripts/claude-mine/claude_mine/labels.py`

Directive: `TREASURY_REALIGNED_AND_LOCKED: 0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75`

| Role | Address | Notes |
|------|---------|--------|
| Root treasury (locked) | `0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75` | gas/sub-wallet funding only |
| Settlement / Smart Wallet | `0x937897fe19F675c96a71078820F21cA9bD637180` | working capital; not agent-signable |
| HOT / x402 payTo | `0x60C4499870f115664d7FfD8411b023DBEf3377d9` | `VAULT_ADDRESS` + all bazaar `payTo`; diamondnode `qflop-lp` |
| MAIN_WALLET | `0x967a9C352a87D3a72baa7aD10632A7276101dBc9` | rotated 2026-08-01; often 0 ETH |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | |

Old MAIN keys compromised — do not revive stale addresses from chat. Runtime payout is whatever `VAULT_ADDRESS` is in the **deployed** worker env (must match `bazaar-listing.json`). Do not revert payTo to `0x7cb8…`. Alchemy CLI 429 ≠ Worker RPC dead; public fallback `https://mainnet.base.org`.

## Cloudflare
Account ID `04c59c95ce8d0a0be98099b7f7e39d18` matches `opencode.json` + wrangler.
Wrangler OAuth `~/.wrangler/config/default.toml`.
Reuse KV `API_KEYS` `4c2c5ef0988742cc8fb98102681d9986`, D1 ambient `56fc54e4-a04c-4f6d-b0af-048bdfa777d8`. Do not recreate.
After deploy needing secrets: `wrangler secret put NAME` — never dummy secrets.
Worker SEO baseline: `public/llms.txt`, `robots.txt`, `sitemap.xml`, `.well-known/mcp.json`, `.well-known/a2a.json`.

## OpenCode / MCP
`~/opencode.json` defines local MCPs: `diamond-vault`, `qmcp`, `docker-mcp`, `sequential-thinking`, `playwright` Chromium; remote Cloudflare suite.
Bash permission allowlist: `git/npm/npx/node/python3/docker/wrangler/curl/cat/ls/find/grep` — everything else asks.

## Conventions
- AFK: pick safest default, keep going, hand off as PR not merge — `docs/knowledge-nodes/afk.md`
- TypeScript ESM for Workers; Conventional Commits
- Signed commits / branch protection on some remotes — prefer PR over force-push
- Fleet batch messages starting `Fleet deployed:` → parallel steps; A2A envelopes → `~/gc-workers/a2a-envelopes.jsonl`
- `azure.yaml` is azd scaffold only; `vercel.json` has `git.deploymentEnabled: false`

## Other AGENTS.md
Read when working there: `~/Desktop/openclaw/`, `~/Desktop/genesis-conductor-app/`, `~/Desktop/Diamond-V/`, `~/yennefer-mesh/`, `~/here.now/`, `~/gc-workers/*/`, `~/.openclaw/workspace/`, `~/.codex/`, `~/sota/`, `~/SEAR/sear/`, diamondnode `~/AGENTS.md`.

*Reconciled 2026-08-23 against git ls-files, wrangler.toml, live cashflow.genesisconductor.io, .gitignore allowlist.*
