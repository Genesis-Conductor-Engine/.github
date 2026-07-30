"""Three-agent (plus evolve coach) crew topology with domain isolation.

Domain B / E2: each agent owns a single domain; tools are deny-all-then-allow;
MCP URLs must pass the trust policy. No secrets, no fund movement.
"""

from __future__ import annotations

from enum import Enum

from .agents import RESEARCH_MCP_URL, AgentSpec, build_researcher_agent
from .trust import DEFAULT_BLOCKED_TOOLS, assert_trusted_mcps, is_trusted_url

# Trusted x402 well-known on the ambient host (host is trusted; no pay in unit tests).
X402_WELL_KNOWN_URL = (
    "https://optimization-inversion.genesisconductor.io/.well-known/x402"
)

# Ops reads status from the trusted ambient host only (no secret tools).
OPS_MCP_URL = "https://optimization-inversion.genesisconductor.io/mcp"

# Evolve coach may only target the retrainer base (env name: RETRAINER_BASE_URL).
# Default roster uses no production MCP beyond that contract — empty mcps.
# Local placeholder accepted by trust policy for dry-run wiring.
RETRAINER_BASE_PLACEHOLDER = "http://127.0.0.1:8090"


class Domain(str, Enum):
    """Isolation domains for parallel crew dispatch."""

    RESEARCH = "RESEARCH"
    PAYMENT = "PAYMENT"
    OPS = "OPS"
    EVOLVE = "EVOLVE"


# Cross-domain pairs that would conflict only when both hold deploy-capable
# write tools. Roster policy forbids deploy, so this set is empty under current
# policy (PAYMENT would conflict with OPS only if both had deploy).
_CROSS_DOMAIN_DEPLOY_CONFLICTS: frozenset[frozenset[str]] = frozenset()


def domains_conflict(a: str, b: str) -> bool:
    """Return True if two domains would share mutable write scope.

    Rules:
    - Same domain string always conflicts (default: no two agents share a domain).
    - RESEARCH conflicts with none of {PAYMENT, OPS, EVOLVE}.
    - PAYMENT conflicts with OPS only if both have deploy (they must not) —
      therefore no cross-domain conflict under current policy.
    """
    if not a or not b:
        return False
    if a == b:
        return True
    pair = frozenset({a, b})
    return pair in _CROSS_DOMAIN_DEPLOY_CONFLICTS


def build_payment_agent() -> AgentSpec:
    """Payment domain: inspect x402 pricing only; no write/deploy tools."""
    return AgentSpec(
        role="Payment",
        goal=(
            "Inspect x402 well-known pricing and tiers on trusted hosts without "
            "settling payments or moving funds."
        ),
        backstory=(
            "You are a Genesis Conductor payment inspector. You only read price "
            "and tier metadata from the trusted x402 well-known URL. You never "
            "deploy, write secrets, or settle live payments."
        ),
        mcps=[X402_WELL_KNOWN_URL],
        allowed_tools=["get_price", "inspect_402", "list_tiers"],
        domain=Domain.PAYMENT.value,
    )


def build_ops_agent() -> AgentSpec:
    """Ops domain: status/health only; no secrets."""
    return AgentSpec(
        role="Ops",
        goal=(
            "Report ambient service status and health from trusted hosts without "
            "touching secrets or production deploys."
        ),
        backstory=(
            "You are a Genesis Conductor ops observer. You call get_status and "
            "health on trusted endpoints only, and never handle secrets or deploys."
        ),
        mcps=[OPS_MCP_URL],
        allowed_tools=["get_status", "health"],
        domain=Domain.OPS.value,
    )


