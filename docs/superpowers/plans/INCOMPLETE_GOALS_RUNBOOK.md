# Incomplete Agentic Goals — Runbook

**Plan:** `docs/superpowers/plans/2026-07-21-incomplete-goals-sdd.md`  
**Ledger:** `.superpowers/sdd/progress-incomplete-goals.md`  
**Package:** `scripts/claude-mine/` (`goal_status.py` + `goals` CLI)  
**Inventory (human-curated):** [`INCOMPLETE_GOALS_INVENTORY_2026-07-21.md`](./INCOMPLETE_GOALS_INVENTORY_2026-07-21.md)

Classify Claude Code sessions as `reached | not_reached | partial | ambient | unknown` so operators can inventory incomplete goals without re-grepping multi-GB trees by hand.

Related: mining (wallets/phrases) is covered by [`MINING_CLAUDE_RUNBOOK.md`](./MINING_CLAUDE_RUNBOOK.md). This runbook is **goal outcome only**.

---

## Prerequisites

- Python 3.11+
- No `pip install` (stdlib only)
- Read access to Mac `~/.claude/projects` for live scans (optional; tests use fixtures)

```bash
cd /Users/igorholt/scripts/claude-mine
PYTHONPATH=. python -m claude_mine goals --help
```

Classifier core: `claude_mine.goal_status.classify_goal_outcome`  
CLI path: `python -m claude_mine goals {session|scan}`

---

## Classify one session

High-signal Mac sessions used in SDD smoke (do **not** commit output):

```bash
cd /Users/igorholt/scripts/claude-mine

# Ops sweep (95202a88…)
PYTHONPATH=. python -m claude_mine goals session \
  ~/.claude/projects/-Users-igorholt/95202a88-2380-4f3c-81a3-1e82ba05b482.jsonl \
  --out /tmp/goals-95202

# Revenue / ralphloop (700dd0dc…)
PYTHONPATH=. python -m claude_mine goals session \
  ~/.claude/projects/-Users-igorholt/700dd0dc-639a-4243-99c1-99f3a5bf41fc.jsonl \
  --out /tmp/goals-700dd0dc
```

Writes under `--out`:

| Artifact | Contents |
| --- | --- |
| `{session_id}.json` | `status`, `confidence`, hit counts, `blockers`, redacted `goal_candidates`, path/ts metadata |
| `{session_id}.md` | Human-readable summary of the same |

Review Markdown, act on blockers / goal candidates, then **discard** `/tmp` outputs.

### Fixture / unit-test smoke (safe anytime)

```bash
cd /Users/igorholt/scripts/claude-mine
PYTHONPATH=. python -m unittest discover -s tests -v
# or goals-only:
PYTHONPATH=. python -m unittest tests.test_goal_status tests.test_goals_cli -v
```

CI and local tests use **synthetic fixtures only** under `tests/fixtures/goal_*.jsonl`.

---

## Scan many sessions (incomplete inventory)

Discover UUID-named session roots and classify; **default** writes only `not_reached` and `partial`:

```bash
cd /Users/igorholt/scripts/claude-mine
PYTHONPATH=. python -m claude_mine goals scan \
  --root ~/.claude/projects \
  --out /tmp/goals-incomplete
```

| Flag | Default | Notes |
| --- | --- | --- |
| `--root` | `~/.claude/projects` | Project tree root |
| `--glob` | `*` | Relative path under root (posix) or basename |
| `--all` | off | Include `reached` / `ambient` / `unknown` in index + reports |
| `--out` | required in practice | Per-session reports + `index.json` |

Behavior:

- Same discovery as mine `scan`: UUID `*.jsonl` session roots; **skips** `subagents/` and non-UUID jsonl
- Always classifies every discovered session; non-matching statuses print `skip …` under default filter
- Read-only on `--root`; writes **only** under `--out`
- `index.json`: `root`, `filter` (`incomplete` \| `all`), `classified`, `sessions[]`

### Mac Claude — recommended filters

Home project folder (largest high-signal sessions):

```bash
PYTHONPATH=. python -m claude_mine goals scan \
  --root ~/.claude/projects \
  --glob '*-Users-igorholt/*' \
  --out /tmp/goals-igor
```

x402 worker project:

```bash
PYTHONPATH=. python -m claude_mine goals scan \
  --root ~/.claude/projects \
  --glob '*-Users-igorholt-gc-workers-x402-paid-service/*' \
  --out /tmp/goals-x402
```

Heuristic note: short `private-tmp` / `var-folders` sessions often classify as noise (`unknown` / false `not_reached`). Prefer human curation for the durable inventory — see inventory **False positives**.

---

## Diamondnode paths (operator note)

Claude Code session layout on **Mac** is well-defined: `~/.claude/projects/<project-slug>/<uuid>.jsonl`.

On **diamondnode** (SSH host `diamondnode`):

| Surface | How to inventory | Notes |
| --- | --- | --- |
| Claude Code jsonl (if present) | Same CLI with `--root` pointing at diamondnode’s `~/.claude/projects` | Run package on-box, or `scp`/rsync selected `*.jsonl` to Mac `/tmp` then `goals session` |
| Hermes open sessions | Not Claude jsonl — track via Hermes/job state, not this CLI | See inventory **Tier 2** |
| Diamondnode Claude **jobs** (blocked) | Job IDs + last blocked detail from node tooling / handoff | See inventory **Tier 3** — classifier does not replace job-state ledgers |

