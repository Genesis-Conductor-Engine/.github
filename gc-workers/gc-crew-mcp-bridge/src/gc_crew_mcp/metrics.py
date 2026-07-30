"""Run metrics for evolve_hook → self-evolving-retrainer (Ralph) payloads."""

from __future__ import annotations

from dataclasses import dataclass

# Incomplete Goals runbook enum (exact strings).
GOAL_STATUS_REACHED = "reached"
GOAL_STATUS_NOT_REACHED = "not_reached"
GOAL_STATUS_PARTIAL = "partial"
GOAL_STATUS_AMBIENT = "ambient"
GOAL_STATUS_UNKNOWN = "unknown"

VALID_GOAL_STATUSES: frozenset[str] = frozenset(
    {
        GOAL_STATUS_REACHED,
        GOAL_STATUS_NOT_REACHED,
        GOAL_STATUS_PARTIAL,
        GOAL_STATUS_AMBIENT,
        GOAL_STATUS_UNKNOWN,
    }
)

SOURCE_NAME = "gc-crew-mcp-bridge"


@dataclass(frozen=True)
class RunMetrics:
    """Metrics for a single crew / evolve run."""

    quality: float
    latency_ms: float
    cost_usdc6: int
    goal_status: str
    candidate_id: str | None = None


def validate_goal_status(s: str) -> str:
    """Return ``s`` if it is a valid Incomplete Goals status; else raise ValueError."""
    if not isinstance(s, str) or s not in VALID_GOAL_STATUSES:
        raise ValueError(
            f"invalid goal_status {s!r}; expected one of "
            f"{sorted(VALID_GOAL_STATUSES)}"
        )
    return s


def to_ralph_payload(m: RunMetrics) -> dict:
    """Serialize ``RunMetrics`` for POST ``/admin/slices`` (no secrets)."""
    status = validate_goal_status(m.goal_status)
    return {
        "quality": m.quality,
        "latency_ms": m.latency_ms,
        "cost_usdc6": m.cost_usdc6,
        "goal_status": status,
        "candidate_id": m.candidate_id,
        "source": SOURCE_NAME,
    }
