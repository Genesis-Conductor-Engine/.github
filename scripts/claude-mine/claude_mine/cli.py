"""CLI for secret-safe Claude Code session mining.

Commands:
  session <jsonl_path> --out DIR
  scan [--root DIR] [--glob PATTERN] --out DIR

Exit codes: 0 success, 2 path missing / no sessions, 1 fatal.
"""

from __future__ import annotations

import argparse
import fnmatch
import re
import sys
import traceback
from pathlib import Path
from typing import Sequence

from claude_mine.mine import mine_session
from claude_mine.report import write_json, write_markdown

# UUID v1–v5 style filename used by Claude Code session roots.
_UUID_JSONL = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$",
    re.IGNORECASE,
)

DEFAULT_ROOT = Path.home() / ".claude" / "projects"
DEFAULT_OUT = Path("out")


def discover_sessions(
    root: Path,
    glob_pat: str = "*",
) -> list[Path]:
    """Find session-like ``*.jsonl`` under *root*.

    Prefers top-level project UUID-named session files. Skips nested
    ``subagents/`` trees and non-UUID jsonl (skill injections, journals, …).
    *glob_pat* is matched against the path relative to *root* (posix-style).
    """
    root = Path(root)
    if not root.is_dir():
        return []

    found: list[Path] = []
    for path in sorted(root.rglob("*.jsonl")):
        if not path.is_file():
            continue
        # Skip subagent / workflow sidecars
        parts_lower = {p.lower() for p in path.parts}
        if "subagents" in parts_lower:
            continue
        # Prefer UUID-named session roots only
        if not _UUID_JSONL.match(path.name):
            continue
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            rel = path.name
        if glob_pat and glob_pat != "*" and not fnmatch.fnmatch(rel, glob_pat):
            # Also allow matching basename-only patterns
            if not fnmatch.fnmatch(path.name, glob_pat):
                continue
        found.append(path)
    return found


def _safe_stem(session_id: str, path: Path) -> str:
    """Filesystem-safe report basename from session_id or path stem."""
    raw = (session_id or path.stem or "session").strip()
    # Keep alnum, dash, underscore, dot
    cleaned = re.sub(r"[^\w.\-]+", "_", raw, flags=re.UNICODE)
    return cleaned or "session"


def write_session_reports(report: dict, out_dir: Path) -> tuple[Path, Path]:
    """Write ``{stem}.json`` and ``{stem}.md`` under *out_dir*."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = _safe_stem(str(report.get("session_id") or ""), Path(str(report.get("path") or "session")))
    json_path = out_dir / f"{stem}.json"
    md_path = out_dir / f"{stem}.md"
    write_json(report, json_path)
    write_markdown(report, md_path)
    return json_path, md_path


def cmd_session(jsonl_path: Path, out_dir: Path) -> int:
    """Mine one session jsonl into --out. Returns exit code."""
    if not jsonl_path.is_file():
        print(f"error: session path missing or not a file: {jsonl_path}", file=sys.stderr)
        return 2
    try:
        report = mine_session(jsonl_path)
        json_path, md_path = write_session_reports(report, out_dir)
    except Exception as exc:  # noqa: BLE001 — CLI fatal boundary
        print(f"error: failed to mine session: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 1
    print(f"wrote {json_path}")
    print(f"wrote {md_path}")
    return 0


def cmd_scan(root: Path, out_dir: Path, glob_pat: str = "*") -> int:
    """Discover and mine UUID session roots under *root*."""
    if not root.exists():
        print(f"error: scan root missing: {root}", file=sys.stderr)
        return 2
    if not root.is_dir():
        print(f"error: scan root is not a directory: {root}", file=sys.stderr)
        return 2

    sessions = discover_sessions(root, glob_pat=glob_pat)
    if not sessions:
        print(f"error: no sessions found under {root}", file=sys.stderr)
        return 2

    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        index: list[dict] = []
        for path in sessions:
            report = mine_session(path)
            json_path, md_path = write_session_reports(report, out_dir)
            index.append(
                {
                    "session_id": report.get("session_id"),
                    "path": report.get("path"),
                    "line_count": report.get("line_count"),
                    "address_count": len(report.get("addresses") or []),
                    "json": str(json_path),
                    "markdown": str(md_path),
                }
            )
            print(f"mined {report.get('session_id')} → {json_path.name}")
        write_json({"root": str(root.resolve()), "sessions": index}, out_dir / "index.json")
        print(f"wrote {out_dir / 'index.json'} ({len(index)} sessions)")
    except Exception as exc:  # noqa: BLE001 — CLI fatal boundary
        print(f"error: scan failed: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="claude_mine",
        description="Secret-safe miner for Claude Code session transcripts.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_session = sub.add_parser("session", help="Mine one session jsonl file")
    p_session.add_argument("jsonl_path", type=Path, help="Path to session .jsonl")
    p_session.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="Output directory for JSON/Markdown reports (default: ./out)",
    )

    p_scan = sub.add_parser("scan", help="Discover and mine UUID session roots")
    p_scan.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help=f"Projects root (default: {DEFAULT_ROOT})",
    )
    p_scan.add_argument(
        "--glob",
        dest="glob_pat",
        default="*",
        help="fnmatch filter on path relative to root (default: *)",
    )
    p_scan.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="Output directory for JSON/Markdown reports (default: ./out)",
    )

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.command == "session":
        return cmd_session(Path(args.jsonl_path), Path(args.out))
    if args.command == "scan":
        return cmd_scan(Path(args.root), Path(args.out), glob_pat=str(args.glob_pat))
    parser.error(f"unknown command: {args.command}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
