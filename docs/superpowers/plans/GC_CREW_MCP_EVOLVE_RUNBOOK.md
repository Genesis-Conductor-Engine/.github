# GC Crew MCP Evolve — Runbook

**Plan:** [`2026-07-30-gc-crew-mcp-evolve-sdd.md`](./2026-07-30-gc-crew-mcp-evolve-sdd.md)  
**Package:** `gc-workers/gc-crew-mcp-bridge/` (`gc_crew_mcp`)  
**Workflow (repo copy):** [`gc-crew-mcp-evolve.rhai`](./gc-crew-mcp-evolve.rhai)

Deliver the three evolve domains (MCP trust, crew topology, metrics → retrainer x402) without moving funds or rotating keys.

---

## Related runbooks / blockers

| Doc | Why it matters |
| --- | --- |
| `gc-workers/REVENUE_RUNBOOK.md` | Revenue tokens/ops; do **not** invent secrets; Shopify/Stripe activation is out of scope here |
| `gc-workers/x402-paid-service/LAUNCH_PLAN.md` | **Blocker #1**: facilitator `mode=cdp` is a prerequisite for real settle; P1 no-fund-move still open |
| [`INCOMPLETE_GOALS_RUNBOOK.md`](./INCOMPLETE_GOALS_RUNBOOK.md) | Goal outcome enum: `reached \| not_reached \| partial \| ambient \| unknown` |
| [`MINING_CLAUDE_RUNBOOK.md`](./MINING_CLAUDE_RUNBOOK.md) | Session mining (wallets/phrases) — separate from goal classify |

**Live USDC pay is out of scope** until LAUNCH_PLAN facilitator mode is CDP-ready. This package documents the 402 contract and uses **mock transport** in tests.

---

## Prerequisites

- Python 3.11+
- No secrets in repo; env **names** only: `GC_MCP_TOKEN`, `RETRAINER_BASE_URL`, `X402_PAYMENT_PROOF`
- Worktree: `/Users/igorholt/.worktrees/feat-gc-crew-mcp-evolve` (or clone path)

```bash
cd gc-workers/gc-crew-mcp-bridge
PYTHONPATH=src python -c "import gc_crew_mcp; print(gc_crew_mcp.__version__)"
```

---

## Run unit tests

```bash
cd gc-workers/gc-crew-mcp-bridge
PYTHONPATH=src python -m unittest discover -s tests -v
```

Suite covers trust, agents, crew topology, metrics, x402_client, evolve_hook.  
**No network and no live payment** in unit tests.

Evolve-only slice:

```bash
PYTHONPATH=src python -m unittest \
  tests.test_metrics tests.test_x402_client tests.test_evolve_hook -v
```

---

## Dry-run `evolve_hook` with mock transport

Never pass real private keys. Mock returns 402 then 200:

```bash
cd gc-workers/gc-crew-mcp-bridge
PYTHONPATH=src python - <<'PY'
from gc_crew_mcp.metrics import RunMetrics
from gc_crew_mcp.evolve_hook import submit_metrics
from gc_crew_mcp.x402_client import RETRAINER_NETWORK, RETRAINER_PAY_TO

base = "https://optimization-inversion.genesisconductor.io"
m = RunMetrics(
    quality=0.85,
    latency_ms=100.0,
    cost_usdc6=0,
    goal_status="partial",
    candidate_id="dry-run-1",
)

def mock_402(method, url, headers, body):
    assert method == "POST" and url.endswith("/admin/slices")
    assert "payment_proof" not in body and "admin_key" not in body
    return 402, {
        "accepts": [{
            "amount": "10000",
            "network": RETRAINER_NETWORK,
            "payTo": RETRAINER_PAY_TO,
        }]
    }

def mock_200(method, url, headers, body):
    return 200, {"accepted": True, "slice": body}

r402 = submit_metrics(base, m, transport=mock_402)
assert r402["status"] == "payment_required"
assert r402["x402"]["price_usdc6"] == 10000
print("402 path:", r402)

r200 = submit_metrics(base, m, admin_key="ENV_NAME_ONLY", transport=mock_200)
assert r200["status"] == "ok"
print("200 path:", r200["status"], "source=", r200["body"]["slice"]["source"])
PY
```

