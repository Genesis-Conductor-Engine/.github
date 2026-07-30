"""Unit tests for gc_crew_mcp.agents."""

from __future__ import annotations

import unittest

from gc_crew_mcp.agents import (
    RESEARCH_MCP_URL,
    AgentSpec,
    build_researcher_agent,
    to_crewai_kwargs,
)
from gc_crew_mcp.trust import assert_trusted_mcps, is_trusted_url


class TestAgentSpec(unittest.TestCase):
    def test_dataclass_fields(self) -> None:
        spec = AgentSpec(
            role="R",
            goal="G",
            backstory="B",
            mcps=["https://fed.genesisconductor.io/mcp"],
            allowed_tools=["search"],
        )
        self.assertEqual(spec.role, "R")
        self.assertEqual(spec.goal, "G")
        self.assertEqual(spec.backstory, "B")
        self.assertEqual(spec.mcps, ["https://fed.genesisconductor.io/mcp"])
        self.assertEqual(spec.allowed_tools, ["search"])


class TestBuildResearcherAgent(unittest.TestCase):
    def test_mcp_is_placeholder_not_health(self) -> None:
        spec = build_researcher_agent()
        self.assertEqual(spec.role, "Researcher")
        self.assertEqual(spec.mcps, [RESEARCH_MCP_URL])
        self.assertEqual(
            RESEARCH_MCP_URL,
            "https://optimization-inversion.genesisconductor.io/mcp",
        )
        for url in spec.mcps:
            self.assertNotIn("/health", url)
            self.assertTrue(is_trusted_url(url))
        assert_trusted_mcps(spec.mcps)

    def test_allowed_tools_are_read_oriented(self) -> None:
        spec = build_researcher_agent()
        for blocked in ("delete", "deploy", "secret_put", "write_file"):
            self.assertNotIn(blocked, spec.allowed_tools)


class TestToCrewaiKwargs(unittest.TestCase):
    def test_kwargs_shape(self) -> None:
        spec = build_researcher_agent()
        kwargs = to_crewai_kwargs(spec)
        self.assertEqual(
            set(kwargs.keys()),
            {"role", "goal", "backstory", "mcps"},
        )
        self.assertEqual(kwargs["role"], spec.role)
        self.assertEqual(kwargs["goal"], spec.goal)
        self.assertEqual(kwargs["backstory"], spec.backstory)
        self.assertEqual(kwargs["mcps"], spec.mcps)

    def test_filters_untrusted_mcps(self) -> None:
        spec = AgentSpec(
            role="X",
            goal="Y",
            backstory="Z",
            mcps=[
                "https://optimization-inversion.genesisconductor.io/mcp",
                "https://evil.example.com/mcp",
            ],
            allowed_tools=["search"],
        )
        kwargs = to_crewai_kwargs(spec)
        self.assertEqual(
            kwargs["mcps"],
            ["https://optimization-inversion.genesisconductor.io/mcp"],
        )

    def test_works_without_crewai_installed(self) -> None:
        # Adapter must return dict even if crewai is absent (optional import).
        from gc_crew_mcp import agents as agents_mod

        self.assertIsInstance(agents_mod.CREWAI_AVAILABLE, bool)
        kwargs = to_crewai_kwargs(build_researcher_agent())
        self.assertIsInstance(kwargs, dict)
        self.assertIn("mcps", kwargs)


if __name__ == "__main__":
    unittest.main()
