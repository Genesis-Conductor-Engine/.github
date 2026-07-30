# GC Crew MCP Evolve — SDD Plan (all three domains)

**Goal:** Deliver the three evolve domains as a trackable package under Genesis Conductor: (1) MCP adapter + trust policy, (2) three-agent crew topology with domain isolation, (3) evolve-hook metrics into self-evolving-retrainer with x402 awareness. Wire to existing runbooks (Revenue, Incomplete Goals, x402 Launch) without moving funds or rotating keys.

**Architecture:** New Python package `gc-workers/gc-crew-mcp-bridge/` (git allowlisted). CrewAI-compatible `mcps` configs + pure-stdlib fallback when `crewai` is not installed. Agents are declarative; evolve_hook POSTs metrics to retrainer admin routes (x402 402 contract documented; live pay optional). Durable orchestration described via Grok workflow `gc-crew-mcp-evolve.rhai`.

**Tech stack:** Python 3.11+ stdlib for tests; optional `crewai`/`mcp` extras in pyproject. unittest. Conventional Commits. No secrets in repo.

**Related runbooks / sources:**
- `gc-workers/REVENUE_RUNBOOK.md` — revenue tokens/ops (do not invent secrets; no fund moves)
- `gc-workers/x402-paid-service/LAUNCH_PLAN.md` — Blocker #1 facilitator; no live settle in this plan
- `docs/superpowers/plans/INCOMPLETE_GOALS_RUNBOOK.md` — goal outcome enum for evolve reports
- Self-evolving retrainer routes: `/.well-known/x402`, `/admin/slices`, `/admin/sweep`, `/admin/evaluate/:id` at $0.01 USDC (`X402_PRICE_USDC6=10000`, payTo `0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8`, network `eip155:8453`)
- Ambient health: `https://optimization-inversion.genesisconductor.io/health`
- CrewAI MCP: https://docs.crewai.com/en/mcp/overview.md

---

## Global Constraints

1. **No secrets committed.** No `.env`, keys, PEMs, mnemonics. Use env var *names* only (`GC_MCP_TOKEN`, `RETRAINER_BASE_URL`, `X402_PAYMENT_PROOF`).
2. **No fund movement / no key rotation** in this plan (LAUNCH_PLAN P1 still open). Code may *document* x402 payment headers; tests mock 402/200 only.
3. **Deny-all-then-allow tools:** every agent has an explicit tool allowlist; blocked tools include `delete`, `deploy`, `secret_put`, `write_file` unless task explicitly allows.
4. **Trusted MCP hosts only** (exact set):
   - `optimization-inversion.genesisconductor.io`
   - `fed.genesisconductor.io`
   - `localhost` / `127.0.0.1` (stdio/local only for tests)
   - Hosts ending with `.genesisconductor.io` may be allowed via suffix rule
5. **Git allowlist:** package path must be un-ignored via `.gitignore` `!/gc-workers/gc-crew-mcp-bridge/` + `!**` under it (mirror x402-paid-service pattern). Do not stage unrelated dirty files (yennefer feed, existing x402 index.ts dirty tree, etc.).
6. **Commits** use Conventional Commits prefixes: `feat(crew-mcp):`, `test(crew-mcp):`, `docs(crew-mcp):`, `chore(crew-mcp):`.
7. **Tests:** unittest (stdlib). Fixtures only; no network in unit tests. Exit 0 required before commit.
8. **Goal status strings** for evolve reports must use Incomplete Goals enum when classifying outcomes: `reached | not_reached | partial | ambient | unknown`.
9. **x402 amounts** in docs/code constants: atomic USDC6; `$0.01` = `10000`.
10. **Do not modify** production deploy config of x402-paid-service or self-evolving-retrainer except optional *read-only* client code in the new package.
11. **Python package layout** under `gc-workers/gc-crew-mcp-bridge/`:
    ```
    pyproject.toml
    README.md
    llms.txt
    src/gc_crew_mcp/
      __init__.py
      trust.py
      agents.py
      crew_topology.py
      evolve_hook.py
      x402_client.py
      metrics.py
    tests/
      test_trust.py
      test_agents.py
      test_crew_topology.py
      test_evolve_hook.py
      test_x402_client.py
    ```
12. **Work only on this plan's branch/worktree.** Do not merge or push unless the human asks.

---

### Task 1: Allowlist + trust policy + agent MCP adapter (Domain A / E1)

