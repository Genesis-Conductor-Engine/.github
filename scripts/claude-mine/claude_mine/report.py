"""JSON and Markdown report writers for mined Claude sessions."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Union

PathLike = Union[str, Path]


def write_json(report: dict[str, Any], path: PathLike) -> None:
    """Write a mine report dict as pretty-printed JSON."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(report, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def write_markdown(report: dict[str, Any], path: PathLike) -> None:
    """Write a human-readable Markdown report.

    Includes: source path, labeled address table, phrase hits, redacted snippets.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_render_markdown(report), encoding="utf-8")


def write_goal_markdown(report: dict[str, Any], path: PathLike) -> None:
    """Write a human-readable Markdown goal-outcome report."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_render_goal_markdown(report), encoding="utf-8")


def _render_markdown(report: dict[str, Any]) -> str:
    session_id = report.get("session_id") or ""
    source = report.get("path") or ""
    line_count = report.get("line_count", 0)
    first_ts = report.get("first_ts")
    last_ts = report.get("last_ts")
    addresses = report.get("addresses") or []
    phrases = report.get("phrases") or {}
    snippets = report.get("top_user_snippets") or []

    lines: list[str] = []
    lines.append(f"# Claude mine report — `{session_id}`")
    lines.append("")
    lines.append("## Session")
    lines.append("")
    lines.append(f"- **session_id:** `{session_id}`")
    lines.append(f"- **path:** `{source}`")
    lines.append(f"- **line_count:** {line_count}")
    lines.append(f"- **first_ts:** {first_ts if first_ts is not None else 'n/a'}")
    lines.append(f"- **last_ts:** {last_ts if last_ts is not None else 'n/a'}")
    lines.append("")

    lines.append("## Addresses")
    lines.append("")
    if addresses:
        lines.append("| address | count | label |")
        lines.append("| --- | ---: | --- |")
        for item in addresses:
            addr = item.get("address", "")
            count = item.get("count", 0)
            label = item.get("label", "UNKNOWN")
            lines.append(f"| `{addr}` | {count} | {label} |")
    else:
        lines.append("_No addresses found._")
    lines.append("")

    lines.append("## Phrase hits")
    lines.append("")
    if phrases:
        lines.append("| phrase | hits |")
        lines.append("| --- | ---: |")
        # Stable order: non-zero first (desc), then zero alphabetically by key
        items = sorted(
            phrases.items(),
            key=lambda kv: (-int(kv[1] or 0), str(kv[0]).lower()),
        )
        for phrase, hits in items:
            lines.append(f"| `{phrase}` | {int(hits or 0)} |")
    else:
        lines.append("_No phrase data._")
    lines.append("")

    lines.append("## Redacted user snippets")
    lines.append("")
    if snippets:
        for i, snip in enumerate(snippets, start=1):
            lines.append(f"### Snippet {i}")
            lines.append("")
            lines.append("```")
            lines.append(str(snip).rstrip())
            lines.append("```")
            lines.append("")
    else:
        lines.append("_No user snippets._")
        lines.append("")

    return "\n".join(lines)


def _render_goal_markdown(report: dict[str, Any]) -> str:
    session_id = report.get("session_id") or ""
    source = report.get("path") or ""
    status = report.get("status") or "unknown"
    confidence = report.get("confidence")
    incomplete_hits = report.get("incomplete_hits", 0)
    success_hits = report.get("success_hits", 0)
    blockers = report.get("blockers") or []
    candidates = report.get("goal_candidates") or []
    line_count = report.get("line_count")
    first_ts = report.get("first_ts")
    last_ts = report.get("last_ts")

    conf_s = (
        f"{float(confidence):.2f}"
        if isinstance(confidence, (int, float))
        else "n/a"
    )

    lines: list[str] = []
    lines.append(f"# Goal outcome — `{session_id}`")
    lines.append("")
    lines.append("## Session")
    lines.append("")
    lines.append(f"- **session_id:** `{session_id}`")
    lines.append(f"- **path:** `{source}`")
    if line_count is not None:
        lines.append(f"- **line_count:** {line_count}")
    if first_ts is not None or last_ts is not None:
        lines.append(f"- **first_ts:** {first_ts if first_ts is not None else 'n/a'}")
        lines.append(f"- **last_ts:** {last_ts if last_ts is not None else 'n/a'}")
    lines.append("")

    lines.append("## Outcome")
    lines.append("")
    lines.append(f"- **status:** `{status}`")
    lines.append(f"- **confidence:** {conf_s}")
    lines.append(f"- **incomplete_hits:** {int(incomplete_hits or 0)}")
    lines.append(f"- **success_hits:** {int(success_hits or 0)}")
    lines.append("")

    lines.append("## Blockers")
    lines.append("")
    if blockers:
        for b in blockers:
            lines.append(f"- `{b}`")
    else:
        lines.append("_None detected._")
    lines.append("")

    lines.append("## Goal candidates (redacted)")
    lines.append("")
    if candidates:
        for i, cand in enumerate(candidates, start=1):
            lines.append(f"### Candidate {i}")
            lines.append("")
            lines.append("```")
            lines.append(str(cand).rstrip())
            lines.append("```")
            lines.append("")
    else:
        lines.append("_No goal candidates._")
        lines.append("")

    return "\n".join(lines)
