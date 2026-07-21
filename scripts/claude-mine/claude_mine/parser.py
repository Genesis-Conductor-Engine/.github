"""Stream-parse Claude Code session jsonl into role+text pairs."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, TextIO, Union

PathLike = Union[str, Path]


def iter_session_texts(path: PathLike) -> Iterator[tuple[str, str]]:
    """Yield ``(role, text)`` from a Claude Code session ``.jsonl`` file.

    Sources:
    - user messages (string content or text blocks)
    - assistant text blocks
    - tool_result string content (role ``tool_result``)

    Non-message lines (system, attachments, snapshots, …) are skipped.
    Empty text is not yielded.
    """
    p = Path(path)
    with p.open(encoding="utf-8", errors="replace") as fh:
        yield from _iter_from_file(fh)


def _iter_from_file(fh: TextIO) -> Iterator[tuple[str, str]]:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        yield from _texts_from_record(obj)


def _texts_from_record(obj: dict[str, Any]) -> Iterator[tuple[str, str]]:
    rec_type = obj.get("type")
    if rec_type not in ("user", "assistant"):
        return

    message = obj.get("message")
    if not isinstance(message, dict):
        return

    default_role = str(message.get("role") or rec_type)
    content = message.get("content")

    if isinstance(content, str):
        text = content.strip()
        if text:
            yield default_role, text
        return

    if not isinstance(content, list):
        return

    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype == "text":
            text = block.get("text")
            if isinstance(text, str) and text.strip():
                yield default_role, text
        elif btype == "tool_result":
            # tool_result content may be str or list of text parts
            raw = block.get("content")
            if isinstance(raw, str) and raw.strip():
                yield "tool_result", raw
            elif isinstance(raw, list):
                parts: list[str] = []
                for part in raw:
                    if isinstance(part, str) and part.strip():
                        parts.append(part)
                    elif isinstance(part, dict):
                        t = part.get("text")
                        if isinstance(t, str) and t.strip():
                            parts.append(t)
                if parts:
                    yield "tool_result", "\n".join(parts)
        # skip thinking, tool_use, images, etc.