Typical remote workflow (read-only copy → local classify):

```bash
# On diamondnode (example — confirm live path before bulk copy):
# ls ~/.claude/projects

# From Mac: copy one session only, classify under /tmp, discard
scp 'diamondnode:~/.claude/projects/<project>/<uuid>.jsonl' /tmp/dn-session.jsonl
cd /Users/igorholt/scripts/claude-mine
PYTHONPATH=. python -m claude_mine goals session /tmp/dn-session.jsonl --out /tmp/goals-dn
rm -f /tmp/dn-session.jsonl
# discard /tmp/goals-dn when done
```

Do **not** commit diamondnode dumps, job logs with secrets, or `/tmp` goal reports.

Dashboard pointer (ops, not sessions): `dn.genesisconductor.io/dashboard`.

---

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 2 | Path missing / no sessions found |
| 1 | Fatal error |

Same as mine `session` / `scan`.

---

## Security (hard rules)

1. **Never commit** `/tmp` goal reports, live `~/.claude` contents, diamondnode session dumps, or real inventory scrapes.
2. **Never print or store** private keys, mnemonics, PEMs, or raw `0x`+64-hex secrets.
3. Classifier reuses package redaction (`claude_mine.redact.redact_text`) on `goal_candidates`:
   - `0x` + 64 hex → `0xLONG`
   - key-like assignments → name + separator + `REDACTED`
   - PEM blocks → `REDACTED`
4. Goals CLI is **read-only** against Claude paths; write surface is only `--out` (prefer `/tmp/…`).
5. Tests use **synthetic fixtures only**.
6. Do not force-push; do not touch `secrets.enc.yaml` / SOPS or x402 secrets for this workstream.

If a report ever contains raw secret material, treat it as a bug: discard the output, fix redaction, re-classify. Do not commit the bad artifact.

---

## Status enum + signal tables

| Status | Meaning (ops) |
| --- | --- |
| `reached` | End-window (or whole session) success signals without incomplete |
| `not_reached` | Incomplete/blocker signals without success |
| `partial` | Both success and incomplete in the deciding window |
| `ambient` | Short scheduled/pulse session with no win/lose signals |
| `unknown` | No decisive signals |

**Incomplete signals** (substring, case-insensitive): `blocked`, `underfunded`, `GAS_STARVED`, `can_sign false` (flexible `:`/`=`), `TREASURY_PRIVATE`, `waiting for`, `secrets not set`, `session limit`, `failed to settle`.

**Success signals:** `all tasks complete`, `merge-ready`, `goal met` / `goal achieved`, `successfully deployed`, `34/34`, `34/34 passing`, `34/34 passing with no gate block`.

**End-window:** last **20%** of joined message text by character length drives terminal status when it has signal; otherwise whole-session counts.

---

## How to use output with the durable inventory

1. Run `goals scan` → `/tmp/…` (default incomplete filter).
2. Open `index.json` + high-confidence `not_reached` / `partial` Markdown reports.
3. **Human-curate** into [`INCOMPLETE_GOALS_INVENTORY_2026-07-21.md`](./INCOMPLETE_GOALS_INVENTORY_2026-07-21.md) (or a dated successor) — do not bulk-commit classifier dumps.
4. Cross-check blockers against Tier 0 load-bearing goals (treasury gas, Safe n1, x402 settlement, revenue reframe).
5. For maru marketplace reframe of the literal `$2,184` revenue goal, see inventory Tier 0 + operator chat notes (catalog / liquidable assets path).

Classifier is a **map**, not a substitute for:

- Vault / SOPS / operator secret retrieval
- Safe multi-sig external signers
- diamondnode verify/sign gates ([`VERIFICATION_SIGNING_SDD_RUNBOOK.md`](./VERIFICATION_SIGNING_SDD_RUNBOOK.md))

---

## Report shape (JSON, goals)

| Key | Type | Notes |
| --- | --- | --- |
| `session_id` | str | From jsonl / path stem |
| `path` | str | Source session path |
| `line_count` | int | Non-empty lines |
| `first_ts` / `last_ts` | str \| null | From records |
| `status` | str | Enum above |
| `confidence` | float | 0..1 |
| `incomplete_hits` | int | Whole-session incomplete phrase count |
| `success_hits` | int | Whole-session success phrase count |
| `blockers` | list[str] | Dedupe signal labels, max 10 |
| `goal_candidates` | list[str] | Redacted user goal/objective/… texts, max 5 |

`goals scan` also writes `index.json` listing filtered sessions under `--out`.

---

## Package layout (goals-related)

```
scripts/claude-mine/
  claude_mine/
    goal_status.py  # classify_goal_outcome + signal tables
    cli.py          # goals session / goals scan
    report.py       # write_goal_markdown
    parser.py       # jsonl → (role, text)
    redact.py       # secret-safe text
  tests/
    fixtures/goal_*.jsonl
    test_goal_status.py
    test_goals_cli.py
  README.md
```

---

## SDD recovery

Trust `.superpowers/sdd/progress-incomplete-goals.md` and  
`git log -- scripts/claude-mine docs/superpowers/plans` over chat memory.  
Task 3 complete means runbook + inventory shipped; re-dispatch only for new signal tables or inventory refreshes.
