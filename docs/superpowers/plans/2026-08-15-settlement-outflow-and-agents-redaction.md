# Settlement Outflow + AGENTS.md Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a reconcilable Base USDC outflow report for the settlement wallet since 2026-08-09, and redact live credentials from diamondnode `AGENTS.md` without copying secrets off-box.

**Architecture:** Two independent deliverables. Task 1 is a read-only chain investigation written to a local markdown report. Task 2 is an on-box redaction of `/home/diamondnode/AGENTS.md` with a local category-only log. Neither task needs the other's output.

**Tech Stack:** `curl` + public Base RPC / Blockscout (primary), Dune CLI `dune query run-sql` (fallback), `ssh -F ~/.ssh/config diamondnode`, Python 3 stdlib for parse/reconcile.

**Spec:** `docs/superpowers/plans/2026-08-15-settlement-outflow-and-agents-redaction-SPEC.md`

## Global Constraints

- Never print, log, commit, or paste secret values (including into reports, briefs, or chat).
- Never pass private keys or API keys on a command line.
- Trust live RPC / explorer / Dune rows over prose when they disagree.
- Redact only — do not rotate, delete, or force-push.
- Stage only allowlisted `docs/` paths in the home-directory git repo.
- Conventional Commits (`docs:` / `security:`).
- Do not spawn nested reviewers or helper subagents.
- Settlement wallet is exactly `0x937897fe19F675c96a71078820F21cA9bD637180`.
- USDC (Base) is exactly `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals).
- Window start is exactly `2026-08-09T00:00:00Z`.
- Opening prose balance is 61,745 USDC; live close was 54,428.133083 USDC on 2026-08-15 — re-read live `balanceOf` at report time.
- Replacement form for secrets is `[REDACTED:<KIND>]` with KIND from the spec list.

---

### Task 1: Settlement USDC outflow report

**Files:**
- Create: `docs/superpowers/plans/2026-08-15-settlement-usdc-outflow.md`
- Test: inline reconciliation in that file plus a one-shot Python check that `opening + in - out` vs live `balanceOf` is printed (do not invent rows)

**Interfaces:**
- Consumes: spec S1; public chain data
- Produces: markdown report with transfer table + totals + residual

- [ ] **Step 1: Write the failing check**

Create the report file with a `## Reconciliation` section that contains placeholders only, then run a check that fails because no transfers have been collected:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path("/Users/igorholt/docs/superpowers/plans/2026-08-15-settlement-usdc-outflow.md")
text = p.read_text()
assert "| tx |" in text or "| Tx |" in text, "report missing transfer table"
assert "residual" in text.lower()
print("structure ok")
# Fail until a numeric Net USDC line exists
import re
m = re.search(r"Net USDC:\s*(-?[0-9]+(?:\.[0-9]+)?)", text)
assert m, "missing Net USDC total"
print("unexpected pass")
PY
```

Expected: FAIL with `missing Net USDC total` (or missing file).

- [ ] **Step 2: Pull transfers**

Prefer Blockscout, paginate until empty. Filter to the USDC contract. Window: `evt_block_time >= 2026-08-09T00:00:00Z`.

```bash
# page example — follow next_page_params until none
curl -sS -A 'Mozilla/5.0' --max-time 30 \
  "https://base.blockscout.com/api/v2/addresses/0x937897fe19F675c96a71078820F21cA9bD637180/token-transfers?type=ERC-20"
```

If Blockscout is incomplete or rate-limited, fall back to Dune (already authenticated as `qmcp`):

```sql
SELECT
  evt_block_time,
  to_hex(evt_tx_hash) AS tx,
  to_hex("from") AS from_addr,
  to_hex("to") AS to_addr,
  CAST(value AS double) / 1e6 AS usdc
FROM erc20_base.evt_Transfer
WHERE contract_address = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  AND evt_block_time >= TIMESTAMP '2026-08-09 00:00:00'
  AND (
    "from" = 0x937897fe19F675c96a71078820F21cA9bD637180
    OR "to"   = 0x937897fe19F675c96a71078820F21cA9bD637180
  )