**Files:**
- Modify: `.gitignore` — allow `gc-workers/gc-crew-mcp-bridge/**`
- Create: `gc-workers/gc-crew-mcp-bridge/pyproject.toml`
- Create: `gc-workers/gc-crew-mcp-bridge/README.md`
- Create: `gc-workers/gc-crew-mcp-bridge/llms.txt`
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/__init__.py`
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/trust.py`
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/agents.py`
- Create: `gc-workers/gc-crew-mcp-bridge/tests/test_trust.py`
- Create: `gc-workers/gc-crew-mcp-bridge/tests/test_agents.py`

**Requirements:**

1. `.gitignore` additions (after existing x402-paid-service allowlist):
   ```
   !/gc-workers/gc-crew-mcp-bridge/
   !/gc-workers/gc-crew-mcp-bridge/**
   ```
2. `trust.py`:
   - `TRUSTED_HOSTS: frozenset` including `optimization-inversion.genesisconductor.io`, `fed.genesisconductor.io`, `localhost`, `127.0.0.1`
   - `is_trusted_url(url: str) -> bool` — True only for `https://` remote trusted hosts (or suffix `.genesisconductor.io`) OR `http://localhost` / `http://127.0.0.1` for tests
   - `DEFAULT_BLOCKED_TOOLS: frozenset = frozenset({"delete","deploy","secret_put","write_file","rm","drop_table"})`
   - `filter_tools(tool_names: list[str], allowed: set[str] | None = None, blocked: set[str] | None = None) -> list[str]`
   - `assert_trusted_mcps(mcps: list[str]) -> None` raises `ValueError` if any https URL host fails trust
3. `agents.py`:
   - Dataclass `AgentSpec` with fields: `role: str`, `goal: str`, `backstory: str`, `mcps: list[str]`, `allowed_tools: list[str]`
   - `build_researcher_agent() -> AgentSpec` with mcps pointing at ambient health URL as string `"https://optimization-inversion.genesisconductor.io/health"` **is NOT an MCP** — use placeholder MCP URL string `"https://optimization-inversion.genesisconductor.io/mcp"` and document that real MCP path may 404 until wired; still must pass trust.
   - `to_crewai_kwargs(spec: AgentSpec) -> dict` returns dict with keys `role`, `goal`, `backstory`, `mcps` (filtered via trust). If crewai not installed, still return the dict (import optional).
4. Tests cover: trust accept/reject, filter_tools allow/block, assert_trusted_mcps raises, agent kwargs shape.
5. Commits:
   - `chore(crew-mcp): allowlist gc-crew-mcp-bridge in gitignore`
   - `feat(crew-mcp): trust policy and AgentSpec MCP adapter`
   - `test(crew-mcp): trust and agents unit tests`

**Done when:** `cd gc-workers/gc-crew-mcp-bridge && PYTHONPATH=src python -m unittest discover -s tests -v` passes.

---

### Task 2: Three-agent crew topology with domain isolation (Domain B / E2)

**Files:**
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/crew_topology.py`
- Create: `gc-workers/gc-crew-mcp-bridge/tests/test_crew_topology.py`
- Modify: `gc-workers/gc-crew-mcp-bridge/README.md` (topology table)

**Requirements:**

1. `Domain` enum or constants: `RESEARCH`, `PAYMENT`, `OPS`, `EVOLVE`
2. `CREW_ROSTER: list[AgentSpec]` built via factory functions:
   - **Researcher** — domain RESEARCH; allowed_tools: `search`, `get_status`, `list_tools`; mcps: trusted research MCP URL only
   - **Payment** — domain PAYMENT; allowed_tools: `get_price`, `inspect_402`, `list_tiers`; mcps may include x402 well-known as URL string `https://optimization-inversion.genesisconductor.io/.well-known/x402` only if `is_trusted_url` accepts host (it does); no write/deploy tools
   - **Ops** — domain OPS; allowed_tools: `get_status`, `health`; no secrets
   - **Evolve coach** — domain EVOLVE; allowed_tools: `post_metrics`, `list_candidates`; no production MCP tool calls beyond retrainer base
3. `domains_conflict(a: str, b: str) -> bool` — True if two domains would share mutable write scope. Matrix: RESEARCH conflicts with none of {PAYMENT, OPS, EVOLVE}; PAYMENT conflicts with OPS only if both have deploy (they must not); default: no two agents share the same `domain` string.
4. `validate_roster(roster) -> list[str]` returns empty list if OK; otherwise human-readable conflict messages. Must fail if any agent has blocked tools in allowed_tools, or untrusted MCP URL.
5. `parallel_dispatch_plan(roster) -> list[dict]` returns one dict per agent: `{role, domain, mcps, allowed_tools}` sorted by domain name — documents SDD/parallel-agent isolation.
6. Tests: roster length >= 3, validate_roster empty, conflict detection, parallel plan has unique domains.
7. Commit: `feat(crew-mcp): three-agent crew topology with domain isolation` + `test(crew-mcp): crew topology tests`

**Done when:** unittest suite green including topology tests.

---

### Task 3: evolve_hook + x402 client metrics → retrainer (Domain C / E3)

**Files:**
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/metrics.py`
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/x402_client.py`
- Create: `gc-workers/gc-crew-mcp-bridge/src/gc_crew_mcp/evolve_hook.py`
- Create: `gc-workers/gc-crew-mcp-bridge/tests/test_metrics.py`
- Create: `gc-workers/gc-crew-mcp-bridge/tests/test_x402_client.py`
- Create: `gc-workers/gc-crew-mcp-bridge/tests/test_evolve_hook.py`
- Create: `~/.grok/workflows/gc-crew-mcp-evolve.rhai` (user workflow; not necessarily git-tracked)
- Create: `docs/superpowers/plans/GC_CREW_MCP_EVOLVE_RUNBOOK.md`

**Requirements:**

1. `metrics.py`:
   - Dataclass `RunMetrics` with: `quality: float`, `latency_ms: float`, `cost_usdc6: int`, `goal_status: str`, `candidate_id: str | None`
   - `validate_goal_status(s: str) -> str` — must be one of Incomplete Goals enum; else raise ValueError
   - `to_ralph_payload(m: RunMetrics) -> dict` keys: `quality`, `latency_ms`, `cost_usdc6`, `goal_status`, `candidate_id`, `source: "gc-crew-mcp-bridge"`
2. `x402_client.py` (stdlib urllib only):
   - Constants: `DEFAULT_PRICE_USDC6 = 10000`, document payTo and network matching retrainer
   - `parse_402_body(body: dict) -> dict` extracts price/network/payTo from retrainer-style JSON
   - `build_admin_request(base_url: str, path: str, payment_proof: str | None, admin_key: str | None) -> tuple[str, dict]` returns full URL and headers (`X-Payment-Proof` and/or `x-admin-key`)
   - `classify_response(status: int, body: dict | None) -> str` returns `ok|payment_required|error`
   - **No real HTTP pay in unit tests.** Optional `fetch_well_known(base_url, opener=...)` injectable for tests.
3. `evolve_hook.py`:
   - `submit_metrics(base_url: str, metrics: RunMetrics, *, payment_proof=None, admin_key=None, transport=callable) -> dict`
   - Default path: `POST {base_url}/admin/slices` with JSON payload from `to_ralph_payload`
   - transport injectable: `transport(method, url, headers, body) -> tuple[int, dict]`
   - On 402: return `{status: "payment_required", x402: parsed}` without raising
   - On 200: return `{status: "ok", body: ...}`
   - Map goal_status into payload; never send secrets
4. Runbook `GC_CREW_MCP_EVOLVE_RUNBOOK.md`:
   - How to run unit tests
   - How to dry-run evolve_hook with mock transport
   - How to call live `/.well-known/x402` with curl (no pay)
   - Link REVENUE_RUNBOOK + LAUNCH_PLAN blockers (facilitator mode=cdp prerequisite for real pay)
   - How to classify incomplete goals after a crew run via `python -m claude_mine goals`
5. Workflow file `~/.grok/workflows/gc-crew-mcp-evolve.rhai` with phases: Sense (health), TrustScan, TopologyValidate, MetricsDryRun, RunbookCheck — each phase an `agent()` call with short prompts; `meta.name = "gc-crew-mcp-evolve"`. Keep agent_budget modest (≤ 16).
6. Commits:
   - `feat(crew-mcp): metrics evolve_hook and x402 client`
   - `test(crew-mcp): evolve_hook and x402 unit tests`
   - `docs(crew-mcp): evolve runbook`

**Done when:** full unittest green; runbook present; workflow file exists.

---

## Done when (plan complete)

- All three tasks complete with clean task reviews
- Full suite green
- Package importable via `PYTHONPATH=src`
- No secrets staged; no unrelated dirty files in commits
- Final whole-branch review clean or parked minors only
- Goal can be marked complete after evidence review of tests + commits

## Out of scope

- Live USDC payments / CDP facilitator fix (LAUNCH_PLAN R1)
- Shopify/Stripe token activation (REVENUE_RUNBOOK tokens)
- Deploying Workers / wrangler deploy
- Installing crewai in CI if network blocked (optional extra only)
- Slack snap install
