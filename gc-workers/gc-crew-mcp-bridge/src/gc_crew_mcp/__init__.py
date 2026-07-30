"""gc_crew_mcp — CrewAI-compatible MCP adapter with trust policy."""

from .agents import AgentSpec, build_researcher_agent, to_crewai_kwargs
from .trust import (
    DEFAULT_BLOCKED_TOOLS,
    TRUSTED_HOSTS,
    assert_trusted_mcps,
    filter_tools,
    is_trusted_url,
)

__all__ = [
    "AgentSpec",
    "DEFAULT_BLOCKED_TOOLS",
    "TRUSTED_HOSTS",
    "assert_trusted_mcps",
    "build_researcher_agent",
    "filter_tools",
    "is_trusted_url",
    "to_crewai_kwargs",
]

__version__ = "0.1.0"
