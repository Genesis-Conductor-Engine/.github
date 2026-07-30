# GC Crew MCP — Instrument + Executable CLI (progress all 3 domains)

**Goal:** Make the three evolve domains **operator-executable** with Logfire observability (optional, no hard dep) and a stdlib CLI. Highest ROI is Domain C (x402 discover + evolve dry-run); Domain A/B get first-class CLI surfaces. No secrets, no live USDC payment.

**Why this plan (from check-work VERDICT: PASS + ROI ranking):**
1. **Domain C** — live discovery-only well-known + instrumented mock/dry evolve path
2. **Domain A** — `trust-check` executable against MCP URL list
3. **Domain B** — `roster` / `dispatch-plan` dump for parallel agents

**Tech:** Python 3.11+ stdlib CLI (`python -m gc_crew_mcp`). Optional `logfire` extra. unittest. Worktree: `feat/gc-crew-mcp-evolve`.

---

## Global Constraints

1. **No secrets committed.** Env names only: `LOGFIRE_TOKEN`, `RETRAINER_BASE_URL`, `GC_MCP_TOKEN`, `X402_PAYMENT_PROOF`, `X_ADMIN_KEY`.
2. **No live USDC payment** in default CLI paths. `evolve` subcommand defaults to mock transport unless `--live` **and** proof/admin key provided; without both, refuse live.
3. **Logfire is optional.** Package runs with zero third-party deps. If `logfire` not installed or no token, use no-op spans/logger.
4. **Never log secrets** (payment proofs, admin keys, tokens) into Logfire attributes or stdout.
5. **Trust enforcement:** CLI network targets must pass `is_trusted_url` (https trusted host or local http).
6. **Commits:** `feat(crew-mcp):`, `test(crew-mcp):`, `docs(crew-mcp):`, `chore(crew-mcp):`.
7. **Tests:** unittest; no network required. Network tests must be opt-in skipped by default.
8. **Do not stage** unrelated dirty files (`LLMS.txt`, etc.).
9. **x402 constants** remain `10000` / vault payTo / `eip155:8453`.
10. Work only on branch `feat/gc-crew-mcp-evolve` in worktree `/Users/igorholt/.worktrees/feat-gc-crew-mcp-evolve`.

---

### Task 1: Optional Logfire observability module + wire hot paths

**Files:**
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/observability.py`
- Modify: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/evolve_hook.py`
- Modify: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/trust.py` (minimal: span-friendly hook optional — prefer wrapping only in CLI/evolve_hook to avoid import noise)
- Modify: `gc-workers/gc-crew-mcp-bridge/pyproject.toml` — optional dep `logfire = ["logfire>=2.0"]`
- Create: `gc-workers/gc-crew-mcp-bridge/tests/test_observability.py`

**Requirements:**

1. `observability.py`:
   - `configure_observability(*, service_name: str = "gc-crew-mcp", send_to_logfire: bool | None = None) -> bool`  
     - Tries `import logfire`; if missing, return False.
     - If `LOGFIRE_TOKEN` unset and send_to_logfire is not True, configure with `send_to_logfire=False` when API allows, or skip configure and use no-op.
     - Call `logfire.configure()` **once** (module-level guard).
     - Return True if real logfire active (token present and import ok).
   - `span(name: str, **attrs)` context manager — real logfire.span if available else no-op contextmanager. **Strip** keys containing `proof`, `key`, `token`, `secret`, `password` (case-insensitive) from attrs.
   - `info(msg: str, **attrs)` / `error(msg: str, **attrs)` — structured if logfire else no-op (or optional stderr debug if `GC_CREW_MCP_DEBUG=1`).
2. `evolve_hook.submit_metrics`: wrap body in `span("evolve.submit_metrics", base_host=..., goal_status=..., candidate_id=...)` — never pass payment_proof/admin_key into span attrs.
3. Tests: no-op path without logfire; redaction of secret-like attrs; configure idempotent.
4. Commits: `feat(crew-mcp): optional logfire observability` + `test(crew-mcp): observability unit tests`

**Done when:** suite green including observability tests.

---

### Task 2: Stdlib CLI progressing Domains A/B/C

**Files:**
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/__main__.py`
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/cli.py`
- Create: `gc-workers/gc-crew-mcp-bridge/tests/test_cli.py`
- Modify: `gc-workers/gc-crew-mcp-bridge/README.md` — CLI section
- Modify: `docs/superpowers/plans/GC_CREW_MCP_EVOLVE_RUNBOOK.md` — CLI + instrument steps

**Requirements:**

CLI entry: `python -m gc_crew_mcp <command> ...` (argparse). Exit codes: 0 success, 2 usage/validation, 1 runtime error.

Commands:

1. **`trust-check`** (Domain A)  
   - Args: one or more URLs  
   - Prints JSON list `{url, trusted: bool}`  
   - Exit 0 if all trusted else 2

2. **`roster`** (Domain B)  
   - Prints JSON of `parallel_dispatch_plan(CREW_ROSTER)`  
   - Also print `validate_roster` messages; exit 1 if non-empty

3. **`evolve-dry`** (Domain C)  
   - Builds `RunMetrics` from flags: `--quality`, `--latency-ms`, `--cost-usdc6`, `--goal-status`, `--candidate-id`  
   - Default transport: mock 402 returning package constants  
   - Prints result JSON (`payment_required` expected)  
   - Uses `configure_observability()` at start  
   - Exit 0 on payment_required or ok

4. **`x402-discover`** (Domain C)  
   - Args: `--base-url` default `https://optimization-inversion.genesisconductor.io`  
   - Must `is_trusted_url` on constructed well-known URL **or** host allow via trust helpers  
   - Fetch `/.well-known/x402` with urllib; on failure exit 1 with message  
   - Compare price/network/payTo to package constants; print `{match: bool, discovered, expected}`  
   - **No payment.**  
   - Tests for discover: inject opener/transport; **do not** hit network in unit tests.

