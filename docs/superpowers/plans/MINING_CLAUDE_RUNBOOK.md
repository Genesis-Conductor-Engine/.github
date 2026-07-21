# Mining Claude Sessions — Runbook

**Plan:** `docs/superpowers/plans/2026-07-21-mining-claude-sdd.md`  
**Ledger:** `.superpowers/sdd/progress-mining-claude.md`  
**Package:** `scripts/claude-mine/` (Python 3.11+, stdlib only)

Secret-safe CLI that mines Claude Code session transcripts (`.jsonl`) for wallet addresses, treasury/fund/gas phrase hits, and redacted operator snippets — so fleet ops do not re-grep by hand.

---

## Prerequisites

- Python 3.11+
- No `pip install` required (stdlib only)
- Read access to `~/.claude/projects` for live sessions (optional; tests use fixtures)

```bash
cd /Users/igorholt/scripts/claude-mine
PYTHONPATH=. python -m claude_mine --help
```

---

## Mine one session (primary)

Target session used in SDD smoke notes (do **not** commit output):

```bash
cd /Users/igorholt/scripts/claude-mine
PYTHONPATH=. python -m claude_mine session \
  ~/.claude/projects/-Users-igorholt/95202a88-2380-4f3c-81a3-1e82ba05b482.jsonl \
  --out /tmp/claude-mine-95202
```

Writes under `--out`:

| Artifact | Contents |
| --- | --- |
| `{session_id}.json` | Structured report (`mine_session` model) |
| `{session_id}.md` | Address table, phrase hits, redacted snippets, source path |

Review the Markdown, act on labeled addresses / phrase hits, then **discard** `/tmp` outputs.

### Fixture / unit-test smoke (safe to re-run anytime)

```bash
cd /Users/igorholt/scripts/claude-mine
PYTHONPATH=. python -m unittest discover -s tests -v
```

---

## Scan many sessions

Discover UUID-named session roots under Claude projects and mine each:

```bash
cd /Users/igorholt/scripts/claude-mine
PYTHONPATH=. python -m claude_mine scan \
  --root ~/.claude/projects \
  --glob '*' \
  --out /tmp/claude-mine-scan
```

| Flag | Default | Notes |
| --- | --- | --- |
| `--root` | `~/.claude/projects` | Project tree root |
| `--glob` | `*` | Matched against path relative to root (posix) or basename |
| `--out` | required in practice | Per-session `{id}.json` + `.md`, plus `index.json` |

Behavior:

- Prefers **UUID-named** `*.jsonl` session roots at project depth
- **Skips** nested `subagents/` trees and non-UUID jsonl (skill injections, sidecars)
- Read-only on `--root`; writes **only** under `--out`

Example filter (this machine’s project folder):

```bash
PYTHONPATH=. python -m claude_mine scan \
  --root ~/.claude/projects \
  --glob '*-Users-igorholt/*' \
  --out /tmp/claude-mine-igor
```

---

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 2 | Path missing / no sessions found |
| 1 | Fatal error |

---

## Security (hard rules)

1. **Never commit** `/tmp` mine reports, live `~/.claude` contents, or real session dumps.
2. **Never print or store** private keys, mnemonics, PEMs, or raw `0x`+64-hex secrets.
3. Package redaction guarantees (`claude_mine.redact.redact_text`):
   - `0x` + 64 hex → `0xLONG`
   - key-like assignments (`private_key=`, `api_key:`, `mnemonic:`, …) → name + separator + `REDACTED`
   - PEM blocks → `REDACTED`
4. Miner is **read-only** against Claude paths by default; write surface is only `--out`.
5. Tests use **synthetic fixtures only** under `scripts/claude-mine/tests/fixtures/`.
6. Do not force-push; do not touch `secrets.enc.yaml` / SOPS or x402 secrets for this workstream.

If a report ever contains raw secret material, treat it as a bug: discard the output, fix redaction, re-mine. Do not commit the bad artifact.

---

## Address label map (ops, not secrets)

Checksum-agnostic public fleet labels from `claude_mine.labels` / Global Constraints:

