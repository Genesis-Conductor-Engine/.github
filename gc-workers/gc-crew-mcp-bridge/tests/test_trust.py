"""Unit tests for gc_crew_mcp.trust."""

from __future__ import annotations

import unittest

from gc_crew_mcp.trust import (
    DEFAULT_BLOCKED_TOOLS,
    TRUSTED_HOSTS,
    assert_trusted_mcps,
    filter_tools,
    is_trusted_url,
)


class TestTrustedHosts(unittest.TestCase):
    def test_trusted_hosts_contains_required(self) -> None:
        for host in (
            "optimization-inversion.genesisconductor.io",
            "fed.genesisconductor.io",
            "localhost",
            "127.0.0.1",
        ):
            self.assertIn(host, TRUSTED_HOSTS)

    def test_default_blocked_tools(self) -> None:
        expected = {"delete", "deploy", "secret_put", "write_file", "rm", "drop_table"}
        self.assertEqual(set(DEFAULT_BLOCKED_TOOLS), expected)


class TestIsTrustedUrl(unittest.TestCase):
    def test_accept_https_trusted_remote(self) -> None:
        self.assertTrue(
            is_trusted_url("https://optimization-inversion.genesisconductor.io/mcp")
        )
        self.assertTrue(is_trusted_url("https://fed.genesisconductor.io/v1"))
        self.assertTrue(
            is_trusted_url("https://optimization-inversion.genesisconductor.io/health")
        )

    def test_accept_https_genesis_suffix(self) -> None:
        self.assertTrue(is_trusted_url("https://ambient.genesisconductor.io/mcp"))
        self.assertTrue(is_trusted_url("https://api.genesisconductor.io/tools"))

    def test_accept_http_localhost(self) -> None:
        self.assertTrue(is_trusted_url("http://localhost:8080/mcp"))
        self.assertTrue(is_trusted_url("http://127.0.0.1/mcp"))

    def test_reject_untrusted_https(self) -> None:
        self.assertFalse(is_trusted_url("https://evil.example.com/mcp"))
        self.assertFalse(is_trusted_url("https://example.com/"))

    def test_reject_http_remote(self) -> None:
        self.assertFalse(
            is_trusted_url("http://optimization-inversion.genesisconductor.io/mcp")
        )
        self.assertFalse(is_trusted_url("http://evil.example.com/mcp"))

    def test_reject_https_localhost(self) -> None:
        # Local hosts are trusted only over http for tests.
        self.assertFalse(is_trusted_url("https://localhost/mcp"))
        self.assertFalse(is_trusted_url("https://127.0.0.1/mcp"))

    def test_reject_garbage(self) -> None:
        self.assertFalse(is_trusted_url(""))
        self.assertFalse(is_trusted_url("not-a-url"))
        self.assertFalse(is_trusted_url("ftp://localhost/mcp"))


class TestFilterTools(unittest.TestCase):
    def test_blocks_default_dangerous_tools(self) -> None:
        names = ["search", "delete", "get_status", "deploy", "list_tools"]
        out = filter_tools(names)
        self.assertEqual(out, ["search", "get_status", "list_tools"])

    def test_allowlist_intersection(self) -> None:
        names = ["search", "get_status", "list_tools", "get_price"]
        out = filter_tools(names, allowed={"search", "list_tools"})
        self.assertEqual(out, ["search", "list_tools"])

    def test_allowlist_cannot_include_blocked(self) -> None:
        names = ["search", "delete", "deploy"]
        out = filter_tools(names, allowed={"search", "delete", "deploy"})
        self.assertEqual(out, ["search"])

    def test_custom_blocked(self) -> None:
        names = ["search", "get_status", "custom_danger"]
        out = filter_tools(
            names,
            allowed={"search", "get_status", "custom_danger"},
            blocked={"custom_danger"},
        )
        self.assertEqual(out, ["search", "get_status"])


class TestAssertTrustedMcps(unittest.TestCase):
    def test_accepts_trusted_list(self) -> None:
        assert_trusted_mcps(
            [
                "https://optimization-inversion.genesisconductor.io/mcp",
                "http://127.0.0.1:9/mcp",
            ]
        )

    def test_raises_on_untrusted(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            assert_trusted_mcps(["https://evil.example.com/mcp"])
        self.assertIn("untrusted", str(ctx.exception).lower())

    def test_raises_on_mixed(self) -> None:
        with self.assertRaises(ValueError):
            assert_trusted_mcps(
                [
                    "https://fed.genesisconductor.io/mcp",
                    "https://not-trusted.example.org/mcp",
                ]
            )


if __name__ == "__main__":
    unittest.main()
