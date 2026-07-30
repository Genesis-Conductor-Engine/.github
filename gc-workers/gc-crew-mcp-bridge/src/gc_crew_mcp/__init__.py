"""gc_crew_mcp — CrewAI-compatible MCP adapter with trust policy."""

from .agents import AgentSpec, build_researcher_agent, to_crewai_kwargs
from .crew_topology import (
    CREW_ROSTER,
    Domain,
    domains_conflict,
    parallel_dispatch_plan,
    validate_roster,
)
from .trust import (
    DEFAULT_BLOCKED_TOOLS,
    TRUSTED_HOSTS,
    assert_trusted_mcps,
    filter_tools,
    is_trusted_url,
)

__all__ = [
    "AgentSpec",
    "CREW_ROSTER",
    "DEFAULT_BLOCKED_TOOLS",
    "Domain",
    "TRUSTED_HOSTS",
    "assert_trusted_mcps",
    "build_researcher_agent",
    "domains_conflict",
    "filter_tools",
    "is_trusted_url",
    "parallel_dispatch_plan",
    "to_crewai_kwargs",
    "validate_roster",
]

__version__ = "0.1.0"