Auth headers (when provided) are **only** `X-Payment-Proof` and/or `x-admin-key` — never in JSON body.

---

## Live discovery only (no pay)

Read-only ambient health:

```bash
curl -sS -m 10 https://optimization-inversion.genesisconductor.io/health
```

x402 well-known discovery (no settlement; inspect JSON only):

```bash
curl -sS -m 10 \
  https://optimization-inversion.genesisconductor.io/.well-known/x402 | head -c 2000
echo
```

Expected contract (self-evolving-retrainer admin, $0.01):

| Constant | Value |
| --- | --- |
| `X402_PRICE_USDC6` / `DEFAULT_PRICE_USDC6` | `10000` ($0.01) |
| `payTo` | `0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8` |
| `network` | `eip155:8453` (Base) |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Admin routes | `POST /admin/slices`, `/admin/sweep`, `/admin/evaluate/:id` |
| Discovery | `GET /.well-known/x402` |

**Do not** `POST /admin/slices` with a real payment proof from this runbook until LAUNCH_PLAN confirms facilitator `mode=cdp` and operator approval. Real settle is blocked by design here.

---

## Classify incomplete goals after a crew run

Use the Incomplete Goals classifier (stdlib; fixtures for CI):

```bash
cd scripts/claude-mine
PYTHONPATH=. python -m claude_mine goals --help

# One session (do not commit output):
PYTHONPATH=. python -m claude_mine goals session \
  ~/.claude/projects/<project>/<session>.jsonl \
  --out /tmp/goals-crew-run

# Or scan incomplete only:
PYTHONPATH=. python -m claude_mine goals scan \
  --root ~/.claude/projects \
  --out /tmp/goals-incomplete
```

Map classifier `status` into `RunMetrics.goal_status` before `submit_metrics`.  
Valid enum only: `reached | not_reached | partial | ambient | unknown`.

Details: [`INCOMPLETE_GOALS_RUNBOOK.md`](./INCOMPLETE_GOALS_RUNBOOK.md).

---

## Durable workflow install

Repo-tracked workflow (always available):

```
docs/superpowers/plans/gc-crew-mcp-evolve.rhai
```

Phases: **Sense** (health) → **TrustScan** → **TopologyValidate** → **MetricsDryRun** → **RunbookCheck**.  
`meta.name = "gc-crew-mcp-evolve"`, `agent_budget` ≤ 16.

Preferred Grok install path is root-owned on this machine:

```bash
# ~/.grok/workflows is root-owned — use sudo for install copy only
sudo cp docs/superpowers/plans/gc-crew-mcp-evolve.rhai \
  ~/.grok/workflows/gc-crew-mcp-evolve.rhai
sudo chown root:staff ~/.grok/workflows/gc-crew-mcp-evolve.rhai  # keep consistent with siblings if needed
ls -la ~/.grok/workflows/gc-crew-mcp-evolve.rhai
```

Do **not** run live-pay phases from the workflow defaults; MetricsDryRun is mock transport only.

---

## Module map (Domain C)

| Module | Responsibility |
| --- | --- |
| `gc_crew_mcp.metrics` | `RunMetrics`, `validate_goal_status`, `to_ralph_payload` |
| `gc_crew_mcp.x402_client` | Constants, `parse_402_body`, `build_admin_request`, `classify_response`, injectable `fetch_well_known` |
| `gc_crew_mcp.evolve_hook` | `submit_metrics` → `POST /admin/slices`; 402 → `{status: payment_required, x402}` |

---

## Out of scope (parked)

- Live USDC payments / CDP facilitator fix (LAUNCH_PLAN R1)
- Shopify/Stripe token activation (REVENUE_RUNBOOK)
- Workers deploy / wrangler
- Installing `crewai` when network is blocked (optional extra only)

---

## Constraints (always)

1. No secrets committed (no `.env`, PEMs, mnemonics).
2. No fund movement / no key rotation in this runbook.
3. Unit tests: mock transport only.
4. Trusted MCP hosts only; deny-all-then-allow tools (see package README).
