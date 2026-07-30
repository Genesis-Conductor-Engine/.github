# gc-crew-mcp-bridge

CrewAI-compatible MCP adapter and trust policy for Genesis Conductor multi-agent crews.

Task 1 restored the home-repo deny-all `.gitignore` surface (required for allowlist `!` lines to work) and un-ignores this package beside `x402-paid-service`.

## What this is

- **Trust policy** (`gc_crew_mcp.trust`): allowlist trusted MCP hosts, block dangerous tools by default.
- **Agent specs** (`gc_crew_mcp.agents`): declarative `AgentSpec` + `to_crewai_kwargs` for CrewAI (or pure-stdlib fallback when `crewai` is not installed).
- **Crew topology** (`gc_crew_mcp.crew_topology`): multi-domain roster with isolation (`Domain`, `CREW_ROSTER`, `validate_roster`, `parallel_dispatch_plan`).

## Crew topology (domain isolation)

| Role | Domain | Allowed tools | MCP / base |
|------|--------|---------------|------------|
| Researcher | `RESEARCH` | `search`, `get_status`, `list_tools` | `https://optimization-inversion.genesisconductor.io/mcp` (placeholder) |
| Payment | `PAYMENT` | `get_price`, `inspect_402`, `list_tiers` | `https://optimization-inversion.genesisconductor.io/.well-known/x402` (trusted host; no settle in unit tests) |
| Ops | `OPS` | `get_status`, `health` | trusted ambient MCP URL; no secrets |
| Evolve coach | `EVOLVE` | `post_metrics`, `list_candidates` | no production MCP beyond retrainer base (`RETRAINER_BASE_URL`) |

Isolation rules: one domain per agent; `domains_conflict` is true for the same domain string; `RESEARCH` conflicts with none of `{PAYMENT, OPS, EVOLVE}`; `PAYMENT` would conflict with `OPS` only if both had deploy (they must not). `validate_roster` rejects blocked tools in `allowed_tools` and untrusted MCP URLs.

## Trusted hosts

HTTPS only (remote):

- `optimization-inversion.genesisconductor.io`
- `fed.genesisconductor.io`
- any host ending with `.genesisconductor.io`

HTTP only (local tests):

- `localhost`
- `127.0.0.1`

## Default blocked tools

`delete`, `deploy`, `secret_put`, `write_file`, `rm`, `drop_table`

Agents use **deny-all-then-allow** via `filter_tools`:

- `allowed=None` → no tools pass (`[]`)
- `allowed={...}` → only those names, minus blocked
- custom `blocked=` is **unioned** with `DEFAULT_BLOCKED_TOOLS` (cannot remove defaults)

## MCP placeholder

Researcher MCP URL:

```
https://optimization-inversion.genesisconductor.io/mcp
```

This is a **placeholder**. The ambient health endpoint is:

```
https://optimization-inversion.genesisconductor.io/health
```

Health is **not** an MCP. The real `/mcp` path may 404 until wired; the URL still must pass trust checks.

## Install / test

```bash
cd gc-workers/gc-crew-mcp-bridge
PYTHONPATH=src python -m unittest discover -s tests -v
```

Optional extras:

```bash
pip install -e ".[crewai]"   # optional; adapter works without it
pip install -e ".[mcp]"
```

## Env var names only (no secrets in repo)

- `GC_MCP_TOKEN`
- `RETRAINER_BASE_URL`
- `X402_PAYMENT_PROOF`

## Constraints

- No fund movement / no live x402 settle in this package's unit tests.
- No secrets committed.
