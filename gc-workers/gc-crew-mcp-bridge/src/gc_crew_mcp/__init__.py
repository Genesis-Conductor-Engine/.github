"""gc_crew_mcp — CrewAI-compatible MCP adapter with trust policy."""

from .agents import AgentSpec, build_researcher_agent, to_crewai_kwargs
from .crew_topology import (
    CREW_ROSTER,
    Domain,
    domains_conflict,
    parallel_dispatch_plan,
    validate_roster,
)
from .evolve_hook import submit_metrics
from .metrics import RunMetrics, to_ralph_payload, validate_goal_status
from .trust import (
    DEFAULT_BLOCKED_TOOLS,
    TRUSTED_HOSTS,
    assert_trusted_mcps,
    filter_tools,
    is_trusted_url,
)
from .x402_client import (
    DEFAULT_PRICE_USDC6,
    build_admin_request,
    classify_response,
    parse_402_body,
)

__all__ = [
    "AgentSpec",
    "CREW_ROSTER",
    "DEFAULT_BLOCKED_TOOLS",
    "DEFAULT_PRICE_USDC6",
    "Domain",
    "RunMetrics",
    "TRUSTED_HOSTS",
    "assert_trusted_mcps",
    "build_admin_request",
    "build_researcher_agent",
    "classify_response",
    "domains_conflict",
    "filter_tools",
    "is_trusted_url",
    "parallel_dispatch_plan",
    "parse_402_body",
    "submit_metrics",
    "to_crewai_kwargs",
    "to_ralph_payload",
    "validate_goal_status",
    "validate_roster",
]

__version__ = "0.1.0"
