# Mining Claude Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a reusable, secret-safe CLI that mines Claude Code session transcripts (jsonl + sidecars) for wallet addresses, treasury/fund/gas signals, and operator handoffs — so fleet ops do not re-grep by hand.

**Architecture:** Python package under `scripts/claude-mine/`:
- `parser.py` — stream-parse Claude Code jsonl, extract text from user/assistant/tool_result
- `extract.py` — addresses, phrase hits, redaction
- `labels.py` — known address book (treasury/hot/safe/etc.)
- `report.py` — JSON + Markdown report writers
- `cli.py` — `python -m claude_mine` entry
- Tests with **synthetic fixtures only** (no live secrets, no production private keys)

**Tech Stack:** Python 3.11+ stdlib only (no new deps). pytest if already available, else `unittest`.

**Workspace:** `/Users/igorholt/scripts/claude-mine/` (home git root). Do **not** modify unrelated dirty tree files (x402, workflows, etc.).

---

## Global Constraints

1. **Never print or write private keys, mnemonics, PEMs, or raw `0x` + 64-hex secrets.** Redact to `REDACTED` / `0xLONG`.
2. **Never commit real session contents.** Tests use synthetic fixtures under `tests/fixtures/`.
3. **Read-only against `~/.claude` by default.** Write reports only under `--out` (default `./out/`).
4. **Stdlib-only runtime** for the miner modules used by CLI (tests may use pytest if present).
5. **Known address labels** must include at least:
   - `0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75` → `TREASURY_UNSIGNED`
   - `0x60C4499870f115664d7FfD8411b023DBEf3377d9` → `HOT_X402`
   - `0x2AD5480D9E24Be1973019B61DAB4bbAB2f6930eB` → `SAFE_2OF3`
   - `0x9545e2439c5c75d3aA723AcaC1AA6B0fa1DB6956` → `METAMASK1_FEE_SINK`
   - `0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8` → `LEGACY_TREASURY_PANEL`
6. **Phrase scan** (case-insensitive) must include: `treasury`, `fund-agent-gas`, `TREASURY_PRIVATE`, `snipebot`, `wallet_registry`, `gas_starved`, `0x54e2`, `safe n1`, `metamask`.
7. **CLI exit codes:** `0` success, `2` path missing / no sessions, `1` fatal error.
8. Commits: Conventional Commits `feat(claude-mine):` / `test(claude-mine):` / `docs(claude-mine):`.
9. Do not force-push; do not touch secrets.enc.yaml or SOPS.

---

### Task 1: Core extract + redact + parse (TDD)

**Files:**
- Create: `scripts/claude-mine/claude_mine/__init__.py`
- Create: `scripts/claude-mine/claude_mine/redact.py`
- Create: `scripts/claude-mine/claude_mine/extract.py`
- Create: `scripts/claude-mine/claude_mine/parser.py`
- Create: `scripts/claude-mine/tests/test_extract.py`
- Create: `scripts/claude-mine/tests/fixtures/sample_session.jsonl`

- [ ] **Step 1: Write failing tests** for:
  - `redact_text` strips `0x`+64hex and key-like assignments
  - `extract_addresses` finds unique checksum-agnostic 40-hex addresses
  - `extract_phrase_hits` counts phrase keywords
  - `iter_session_texts` yields role+text from synthetic jsonl (user text, assistant text, tool_result string)

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement redact/extract/parser to pass**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** `test(claude-mine): core extract+redact+parser`

---

### Task 2: Labels + mine_session report model

**Files:**
- Create: `scripts/claude-mine/claude_mine/labels.py`
- Create: `scripts/claude-mine/claude_mine/mine.py`
- Create: `scripts/claude-mine/tests/test_mine.py`

- [ ] **Step 1: Write failing tests** for:
  - `label_address` returns known labels / `UNKNOWN`
  - `mine_session(path)` returns dict with keys: `session_id`, `path`, `line_count`, `addresses` (list of `{address, count, label}`), `phrases` (dict), `top_user_snippets` (list of redacted strings, max 20), `first_ts`, `last_ts`
  - Known treasury address in fixture is labeled `TREASURY_UNSIGNED`

- [ ] **Step 2: Implement labels + mine_session**

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit** `feat(claude-mine): mine_session report model + labels`

---

### Task 3: CLI + multi-session discovery + writers

**Files:**
- Create: `scripts/claude-mine/claude_mine/report.py`
- Create: `scripts/claude-mine/claude_mine/cli.py`
- Create: `scripts/claude-mine/claude_mine/__main__.py`
- Create: `scripts/claude-mine/tests/test_cli.py`
- Create: `scripts/claude-mine/README.md`

- [ ] **Step 1: Write failing tests** for report JSON schema keys and CLI dry paths (use temp dirs + fixture)

- [ ] **Step 2: Implement:**
  - `write_json(report, path)` / `write_markdown(report, path)`
  - CLI:
    - `python -m claude_mine session <jsonl_path> --out DIR`
    - `python -m claude_mine scan [--root ~/.claude/projects] [--glob '*'] --out DIR`
    - `scan` finds `*.jsonl` that look like session roots (not only subagents): prefer files matching UUID-like names at project depth
    - Default root: `Path.home() / ".claude" / "projects"`
  - Markdown includes: summary table of labeled addresses, phrase hits, redacted snippets, path to source session

- [ ] **Step 3: Manual smoke** on fixture only in tests; optional note how to run on `95202a88…jsonl` without committing output

- [ ] **Step 4: Commit** `feat(claude-mine): CLI scan/session + markdown/json reports`

---

### Task 4: Runbook + handoff artifact

**Files:**
- Create: `docs/superpowers/plans/MINING_CLAUDE_RUNBOOK.md`
- Update: `.superpowers/sdd/progress-mining-claude.md` (ledger for this plan)

- [ ] **Step 1: Write runbook** covering:
  - Install/run: `cd scripts/claude-mine && python -m claude_mine session ~/.claude/projects/-Users-igorholt/95202a88-2380-4f3c-81a3-1e82ba05b482.jsonl --out /tmp/claude-mine-95202`
  - Security: never commit `/tmp` reports; redact guarantees
  - Mapping to live ops: TREASURY_UNSIGNED vs HOT_X402 vs SAFE_2OF3 (from Global Constraints labels)
  - Next ops after mine: fund-agent-gas / Safe n1 / external seed (pointer only)

- [ ] **Step 2: Commit** `docs(claude-mine): runbook + sdd ledger`

---

## Done when

- [ ] All unit tests pass
- [ ] CLI mines fixture end-to-end
- [ ] Runbook present
- [ ] No secrets in repo diffs
- [ ] Progress ledger marks Tasks 1–4 complete