ORDER BY evt_block_time
```

```bash
dune query run-sql --timeout 180 -o json --sql '<SQL above>'
```

If `erc20_base.evt_Transfer` is private/missing, try `erc20_base.evt_transfer` then `tokens_base.transfers`. Record which table worked.

- [ ] **Step 3: Live close balance**

```bash
# USDC balanceOf
# data = 0x70a08231 + left-padded settlement address
curl -sS -A 'Mozilla/5.0' -H 'Content-Type: application/json' \
  -X POST https://mainnet.base.org \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","data":"0x70a08231000000000000000000000000937897fe19F675c96a71078820F21cA9bD637180"},"latest"]}'
```

Divide the hex result by 1e6. Re-query if the node 403s (retry `https://1rpc.io/base`).

- [ ] **Step 4: Write the report**

Required sections, in this order:

1. `## Scope` — wallet, token, window, sources used
2. `## Transfers` — markdown table columns: `time_utc | tx | direction | counterparty | usdc | label`
3. `## Totals` — lines exactly:
   - `Opening USDC (prose 2026-08-09): 61745`
   - `Sum in USDC: <n>`
   - `Sum out USDC: <n>`
   - `Net USDC: <n>`
   - `Live close USDC: <n>`
   - `Implied close (opening + net): <n>`
   - `Residual USDC: <live - implied>`
4. `## Residual notes` — why implied ≠ live if they differ; do not invent rows
5. `## Method` — endpoint/table, page count, any dropped spam

Known public labels (use only these; do not add key material):

| Address | Label |
|---------|--------|
| `0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75` | treasury |
| `0x60C4499870f115664d7FfD8411b023DBEf3377d9` | hot_x402 |
| `0x967a9C352a87D3a72baa7aD10632A7276101dBc9` | x402_main |
| `0x70B765C1A6cD19168111c8725101e1F0e8eB2c1E` | bot_hot |
| `0x4F39078a88512a191245281bDE828506f26Fc3E6` | reserve |
| `0x8f1C545729Ce073B17B2aB4594635eb939E2439B` | staking |
| `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | usdc |

- [ ] **Step 5: Re-run the check and confirm it passes**

```bash
python3 - <<'PY'
from pathlib import Path
import re
text = Path("/Users/igorholt/docs/superpowers/plans/2026-08-15-settlement-usdc-outflow.md").read_text()
def num(label):
    m = re.search(rf"{re.escape(label)}:\s*(-?[0-9]+(?:\.[0-9]+)?)", text)
    assert m, f"missing {label}"
    return float(m.group(1))
opening = num("Opening USDC (prose 2026-08-09)")
inn = num("Sum in USDC")
out = num("Sum out USDC")
net = num("Net USDC")
live = num("Live close USDC")
implied = num("Implied close (opening + net)")
residual = num("Residual USDC")
assert opening == 61745
assert abs(net - (inn - out)) < 1e-6, (net, inn, out)
assert abs(implied - (opening + net)) < 1e-6
assert abs(residual - (live - implied)) < 1e-6
assert "0x937897fe19F675c96a71078820F21cA9bD637180" in text
print("reconcile ok", {"in": inn, "out": out, "net": net, "live": live, "residual": residual})
PY
```

Expected: `reconcile ok` and a printed totals dict.

- [ ] **Step 6: Commit**

```bash
cd /Users/igorholt
git add docs/superpowers/plans/2026-08-15-settlement-usdc-outflow.md
git commit -m "docs: settlement USDC outflow since 2026-08-09"
```

Do not `git add .`. Scan the report for `alcht_`, `sk-`, `PRIVATE_KEY`, hex-64 keys before committing.

---

### Task 2: Redact diamondnode AGENTS.md

**Files:**
- Modify (remote): `/home/diamondnode/AGENTS.md`
- Create (remote backup, once): `/home/diamondnode/AGENTS.md.bak.pre-redact-20260815`
- Create (local): `docs/superpowers/plans/2026-08-15-agents-md-redaction-log.md`

**Interfaces:**
- Consumes: spec S2; `ssh -F ~/.ssh/config -o BatchMode=yes diamondnode`
- Produces: redacted remote file + category-only local log

- [ ] **Step 1: Backup if missing**

```bash
ssh -F ~/.ssh/config -o BatchMode=yes diamondnode \
  'test -f /home/diamondnode/AGENTS.md.bak.pre-redact-20260815 \
    || cp -p /home/diamondnode/AGENTS.md /home/diamondnode/AGENTS.md.bak.pre-redact-20260815
   ls -l /home/diamondnode/AGENTS.md /home/diamondnode/AGENTS.md.bak.pre-redact-20260815'
