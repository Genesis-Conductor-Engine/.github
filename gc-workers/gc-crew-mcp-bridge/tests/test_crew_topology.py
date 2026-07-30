"""Unit tests for gc_crew_mcp.crew_topology."""

from __future__ import annotations

import unittest

from gc_crew_mcp.agents import AgentSpec
from gc_crew_mcp.crew_topology import (
    CREW_ROSTER,
    X402_WELL_KNOWN_URL,
    Domain,
    build_crew_roster,
    build_evolve_coach_agent,
    build_ops_agent,
    build_payment_agent,
    domains_conflict,
    parallel_dispatch_plan,
    validate_roster,
)
from gc_crew_mcp.trust import DEFAULT_BLOCKED_TOOLS, is_trusted_url


class TestDomain(unittest.TestCase):
    def test_domain_values(self) -> None:
        self.assertEqual(Domain.RESEARCH.value, "RESEARCH")
        self.assertEqual(Domain.PAYMENT.value, "PAYMENT")
        self.assertEqual(Domain.OPS.value, "OPS")
        self.assertEqual(Domain.EVOLVE.value, "EVOLVE")


class TestCrewRoster(unittest.TestCase):
    def test_roster_length_at_least_three(self) -> None:
        self.assertGreaterEqual(len(CREW_ROSTER), 3)
        self.assertGreaterEqual(len(build_crew_roster()), 3)

    def test_roster_has_expected_roles(self) -> None:
        roles = {a.role for a in CREW_ROSTER}
        self.assertIn("Researcher", roles)
        self.assertIn("Payment", roles)
        self.assertIn("Ops", roles)
        self.assertIn("Evolve coach", roles)

    def test_domains_are_unique(self) -> None:
        domains = [a.domain for a in CREW_ROSTER]
        self.assertEqual(len(domains), len(set(domains)))

    def test_researcher_tools_and_mcp(self) -> None:
        researcher = next(a for a in CREW_ROSTER if a.role == "Researcher")
        self.assertEqual(researcher.domain, Domain.RESEARCH.value)
        self.assertEqual(
            set(researcher.allowed_tools),
            {"search", "get_status", "list_tools"},
        )
        self.assertEqual(len(researcher.mcps), 1)
        self.assertTrue(is_trusted_url(researcher.mcps[0]))
        for blocked in DEFAULT_BLOCKED_TOOLS:
            self.assertNotIn(blocked, researcher.allowed_tools)

    def test_payment_tools_and_x402(self) -> None:
        payment = next(a for a in CREW_ROSTER if a.role == "Payment")
        self.assertEqual(payment.domain, Domain.PAYMENT.value)
        self.assertEqual(
            set(payment.allowed_tools),
            {"get_price", "inspect_402", "list_tiers"},
        )
        self.assertEqual(payment.mcps, [X402_WELL_KNOWN_URL])
        self.assertTrue(is_trusted_url(X402_WELL_KNOWN_URL))
        for blocked in DEFAULT_BLOCKED_TOOLS:
            self.assertNotIn(blocked, payment.allowed_tools)

    def test_ops_tools_no_secrets(self) -> None:
        ops = build_ops_agent()
        self.assertEqual(ops.domain, Domain.OPS.value)
        self.assertEqual(set(ops.allowed_tools), {"get_status", "health"})
        self.assertNotIn("secret_put", ops.allowed_tools)
        for url in ops.mcps:
            self.assertTrue(is_trusted_url(url))

    def test_evolve_coach_no_production_mcp(self) -> None:
        coach = build_evolve_coach_agent()
        self.assertEqual(coach.domain, Domain.EVOLVE.value)
        self.assertEqual(
            set(coach.allowed_tools),
            {"post_metrics", "list_candidates"},
        )
        # No production MCP beyond retrainer base — empty default roster mcps.
        self.assertEqual(coach.mcps, [])
        for blocked in DEFAULT_BLOCKED_TOOLS:
            self.assertNotIn(blocked, coach.allowed_tools)


