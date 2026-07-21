"""Classify whether an agentic session reached its stated goal.

Uses incomplete/success phrase ratios with preference for the end-window
(last 20% of joined message text by character length).
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from claude_mine.redact import redact_text

# Status enum (exact strings — Global Constraints).
STATUS_REACHED = "reached"
STATUS_NOT_REACHED = "not_reached"
STATUS_PARTIAL = "partial"
STATUS_AMBIENT = "ambient"
STATUS_UNKNOWN = "unknown"

# Incomplete / blocker signals (case-insensitive). Longer phrases first.
INCOMPLETE_SIGNALS: tuple[str, ...] = (
    "can_sign false",
    "secrets not set",
    "failed to settle",
    "TREASURY_PRIVATE",
    "GAS_STARVED",
    "session limit",
    "waiting for",
    "underfunded",
    "blocked",
)

# Success / terminal-win signals (case-insensitive). Longer phrases first.
SUCCESS_SIGNALS: tuple[str, ...] = (
    "34/34 passing with no gate block",
    "successfully deployed",
    "all tasks complete",
    "34/34 passing",
    "goal achieved",
    "goal met",
    "merge-ready",
    "34/34",
)

# User texts matching these (case-insensitive) become goal_candidates.
_GOAL_HINT = re.compile(
    r"(?i)\b(goal|objective|win|fund|deploy)\b",
)

# Flexible match for can_sign false / can_sign=false / can_sign: false.
_CAN_SIGN_FALSE = re.compile(r"(?i)can_sign\s*[:=]?\s*false")

# Ambient heuristics: short scheduled / pulse sessions with no win/lose.
_AMBIENT_HINT = re.compile(
    r"(?i)\b(scheduled|pulse|cron|heartbeat|daily.?check)\b",
)
_AMBIENT_MAX_CHARS = 500
_AMBIENT_MAX_MESSAGES = 4

_END_WINDOW_FRACTION = 0.20
_MAX_BLOCKERS = 10
_MAX_GOAL_CANDIDATES = 5


def _compile_literal_signals(
    phrases: Sequence[str],
) -> list[tuple[str, re.Pattern[str]]]:
    """Compile case-insensitive literal phrase patterns (skip can_sign false)."""
    out: list[tuple[str, re.Pattern[str]]] = []
    for phrase in phrases:
        if phrase.lower() == "can_sign false":
            continue
        out.append((phrase, re.compile(re.escape(phrase), re.IGNORECASE)))
    return out


_INCOMPLETE_PATTERNS = _compile_literal_signals(INCOMPLETE_SIGNALS)
_SUCCESS_PATTERNS = _compile_literal_signals(SUCCESS_SIGNALS)


def _count_and_collect(
    text: str,
    patterns: Sequence[tuple[str, re.Pattern[str]]],
    *,
    include_can_sign_false: bool = False,
) -> tuple[int, list[str]]:
    """Return (hit_count, ordered unique canonical phrases found)."""
    if not text:
        return 0, []
    hits = 0
    found: list[str] = []
    seen: set[str] = set()

    if include_can_sign_false:
        n = len(_CAN_SIGN_FALSE.findall(text))
        if n:
            hits += n
            key = "can_sign false"
            if key not in seen:
                seen.add(key)
                found.append(key)

    for phrase, pattern in patterns:
        n = len(pattern.findall(text))
        if n:
            hits += n
            if phrase not in seen:
                seen.add(phrase)
                found.append(phrase)

    return hits, found


def _end_window(joined: str) -> str:
    if not joined:
        return ""
    start = max(0, int(len(joined) * (1.0 - _END_WINDOW_FRACTION)))
    return joined[start:]


def _is_ambient(texts: Sequence[tuple[str, str]], joined: str) -> bool:
    """Short scheduled/pulse session with no incomplete or success signals."""
    if not joined.strip():
        return False
    short = (
        len(joined) <= _AMBIENT_MAX_CHARS
        or len(texts) <= _AMBIENT_MAX_MESSAGES
    )
    if not short:
        return False
    return bool(_AMBIENT_HINT.search(joined))


def _goal_candidates(texts: Sequence[tuple[str, str]]) -> list[str]:
    out: list[str] = []
    for role, text in texts:
        if role != "user":
            continue
        if not text or not _GOAL_HINT.search(text):
            continue
        redacted = redact_text(text).strip()
        if not redacted:
            continue
        # Collapse whitespace for compact candidate lines.
        compact = re.sub(r"\s+", " ", redacted)
        if compact not in out:
            out.append(compact)
        if len(out) >= _MAX_GOAL_CANDIDATES:
            break
    return out


def _confidence(
    status: str,
    *,
    incomplete_hits: int,
    success_hits: int,
    end_incomplete: int,
    end_success: int,
) -> float:
    if status == STATUS_UNKNOWN:
        return 0.15
    if status == STATUS_AMBIENT:
        return 0.55

    total = incomplete_hits + success_hits
    end_total = end_incomplete + end_success
    base = 0.45

    if status == STATUS_PARTIAL:
        conf = base + 0.08 * min(incomplete_hits, success_hits)
        if end_incomplete > 0 and end_success > 0:
            conf += 0.15
        return float(min(1.0, conf))

    # reached / not_reached
    dominant = success_hits if status == STATUS_REACHED else incomplete_hits
    opposite = incomplete_hits if status == STATUS_REACHED else success_hits
    conf = base + 0.1 * min(dominant, 4)
    if opposite == 0:
        conf += 0.15
    if end_total > 0:
        # End-window agrees with terminal class.
        end_dom = end_success if status == STATUS_REACHED else end_incomplete
        end_opp = end_incomplete if status == STATUS_REACHED else end_success
        if end_dom > 0 and end_opp == 0:
            conf += 0.2
        elif end_opp > 0:
            conf -= 0.1
    if total == 0:
        conf = 0.2
    return float(max(0.0, min(1.0, conf)))


def _decide_status(
    *,
    incomplete_hits: int,
    success_hits: int,
    end_incomplete: int,
    end_success: int,
    texts: Sequence[tuple[str, str]],
    joined: str,
) -> str:
    # Prefer end-window for terminal status when it has signal.
    if end_success > 0 and end_incomplete == 0:
        return STATUS_REACHED
    if end_incomplete > 0 and end_success == 0:
        return STATUS_NOT_REACHED
    if end_success > 0 and end_incomplete > 0:
        return STATUS_PARTIAL

    # End-window quiet — fall back to whole-session counts.
    if success_hits > 0 and incomplete_hits == 0:
        return STATUS_REACHED
    if incomplete_hits > 0 and success_hits == 0:
        return STATUS_NOT_REACHED
    if success_hits > 0 and incomplete_hits > 0:
        return STATUS_PARTIAL

    if _is_ambient(texts, joined):
        return STATUS_AMBIENT
    if not joined.strip():
        return STATUS_UNKNOWN
    return STATUS_UNKNOWN


def classify_goal_outcome(texts: list[tuple[str, str]]) -> dict:
    """Classify goal outcome from ordered ``(role, text)`` message pairs.

    Returns a dict with keys:
      status, confidence, incomplete_hits, success_hits,
      blockers (max 10), goal_candidates (max 5, redacted).
    """
    if not texts:
        return {
            "status": STATUS_UNKNOWN,
            "confidence": 0.15,
            "incomplete_hits": 0,
            "success_hits": 0,
            "blockers": [],
            "goal_candidates": [],
        }

    parts = [t for _, t in texts if t]
    joined = "\n".join(parts)
    end = _end_window(joined)

    incomplete_hits, blockers_all = _count_and_collect(
        joined, _INCOMPLETE_PATTERNS, include_can_sign_false=True
    )
    success_hits, _ = _count_and_collect(joined, _SUCCESS_PATTERNS)

    end_incomplete, _ = _count_and_collect(
        end, _INCOMPLETE_PATTERNS, include_can_sign_false=True
    )
    end_success, _ = _count_and_collect(end, _SUCCESS_PATTERNS)

    status = _decide_status(
        incomplete_hits=incomplete_hits,
        success_hits=success_hits,
        end_incomplete=end_incomplete,
        end_success=end_success,
        texts=texts,
        joined=joined,
    )
    confidence = _confidence(
        status,
        incomplete_hits=incomplete_hits,
        success_hits=success_hits,
        end_incomplete=end_incomplete,
        end_success=end_success,
    )
    blockers = blockers_all[:_MAX_BLOCKERS]
    candidates = _goal_candidates(texts)

    return {
        "status": status,
        "confidence": confidence,
        "incomplete_hits": incomplete_hits,
        "success_hits": success_hits,
        "blockers": blockers,
        "goal_candidates": candidates,
    }
