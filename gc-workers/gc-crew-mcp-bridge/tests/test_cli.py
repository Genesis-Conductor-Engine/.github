"""Unit tests for gc_crew_mcp CLI (no live network / no pay)."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any
from urllib.request import Request

from gc_crew_mcp import __version__
from gc_crew_mcp.cli import (
    DEFAULT_RETRAINER_BASE,
    cmd_evolve_dry,
    cmd_roster,
    cmd_trust_check,
    cmd_version,
    cmd_x402_discover,
    main,
)
from gc_crew_mcp.x402_client import (
    DEFAULT_PRICE_USDC6,
    HEADER_ADMIN_KEY,
    HEADER_PAYMENT_PROOF,
    RETRAINER_NETWORK,
    RETRAINER_PAY_TO,
)

PKG_ROOT = Path(__file__).resolve().parent.parent
SRC = PKG_ROOT / "src"
PYTHON = sys.executable


def _run_module(*args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(SRC) + (
        os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else ""
    )
    # Avoid accidental logfire noise in subprocess tests.
    env.pop("LOGFIRE_TOKEN", None)
    return subprocess.run(
        [PYTHON, "-m", "gc_crew_mcp", *args],
        cwd=str(PKG_ROOT),
        capture_output=True,
        text=True,
        env=env,
    )


def _capture(fn, *args, **kwargs) -> tuple[int, str, str]:
    out = io.StringIO()
    err = io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = fn(*args, **kwargs)
    return code, out.getvalue(), err.getvalue()


class _FakeResponse:
    def __init__(self, payload: dict, *, status: int = 200) -> None:
        self._raw = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None


class TestTrustCheck(unittest.TestCase):
    def test_all_trusted_exit_0(self) -> None:
        urls = [
            "https://optimization-inversion.genesisconductor.io/mcp",
            "http://127.0.0.1:8090/",
        ]
        code, out, _ = _capture(cmd_trust_check, urls)
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual(len(data), 2)
        self.assertTrue(all(row["trusted"] for row in data))
        self.assertEqual(data[0]["url"], urls[0])

    def test_untrusted_exit_2(self) -> None:
        code, out, _ = _capture(
            cmd_trust_check,
            ["https://evil.example.com/mcp"],
        )
        self.assertEqual(code, 2)
        data = json.loads(out)
        self.assertEqual(data[0]["trusted"], False)

    def test_mixed_exit_2(self) -> None:
        code, out, _ = _capture(
            cmd_trust_check,
            [
                "https://fed.genesisconductor.io/mcp",
                "https://not-trusted.example/x",
            ],
        )
        self.assertEqual(code, 2)
        data = json.loads(out)
        self.assertTrue(data[0]["trusted"])
        self.assertFalse(data[1]["trusted"])

    def test_empty_urls_exit_2(self) -> None:
        code, _, err = _capture(cmd_trust_check, [])
        self.assertEqual(code, 2)
        self.assertIn("requires one or more", err)

    def test_main_trust_check(self) -> None:
        code, out, _ = _capture(
            main,
            [
                "trust-check",
                "https://optimization-inversion.genesisconductor.io/mcp",
            ],
        )
        self.assertEqual(code, 0)
        self.assertIn("trusted", out)


class TestRoster(unittest.TestCase):
    def test_roster_ok(self) -> None:
        code, out, err = _capture(cmd_roster)
        self.assertEqual(code, 0, msg=err)
        plan = json.loads(out)
        self.assertIsInstance(plan, list)
        self.assertGreaterEqual(len(plan), 3)
        domains = [row["domain"] for row in plan]
        self.assertEqual(domains, sorted(domains))
        for row in plan:
            self.assertIn("role", row)
            self.assertIn("domain", row)
            self.assertIn("mcps", row)
            self.assertIn("allowed_tools", row)

    def test_main_roster(self) -> None:
        code, out, err = _capture(main, ["roster"])
        self.assertEqual(code, 0, msg=err)
        self.assertTrue(out.strip().startswith("["))


class TestEvolveDry(unittest.TestCase):
    def test_default_mock_402(self) -> None:
        code, out, err = _capture(
            cmd_evolve_dry,
            quality=0.9,
            latency_ms=12.0,
            cost_usdc6=0,
            goal_status="partial",
            candidate_id="dry-1",
        )
        self.assertEqual(code, 0, msg=err)
        result = json.loads(out)
        self.assertEqual(result["status"], "payment_required")
        self.assertEqual(result["x402"]["price_usdc6"], DEFAULT_PRICE_USDC6)
        self.assertEqual(result["x402"]["network"], RETRAINER_NETWORK)
        self.assertEqual(result["x402"]["payTo"], RETRAINER_PAY_TO)

    def test_injected_ok_transport(self) -> None:
        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict[str, Any],
        ) -> tuple[int, dict]:
            self.assertEqual(method, "POST")
            self.assertTrue(url.endswith("/admin/slices"))
            self.assertNotIn("payment_proof", body)
            self.assertNotIn("admin_key", body)
            return 200, {"accepted": True}

        code, out, err = _capture(
            cmd_evolve_dry,
            quality=0.5,
            latency_ms=1.0,
            cost_usdc6=0,
            goal_status="reached",
            candidate_id=None,
            transport=transport,
        )
        self.assertEqual(code, 0, msg=err)
        result = json.loads(out)
        self.assertEqual(result["status"], "ok")

    def test_error_transport_exit_1(self) -> None:
        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict[str, Any],
        ) -> tuple[int, dict]:
            return 500, {"error": "boom"}

        code, out, _ = _capture(
            cmd_evolve_dry,
            quality=0.1,
            latency_ms=0.0,
            cost_usdc6=0,
            goal_status="unknown",
            candidate_id=None,
            transport=transport,
        )
        self.assertEqual(code, 1)
        result = json.loads(out)
        self.assertEqual(result["status"], "error")

    def test_invalid_goal_status_exit_2(self) -> None:
        code, _, err = _capture(
            cmd_evolve_dry,
            quality=0.0,
            latency_ms=0.0,
            cost_usdc6=0,
            goal_status="bogus",
            candidate_id=None,
        )
        self.assertEqual(code, 2)
        self.assertIn("goal_status", err)

    def test_main_evolve_dry_no_network(self) -> None:
        code, out, err = _capture(
            main,
            ["evolve-dry", "--goal-status", "partial", "--quality", "0.7"],
        )
        self.assertEqual(code, 0, msg=err)
        result = json.loads(out)
        self.assertEqual(result["status"], "payment_required")

    def test_live_without_proof_exit_2(self) -> None:
        """--live with trusted base but no proof/admin key must refuse."""
        # Ensure env auth is not set so the gate fails cleanly.
        saved_proof = os.environ.pop("X402_PAYMENT_PROOF", None)
        saved_key = os.environ.pop("X_ADMIN_KEY", None)
        try:
            code, out, err = _capture(
                main,
                [
                    "evolve-dry",
                    "--live",
                    "--goal-status",
                    "partial",
                    "--base-url",
                    DEFAULT_RETRAINER_BASE,
                ],
            )
        finally:
            if saved_proof is not None:
                os.environ["X402_PAYMENT_PROOF"] = saved_proof
            if saved_key is not None:
                os.environ["X_ADMIN_KEY"] = saved_key
        self.assertEqual(code, 2)
        self.assertEqual(out.strip(), "")
        self.assertIn("--live", err)
        self.assertTrue(
            "payment-proof" in err.lower() or "admin-key" in err.lower() or "X402" in err,
            msg=err,
        )

    def test_live_untrusted_base_exit_2(self) -> None:
        code, _, err = _capture(
            main,
            [
                "evolve-dry",
                "--live",
                "--admin-key",
                "dummy-key",
                "--base-url",
                "https://evil.example.com",
            ],
        )
        self.assertEqual(code, 2)
        self.assertIn("trusted", err.lower())

    def test_live_with_admin_key_uses_injected_transport(self) -> None:
        captured: dict[str, Any] = {}

        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict[str, Any],
        ) -> tuple[int, dict]:
            captured["headers"] = headers
            captured["body"] = body
            return 200, {"accepted": True}

        code, out, err = _capture(
            main,
            [
                "evolve-dry",
                "--live",
                "--admin-key",
                "TEST_ADMIN",
                "--goal-status",
                "partial",
                "--base-url",
                DEFAULT_RETRAINER_BASE,
            ],
            transport=transport,
        )
        self.assertEqual(code, 0, msg=err)
        result = json.loads(out)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(captured["headers"][HEADER_ADMIN_KEY], "TEST_ADMIN")
        self.assertNotIn("admin_key", captured["body"])
        self.assertNotIn(HEADER_PAYMENT_PROOF, captured["headers"])

    def test_live_with_payment_proof_env(self) -> None:
        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict[str, Any],
        ) -> tuple[int, dict]:
            self.assertEqual(headers.get(HEADER_PAYMENT_PROOF), "ENV_PROOF")
            return 402, {
                "accepts": [
                    {
                        "amount": str(DEFAULT_PRICE_USDC6),
                        "network": RETRAINER_NETWORK,
                        "payTo": RETRAINER_PAY_TO,
                    }
                ]
            }

        old = os.environ.get("X402_PAYMENT_PROOF")
        os.environ["X402_PAYMENT_PROOF"] = "ENV_PROOF"
        try:
            code, out, err = _capture(
                main,
                [
                    "evolve-dry",
                    "--live",
                    "--goal-status",
                    "partial",
                ],
                transport=transport,
            )
        finally:
            if old is None:
                os.environ.pop("X402_PAYMENT_PROOF", None)
            else:
                os.environ["X402_PAYMENT_PROOF"] = old

        self.assertEqual(code, 0, msg=err)
        result = json.loads(out)
        self.assertEqual(result["status"], "payment_required")

    def test_untrusted_base_without_live_still_raises_exit_2(self) -> None:
        """submit_metrics trust gate rejects untrusted base even on mock path."""
        code, _, err = _capture(
            cmd_evolve_dry,
            quality=0.1,
            latency_ms=0.0,
            cost_usdc6=0,
            goal_status="partial",
            candidate_id=None,
            base_url="https://evil.example.com",
        )
        self.assertEqual(code, 2)
        self.assertIn("untrusted", err.lower())


class TestX402Discover(unittest.TestCase):
    def test_match_with_injected_opener(self) -> None:
        captured: list[Request] = []

        def opener(req: Request) -> _FakeResponse:
            captured.append(req)
            return _FakeResponse(
                {
                    "payTo": RETRAINER_PAY_TO,
                    "network": RETRAINER_NETWORK,
                    "price": {"amount": "10000", "currency": "USDC", "decimals": 6},
                }
            )

        code, out, err = _capture(
            cmd_x402_discover,
            DEFAULT_RETRAINER_BASE,
            opener=opener,
        )
        self.assertEqual(code, 0, msg=err)
        self.assertEqual(len(captured), 1)
        self.assertIn("/.well-known/x402", captured[0].full_url)
        data = json.loads(out)
        self.assertTrue(data["match"])
        self.assertEqual(data["discovered"]["price_usdc6"], DEFAULT_PRICE_USDC6)
        self.assertEqual(data["expected"]["payTo"], RETRAINER_PAY_TO)

    def test_mismatch(self) -> None:
        def opener(req: Request) -> _FakeResponse:
            return _FakeResponse(
                {
                    "payTo": "0xdead",
                    "network": "eip155:1",
                    "price": "999",
                }
            )

        code, out, err = _capture(
            cmd_x402_discover,
            DEFAULT_RETRAINER_BASE,
            opener=opener,
        )
        self.assertEqual(code, 0, msg=err)
        data = json.loads(out)
        self.assertFalse(data["match"])

    def test_untrusted_base_exit_2(self) -> None:
        def opener(req: Request) -> _FakeResponse:
            raise AssertionError("must not open network for untrusted host")

        code, _, err = _capture(
            cmd_x402_discover,
            "https://evil.example.com",
            opener=opener,
        )
        self.assertEqual(code, 2)
        self.assertIn("untrusted", err.lower())

    def test_fetch_failure_exit_1(self) -> None:
        def opener(req: Request) -> _FakeResponse:
            raise OSError("simulated network down")

        code, _, err = _capture(
            cmd_x402_discover,
            DEFAULT_RETRAINER_BASE,
            opener=opener,
        )
        self.assertEqual(code, 1)
        self.assertIn("x402-discover failed", err)

    def test_main_inject_opener(self) -> None:
        def opener(req: Request) -> _FakeResponse:
            return _FakeResponse(
                {
                    "accepts": [
                        {
                            "amount": "10000",
                            "network": RETRAINER_NETWORK,
                            "payTo": RETRAINER_PAY_TO,
                        }
                    ]
                }
            )

        code, out, err = _capture(
            main,
            ["x402-discover", "--base-url", DEFAULT_RETRAINER_BASE],
            opener=opener,
        )
        self.assertEqual(code, 0, msg=err)
        data = json.loads(out)
        self.assertTrue(data["match"])


class TestVersion(unittest.TestCase):
    def test_version_cmd(self) -> None:
        code, out, _ = _capture(cmd_version)
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), __version__)

    def test_main_version_no_observability_required(self) -> None:
        code, out, _ = _capture(main, ["version"])
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), __version__)


class TestModuleEntry(unittest.TestCase):
    def test_python_m_version(self) -> None:
        proc = _run_module("version")
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        self.assertEqual(proc.stdout.strip(), __version__)

    def test_python_m_roster(self) -> None:
        proc = _run_module("roster")
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        plan = json.loads(proc.stdout)
        self.assertIsInstance(plan, list)
        self.assertGreaterEqual(len(plan), 3)

    def test_python_m_trust_check(self) -> None:
        proc = _run_module(
            "trust-check",
            "https://optimization-inversion.genesisconductor.io/mcp",
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        data = json.loads(proc.stdout)
        self.assertTrue(data[0]["trusted"])

    def test_python_m_evolve_dry(self) -> None:
        proc = _run_module("evolve-dry", "--goal-status", "partial")
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["status"], "payment_required")

    def test_python_m_missing_command_usage(self) -> None:
        proc = _run_module()
        self.assertNotEqual(proc.returncode, 0)


if __name__ == "__main__":
    unittest.main()