5. **`version`** — print package version.

Commits: `feat(crew-mcp): CLI for trust roster evolve x402-discover` + `test(crew-mcp): CLI unit tests` + `docs(crew-mcp): CLI and logfire runbook`

**Done when:** full suite green; `python -m gc_crew_mcp roster` works with PYTHONPATH=src.

---

### Task 3: submit_metrics base_url trust gate + live-safe evolve command flag

**Files:**
- Modify: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/evolve_hook.py`
- Modify: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/cli.py`
- Modify: `gc-workers/gc-crew-mcp-bridge/tests/test_evolve_hook.py`
- Modify: `gc-workers/gc-crew-mcp-bridge/tests/test_cli.py`

**Requirements:**

1. `submit_metrics`: after scheme check, require `is_trusted_url(base_url)` **or** `is_trusted_url(base_url.rstrip('/') + '/')` handling — prefer: trust check on `base_url` if it looks like full URL with path, else on `base_url` as origin. Simplest correct rule: parse host from base_url; trust if host in TRUSTED_HOSTS or suffix `.genesisconductor.io` (reuse `is_trusted_url` by building `f"{scheme}://{netloc}/"`).
2. CLI `evolve-dry --live` only runs real transport if `--base-url` trusted **and** (`--payment-proof` env `X402_PAYMENT_PROOF` or `--admin-key` env `X_ADMIN_KEY`); else exit 2 with clear message. Default remains mock.
3. Tests for untrusted base_url raises ValueError; live flag without proof exits 2.
4. Commit: `feat(crew-mcp): trust-gate evolve base_url and safe --live` + tests

**Done when:** suite green; untrusted base rejected.

---

## Done when (plan)

- All three tasks complete with clean task reviews
- Full unittest green (expect ~90+)
- Operator can run without logfire:  
  `PYTHONPATH=src python -m gc_crew_mcp trust-check https://optimization-inversion.genesisconductor.io/mcp`  
  `PYTHONPATH=src python -m gc_crew_mcp roster`  
  `PYTHONPATH=src python -m gc_crew_mcp evolve-dry --goal-status partial`  
  `PYTHONPATH=src python -m gc_crew_mcp x402-discover` (network optional smoke; unit-tested via inject)
- Manual remaining: `pip install 'logfire'` + `LOGFIRE_TOKEN=...` or `logfire auth` for real traces

## Out of scope

- Live USDC payment settlement / CDP facilitator fix
- CrewAI runtime install
- Push/PR (human finishing choice)
- Writing to root-owned `~/.grok/workflows`