| Label | Address | Role (pointer) |
| --- | --- | --- |
| `TREASURY_UNSIGNED` | `0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75` | Unsigned treasury surface; funding / gas decisions reference this label |
| `HOT_X402` | `0x60C4499870f115664d7FfD8411b023DBEf3377d9` | Hot x402 operational wallet |
| `SAFE_2OF3` | `0x2AD5480D9E24Be1973019B61DAB4bbAB2f6930eB` | 2-of-3 Safe; multi-sig path |
| `METAMASK1_FEE_SINK` | `0x9545e2439c5c75d3aA723AcaC1AA6B0fa1DB6956` | MetaMask1 fee sink |
| `LEGACY_TREASURY_PANEL` | `0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8` | Legacy treasury panel address |
| `UNKNOWN` | (any other 40-hex) | Not in book — investigate before acting |

### How to use labels after a mine

- Hits on `TREASURY_UNSIGNED` + phrases like `treasury` / `fund-agent-gas` / `gas_starved` → treasury funding / gas path, not hot-wallet spend by default.
- Hits on `HOT_X402` → x402 operational surface; do not conflate with treasury unsigned.
- Hits on `SAFE_2OF3` or phrase `safe n1` → multi-sig / Safe n1 workflow (external signers; no keys in chat).
- `METAMASK1_FEE_SINK` / `metamask` → fee-sink / MetaMask1 path.
- `LEGACY_TREASURY_PANEL` → legacy panel only; prefer labeled current treasury unless ops say otherwise.

Phrase scan (case-insensitive) also flags: `treasury`, `fund-agent-gas`, `TREASURY_PRIVATE`, `snipebot`, `wallet_registry`, `gas_starved`, `0x54e2`, `safe n1`, `metamask`.

---

## Next ops after mine (pointers only — no secrets)

Use mine output as a **map**, not a key store. Follow existing fleet runbooks / diamondnode tools for anything that moves funds or signs.

| Signal in report | Next op (pointer) | Notes |
| --- | --- | --- |
| `fund-agent-gas` / `gas_starved` + treasury labels | **fund-agent-gas** path | Fund agent gas from the correct labeled wallet per live ops policy; never paste private keys into Claude or git |
| `SAFE_2OF3` / `safe n1` | **Safe n1** multi-sig flow | Collect external signer approvals; do not inject EOAs into agent chat |
| Seed / mnemonic / `TREASURY_PRIVATE` phrase hits | **External seed** handling | Secrets live only in vault / SOPS / operator hardware — miner redacts; operator recovers out-of-band |
| `HOT_X402` activity | x402 worker / vault ops | See `gc-workers/x402-paid-service/` and vault docs; no keys in this repo surface |
| Unknown addresses with high counts | Manual review | Confirm label before any transfer |

**Do not** use this runbook as a substitute for:

- Signed-commit / PR process on repos that require it
- diamondnode verify/sign gates (see `docs/superpowers/plans/VERIFICATION_SIGNING_SDD_RUNBOOK.md`)
- Vault MCP `get_secret` / operator-controlled secret retrieval

---

## Report shape (JSON)

| Key | Type | Notes |
| --- | --- | --- |
| `session_id` | str | From jsonl `sessionId` / path stem |
| `path` | str | Source session path |
| `line_count` | int | Non-empty lines |
| `addresses` | list | `{address, count, label}` (lowercase `0x…`) |
| `phrases` | dict | Canonical phrase → hit count |
| `top_user_snippets` | list[str] | Redacted user texts, max 20 |
| `first_ts` / `last_ts` | str \| null | Timestamps from records |

`scan` additionally writes `index.json` listing mined sessions under `--out`.

---

## Package layout

```
scripts/claude-mine/
  claude_mine/
    __main__.py   # python -m entry
    cli.py        # session / scan
    mine.py       # mine_session report model
    parser.py     # jsonl → (role, text)
    extract.py    # addresses + phrase hits
    redact.py     # secret-safe text
    labels.py     # known address book
    report.py     # write_json / write_markdown
  tests/
    fixtures/sample_session.jsonl
    test_*.py
  README.md
```

---

## SDD recovery

Trust `.superpowers/sdd/progress-mining-claude.md` and `git log -- scripts/claude-mine docs/superpowers/plans` over chat memory. Tasks 1–4 complete means package + runbook shipped; re-dispatch only for regressions or new label/phrase requirements.
