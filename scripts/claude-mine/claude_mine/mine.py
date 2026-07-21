"""Compose parser/extract/redact/labels into a per-session mine report."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Union

from claude_mine.extract import extract_phrase_hits
from claude_mine.labels import label_address
from claude_mine.parser import iter_session_texts
from claude_mine.redact import redact_text

PathLike = Union[str, Path]

# Same address shape as extract.py (40 hex; not 64-hex private keys).
_ADDRESS = re.compile(r"(?<![0-9a-fA-F])0x([0-9a-fA-F]{40})(?![0-9a-fA-F])")

_MAX_USER_SNIPPETS = 20


def mine_session(path: PathLike) -> dict[str, Any]:
    """Mine one Claude Code session jsonl into a structured report dict.

    Keys:
      session_id, path, line_count, addresses, phrases,
      top_user_snippets, first_ts, last_ts
    """
    p = Path(path)
    session_id, line_count, first_ts, last_ts = _scan_metadata(p)

    addr_counts: Counter[str] = Counter()
    phrase_totals: dict[str, int] | None = None
    user_snippets: list[str] = []

    for role, text in iter_session_texts(p):
        for m in _ADDRESS.finditer(text):
            addr_counts["0x" + m.group(1).lower()] += 1

        hits = extract_phrase_hits(text)
        if phrase_totals is None:
            phrase_totals = dict(hits)
        else:
            for k, v in hits.items():
                phrase_totals[k] = phrase_totals.get(k, 0) + v

        if role == "user" and len(user_snippets) < _MAX_USER_SNIPPETS:
            redacted = redact_text(text)
            if redacted.strip():
                user_snippets.append(redacted)

    if phrase_totals is None:
        phrase_totals = extract_phrase_hits("")

    # Stable first-seen order for addresses (Counter preserves insertion order).
    addresses: list[dict[str, Any]] = []
    for addr, count in addr_counts.items():
        addresses.append(
            {
                "address": addr,
                "count": int(count),
                "label": label_address(addr),
            }
        )

    if not session_id:
        session_id = p.stem

    return {
        "session_id": session_id,
        "path": str(p.resolve()) if p.exists() else str(p),
        "line_count": line_count,
        "addresses": addresses,
        "phrases": phrase_totals,
        "top_user_snippets": user_snippets[:_MAX_USER_SNIPPETS],
        "first_ts": first_ts,
        "last_ts": last_ts,
    }


def _scan_metadata(
    path: Path,
) -> tuple[str, int, str | None, str | None]:
    """Return session_id, line_count, first_ts, last_ts from raw jsonl."""
    session_id = ""
    line_count = 0
    first_ts: str | None = None
    last_ts: str | None = None

    with path.open(encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            if not raw.strip():
                continue
            line_count += 1
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue

            if not session_id:
                sid = obj.get("sessionId") or obj.get("session_id")
                if isinstance(sid, str) and sid.strip():
                    session_id = sid.strip()

            ts = obj.get("timestamp") or obj.get("ts")
            if isinstance(ts, str) and ts.strip():
                ts = ts.strip()
                if first_ts is None:
                    first_ts = ts
                last_ts = ts

    return session_id, line_count, first_ts, last_ts
