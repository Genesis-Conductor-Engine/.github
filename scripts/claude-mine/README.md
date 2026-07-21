# claude-mine

Secret-safe miner for **Claude Code** session transcripts (`.jsonl`).

Extracts wallet addresses (with known ops labels), phrase hits (treasury / fund-agent-gas / …), and redacted user snippets — without ever emitting private keys, mnemonics, PEMs, or raw `0x`+64-hex material.

**Runtime:** Python 3.11+ **stdlib only**.

## Install / run

No package install required. From this directory:

```bash
cd scripts/claude-mine
PYTHONPATH=. python -m claude_mine session path/to/session.jsonl --out /tmp/claude-mine-out
```

Or from any cwd with `PYTHONPATH` pointing at this tree:

```bash
PYTHONPATH=/path/to/scripts/claude-mine python -m claude_mine --help
```

## Commands

### Mine one session

```bash
python -m claude_mine session <jsonl_path> --out DIR
```

Writes under `DIR/`:

- `{session_id}.json` — structured report
- `{session_id}.md` — Markdown (address table, phrase hits, redacted snippets, source path)

### Scan many sessions

```bash
python -m claude_mine scan [--root ~/.claude/projects] [--glob '*'] --out DIR
```

- **Default root:** `~/.claude/projects`
- Discovers **UUID-named** `*.jsonl` session roots (project depth)
- **Skips** nested `subagents/` trees and non-UUID jsonl (skill injections, agent sidecars, …)
- Writes one JSON + Markdown per session, plus `index.json`

Example filter (posix relative path under root):

```bash
python -m claude_mine scan --root ~/.claude/projects --glob '*-Users-igorholt/*' --out /tmp/scan
```

### Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 2 | Path missing / no sessions found |
| 1 | Fatal error |

## Report shape (JSON)

Keys from `mine_session`:

| Key | Type | Notes |
| --- | --- | --- |
| `session_id` | str | From jsonl `sessionId` / path stem |
| `path` | str | Source session path |
| `line_count` | int | Non-empty lines |
| `addresses` | list | `{address, count, label}` (lowercase `0x…`) |
| `phrases` | dict | Canonical phrase → hit count |
| `top_user_snippets` | list[str] | Redacted user texts, max 20 |
| `first_ts` / `last_ts` | str \| null | Timestamps from records |

Known address labels include `TREASURY_UNSIGNED`, `HOT_X402`, `SAFE_2OF3`, `METAMASK1_FEE_SINK`, `LEGACY_TREASURY_PANEL` (public ops labels, not secrets).

## Security

- **Read-only** against `~/.claude` by default; writes only under `--out`
- Redaction: `0x`+64 hex → `0xLONG`; key-like assignments / PEM / mnemonics → `REDACTED`
- **Never commit** real `~/.claude` contents or `/tmp` mine outputs
- Tests use **synthetic fixtures only** under `tests/fixtures/`

## Tests

```bash
cd scripts/claude-mine
PYTHONPATH=. python -m unittest discover -s tests -v
```

## Smoke on a live session (do not commit output)

```bash
cd scripts/claude-mine
PYTHONPATH=. python -m claude_mine session \
  ~/.claude/projects/-Users-igorholt/95202a88-2380-4f3c-81a3-1e82ba05b482.jsonl \
  --out /tmp/claude-mine-95202
# review /tmp/claude-mine-95202/*.md — discard when done
```

## Layout

```
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
```