```

Do not `cat` the file in any command whose stdout will be copied into the report.

- [ ] **Step 2: Write a failing scan**

Run this scan against the **live** (still-secret) file. Expected: FAIL (hits > 0). Do not print matching lines — counts only.

```bash
ssh -F ~/.ssh/config -o BatchMode=yes diamondnode 'python3 - <<'"'"'PY'"'"'
from pathlib import Path
import re
text = Path("/home/diamondnode/AGENTS.md").read_text()
pats = {
  "alcht_": r"alcht_[A-Za-z0-9]+",
  "sk-": r"sk-[A-Za-z0-9_-]{10,}",
  "xai-": r"xai-[A-Za-z0-9_-]{10,}",
  "sim_": r"sim_[A-Za-z0-9]+",
  "dune_": r"dune_[A-Za-z0-9]+",
  "temp-password": r"temp-password",
  "hex64_priv": r"0x[a-fA-F0-9]{64}",
}
hits = {k: len(re.findall(v, text)) for k,v in pats.items()}
print({k:v for k,v in hits.items() if v})
raise SystemExit(0 if sum(hits.values())==0 else 1)
PY'
```

Expected: exit 1 with a count dict (no secret values).

- [ ] **Step 3: Redact on-box**

Perform the rewrite **on diamondnode** so secret values never cross SSH stdout. Use a Python script that:

- Reads `/home/diamondnode/AGENTS.md`
- Replaces secret-shaped values with `[REDACTED:<KIND>]` per the spec
- Also replaces obvious labeled secrets (`password`, `passcode`, `PRIVATE_KEY = 0x…`, RPC URL path tails after `/v2/` or `/rpc/v1/`)
- Must **not** redact public 20-byte addresses (42-char `0x` + 40 hex)
- Writes back atomically (`*.tmp` then `os.replace`)
- Prints only a JSON object of `{KIND: count}` to stdout

If a value is clearly a secret but KIND is ambiguous, use `OTHER_SECRET`.

- [ ] **Step 4: Re-run the scan on the redacted file**

Same scan as Step 2. Expected: exit 0 and empty/no hits.

Also confirm operational facts survived:

```bash
ssh -F ~/.ssh/config -o BatchMode=yes diamondnode \
  'grep -c 0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75 /home/diamondnode/AGENTS.md
   grep -c 0x937897fe19F675c96a71078820F21cA9bD637180 /home/diamondnode/AGENTS.md
   grep -c 0x60C4499870f115664d7FfD8411b023DBEf3377d9 /home/diamondnode/AGENTS.md
   test ! -s /dev/null
   grep -E "alcht_|temp-password|sk-|xai-" /home/diamondnode/AGENTS.md && exit 1 || echo CLEAN'
```

Expected: each address count ≥ 1, and `CLEAN`.

- [ ] **Step 5: Local category log (no values)**

Write `docs/superpowers/plans/2026-08-15-agents-md-redaction-log.md` with:

- Backup path
- `{KIND: count}` table
- Scan command + exit 0
- Confirmation that address lines remain
- Explicit statement that no secret values were copied off-box

- [ ] **Step 6: Commit the log only**

```bash
cd /Users/igorholt
git add docs/superpowers/plans/2026-08-15-agents-md-redaction-log.md
git commit -m "security: redact diamondnode AGENTS.md credentials"
```

Do not add the remote file. Do not add `*.bak*`. Scan the log for secret-shaped strings before committing.

---

## Preflight notes (controller)

| Pair | Shared surface | Finding |
|------|----------------|---------|
| Task 1 ↔ Task 2 | none required | Independent. Task 2 must not wait on Task 1 numbers. |
| Task 1 self | report vs check | Same labels (`Net USDC:`) used by the Python check. |
| Task 2 self | remote file vs log | Log is counts only; file rewrite is on-box. |

No spec/plan contradiction found. Home-directory worktree isolation is unsafe; work in place on the current branch.