def build_evolve_coach_agent() -> AgentSpec:
    """Evolve domain: metrics/candidates only; no production MCP beyond retrainer."""
    return AgentSpec(
        role="Evolve coach",
        goal=(
            "Post run metrics and list evolve candidates against the retrainer "
            "base without production MCP tool calls beyond that base."
        ),
        backstory=(
            "You are a Genesis Conductor evolve coach. You post_metrics and "
            "list_candidates only. Live retrainer base comes from RETRAINER_BASE_URL; "
            "the default roster does not wire production MCP endpoints."
        ),
        # No production MCP tool calls beyond retrainer base — empty by default.
        mcps=[],
        allowed_tools=["post_metrics", "list_candidates"],
        domain=Domain.EVOLVE.value,
    )


def build_crew_roster() -> list[AgentSpec]:
    """Build the default multi-domain crew roster via factories."""
    return [
        build_researcher_agent(),
        build_payment_agent(),
        build_ops_agent(),
        build_evolve_coach_agent(),
    ]


CREW_ROSTER: list[AgentSpec] = build_crew_roster()


def validate_roster(roster: list[AgentSpec]) -> list[str]:
    """Return human-readable conflict messages, or empty list if roster is OK.

    Fails when any agent has blocked tools in ``allowed_tools``, untrusted MCP
    URLs, missing domain, or domain isolation conflicts (duplicate domains or
    cross-domain write-scope conflicts).
    """
    errors: list[str] = []
    if roster is None:
        return ["roster must be a list of AgentSpec"]

    domains_seen: dict[str, str] = {}  # domain -> role

    for i, agent in enumerate(roster):
        if not isinstance(agent, AgentSpec):
            errors.append(f"index {i}: not an AgentSpec")
            continue

        label = agent.role or f"index {i}"

        # Blocked tools must never appear in allowed_tools.
        blocked_in_allowed = sorted(
            set(agent.allowed_tools) & set(DEFAULT_BLOCKED_TOOLS)
        )
        if blocked_in_allowed:
            errors.append(
                f"{label}: blocked tools in allowed_tools: {blocked_in_allowed}"
            )

        # Untrusted MCP URLs.
        for url in agent.mcps:
            if not is_trusted_url(url):
                errors.append(f"{label}: untrusted MCP URL: {url!r}")
        try:
            assert_trusted_mcps(list(agent.mcps))
        except ValueError as exc:
            msg = f"{label}: {exc}"
            if msg not in errors:
                # Prefer per-URL messages already added; keep assert failure if none.
                if not any(
                    e.startswith(f"{label}: untrusted MCP URL:") for e in errors
                ):
                    errors.append(msg)

        domain = (agent.domain or "").strip()
        if not domain:
            errors.append(f"{label}: missing domain")
            continue

        # Duplicate domain among agents.
        if domain in domains_seen:
            other = domains_seen[domain]
            errors.append(
                f"domain conflict: {label!r} and {other!r} both use domain {domain!r}"
            )
        else:
            domains_seen[domain] = label

    # Cross-domain write-scope conflicts (currently none under no-deploy policy).
    domain_list = list(domains_seen.keys())
    for i, d1 in enumerate(domain_list):
        for d2 in domain_list[i + 1 :]:
            if domains_conflict(d1, d2) and d1 != d2:
                errors.append(
                    f"domain conflict: {d1!r} and {d2!r} share mutable write scope"
                )

    return errors


def parallel_dispatch_plan(roster: list[AgentSpec]) -> list[dict]:
    """Return one isolation dict per agent, sorted by domain name.

    Each dict: ``{role, domain, mcps, allowed_tools}`` documenting
    SDD/parallel-agent domain isolation.
    """
    plan: list[dict] = []
    for agent in roster:
        plan.append(
            {
                "role": agent.role,
                "domain": agent.domain,
                "mcps": list(agent.mcps),
                "allowed_tools": list(agent.allowed_tools),
            }
        )
    plan.sort(key=lambda row: row["domain"] or "")
    return plan


# Trust sanity: x402 well-known host is accepted (documented for callers).
assert is_trusted_url(X402_WELL_KNOWN_URL), "x402 well-known must be trusted"
assert is_trusted_url(RESEARCH_MCP_URL), "research MCP must be trusted"
assert is_trusted_url(OPS_MCP_URL), "ops MCP must be trusted"