class TestDomainsConflict(unittest.TestCase):
    def test_same_domain_conflicts(self) -> None:
        self.assertTrue(domains_conflict("RESEARCH", "RESEARCH"))
        self.assertTrue(domains_conflict("PAYMENT", "PAYMENT"))
        self.assertTrue(domains_conflict("OPS", "OPS"))
        self.assertTrue(domains_conflict("EVOLVE", "EVOLVE"))

    def test_research_conflicts_with_none(self) -> None:
        for other in ("PAYMENT", "OPS", "EVOLVE"):
            self.assertFalse(domains_conflict("RESEARCH", other))
            self.assertFalse(domains_conflict(other, "RESEARCH"))

    def test_payment_ops_no_deploy_no_conflict(self) -> None:
        # PAYMENT conflicts with OPS only if both have deploy (they must not).
        self.assertFalse(domains_conflict("PAYMENT", "OPS"))
        self.assertFalse(domains_conflict("OPS", "PAYMENT"))

    def test_other_cross_domain_pairs_ok(self) -> None:
        self.assertFalse(domains_conflict("PAYMENT", "EVOLVE"))
        self.assertFalse(domains_conflict("OPS", "EVOLVE"))


class TestValidateRoster(unittest.TestCase):
    def test_default_roster_ok(self) -> None:
        self.assertEqual(validate_roster(CREW_ROSTER), [])
        self.assertEqual(validate_roster(build_crew_roster()), [])

    def test_blocked_tool_in_allowed(self) -> None:
        bad = AgentSpec(
            role="Bad",
            goal="g",
            backstory="b",
            mcps=[],
            allowed_tools=["get_status", "deploy"],
            domain=Domain.OPS.value,
        )
        errors = validate_roster([bad])
        self.assertTrue(any("blocked tools" in e for e in errors))
        self.assertTrue(any("deploy" in e for e in errors))

    def test_untrusted_mcp_url(self) -> None:
        bad = AgentSpec(
            role="Bad",
            goal="g",
            backstory="b",
            mcps=["https://evil.example.com/mcp"],
            allowed_tools=["search"],
            domain=Domain.RESEARCH.value,
        )
        errors = validate_roster([bad])
        self.assertTrue(any("untrusted MCP URL" in e for e in errors))

    def test_duplicate_domain_conflict(self) -> None:
        a = build_payment_agent()
        b = AgentSpec(
            role="Payment2",
            goal="g",
            backstory="b",
            mcps=[X402_WELL_KNOWN_URL],
            allowed_tools=["get_price"],
            domain=Domain.PAYMENT.value,
        )
        errors = validate_roster([a, b])
        self.assertTrue(any("domain conflict" in e for e in errors))
        self.assertTrue(domains_conflict(a.domain, b.domain))

    def test_missing_domain(self) -> None:
        bad = AgentSpec(
            role="NoDomain",
            goal="g",
            backstory="b",
            mcps=[],
            allowed_tools=["search"],
            domain="",
        )
        errors = validate_roster([bad])
        self.assertTrue(any("missing domain" in e for e in errors))


class TestParallelDispatchPlan(unittest.TestCase):
    def test_one_dict_per_agent(self) -> None:
        plan = parallel_dispatch_plan(CREW_ROSTER)
        self.assertEqual(len(plan), len(CREW_ROSTER))

    def test_shape_and_sort_by_domain(self) -> None:
        plan = parallel_dispatch_plan(CREW_ROSTER)
        domains = [row["domain"] for row in plan]
        self.assertEqual(domains, sorted(domains))
        for row in plan:
            self.assertEqual(
                set(row.keys()),
                {"role", "domain", "mcps", "allowed_tools"},
            )

    def test_unique_domains_in_plan(self) -> None:
        plan = parallel_dispatch_plan(CREW_ROSTER)
        domains = [row["domain"] for row in plan]
        self.assertEqual(len(domains), len(set(domains)))


if __name__ == "__main__":
    unittest.main()
