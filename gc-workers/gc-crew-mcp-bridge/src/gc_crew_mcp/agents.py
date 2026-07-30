"""Declarative agent specs and CrewAI-compatible kwargs adapter."""

from __future__ import annotations

from dataclasses import dataclass, field

from .trust import assert_trusted_mcps, filter_tools, is_trusted_url

# Placeholder MCP endpoint on the ambient host. Real /mcp may 404 until wired;
# ambient health at .../health is NOT an MCP and must not be used as one.
RESEARCH_MCP_URL = "https://optimization-inversion.genesisconductor.io/mcp"

# Optional CrewAI import — never required for kwargs construction.
try:  # pragma: no cover - presence depends on environment
    import crewai  # noqa: F401

    CREWAI_AVAILABLE = True
except ImportError:  # pragma: no cover
    CREWAI_AVAILABLE = False


@dataclass
class AgentSpec:
    """Declarative agent configuration for crew topology and MCP wiring."""

    role: str
    goal: str
    backstory: str
    mcps: list[str] = field(default_factory=list)
    allowed_tools: list[str] = field(default_factory=list)


def build_researcher_agent() -> AgentSpec:
    """Build the Researcher agent bound to the trusted placeholder MCP URL.

    Note: ``https://optimization-inversion.genesisconductor.io/health`` is the
    ambient health check and is **not** an MCP. This factory uses
    ``.../mcp`` as the MCP URL string so trust checks pass; the path may 404
    until the MCP server is wired.
    """
    return AgentSpec(
        role="Researcher",
        goal=(
            "Gather and summarize trusted operational and research signals "
            "from Genesis Conductor MCP endpoints without mutating production state."
        ),
        backstory=(
            "You are a Genesis Conductor research specialist. You only call "
            "tools on trusted hosts, never deploy or write secrets, and treat "
            "the optimization-inversion MCP URL as a placeholder until wired."
        ),
        mcps=[RESEARCH_MCP_URL],
        allowed_tools=["search", "get_status", "list_tools"],
    )


def to_crewai_kwargs(spec: AgentSpec) -> dict:
    """Return CrewAI-oriented kwargs from an ``AgentSpec``.

    Keys: ``role``, ``goal``, ``backstory``, ``mcps`` (trust-filtered).
    Works whether or not the optional ``crewai`` package is installed
    (``CREWAI_AVAILABLE`` is set at import time for callers that care).
    """
    if not isinstance(spec, AgentSpec):
        raise TypeError("spec must be an AgentSpec")

    # Drop untrusted MCP URLs; keep order of trusted ones.
    trusted_mcps = [url for url in spec.mcps if is_trusted_url(url)]
    # Ensure remaining URLs still satisfy policy.
    assert_trusted_mcps(trusted_mcps)

    # Document deny-all-then-allow for allowed_tools (side-effect free check).
    filter_tools(list(spec.allowed_tools), allowed=set(spec.allowed_tools))

    return {
        "role": spec.role,
        "goal": spec.goal,
        "backstory": spec.backstory,
        "mcps": trusted_mcps,
    }
