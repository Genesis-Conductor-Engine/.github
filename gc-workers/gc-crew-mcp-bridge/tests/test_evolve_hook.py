"""Unit tests for gc_crew_mcp.evolve_hook (mock transport only)."""

from __future__ import annotations

import unittest
from typing import Any

from gc_crew_mcp.evolve_hook import submit_metrics
from gc_crew_mcp.metrics import RunMetrics
from gc_crew_mcp.x402_client import (
    DEFAULT_PRICE_USDC6,
    HEADER_ADMIN_KEY,
    HEADER_PAYMENT_PROOF,
    RETRAINER_NETWORK,
    RETRAINER_PAY_TO,
)


def _sample_metrics(**overrides: Any) -> RunMetrics:
    base = dict(
        quality=0.8,
        latency_ms=42.0,
        cost_usdc6=0,
        goal_status="partial",
        candidate_id="c-1",
    )
    base.update(overrides)
    return RunMetrics(**base)  # type: ignore[arg-type]


class TestSubmitMetrics(unittest.TestCase):
    def test_200_ok(self) -> None:
        calls: list[tuple] = []

        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict,
        ) -> tuple[int, dict]:
            calls.append((method, url, headers, body))
            return 200, {"accepted": True, "id": "slice-1"}

        result = submit_metrics(
            "https://optimization-inversion.genesisconductor.io",
            _sample_metrics(),
            transport=transport,
        )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["body"]["accepted"], True)
        self.assertEqual(len(calls), 1)
        method, url, headers, body = calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/admin/slices"))
        self.assertEqual(body["source"], "gc-crew-mcp-bridge")
        self.assertEqual(body["goal_status"], "partial")
        self.assertEqual(body["quality"], 0.8)
        self.assertNotIn("payment_proof", body)
        self.assertNotIn("admin_key", body)
        self.assertNotIn(HEADER_PAYMENT_PROOF, headers)
        self.assertNotIn(HEADER_ADMIN_KEY, headers)

    def test_402_payment_required_no_raise(self) -> None:
        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict,
        ) -> tuple[int, dict]:
            return 402, {
                "accepts": [
                    {
                        "amount": "10000",
                        "network": RETRAINER_NETWORK,
                        "payTo": RETRAINER_PAY_TO,
                    }
                ]
            }

        result = submit_metrics(
            "https://optimization-inversion.genesisconductor.io",
            _sample_metrics(goal_status="not_reached"),
            transport=transport,
        )
        self.assertEqual(result["status"], "payment_required")
        self.assertIn("x402", result)
        self.assertEqual(result["x402"]["price_usdc6"], DEFAULT_PRICE_USDC6)
        self.assertEqual(result["x402"]["payTo"], RETRAINER_PAY_TO)
        self.assertEqual(result["x402"]["network"], RETRAINER_NETWORK)
        self.assertNotIn("body", result)  # 402 shape uses x402, not body

    def test_auth_headers_not_in_body(self) -> None:
        captured: dict[str, Any] = {}

        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict,
        ) -> tuple[int, dict]:
            captured["headers"] = headers
            captured["body"] = body
            return 200, {"ok": True}

        submit_metrics(
            "https://fed.genesisconductor.io",
            _sample_metrics(goal_status="reached"),
            payment_proof="PROOF_TOKEN",
            admin_key="ADMIN_KEY",
            transport=transport,
        )
        self.assertEqual(captured["headers"][HEADER_PAYMENT_PROOF], "PROOF_TOKEN")
        self.assertEqual(captured["headers"][HEADER_ADMIN_KEY], "ADMIN_KEY")
        self.assertNotIn("payment_proof", captured["body"])
        self.assertNotIn("admin_key", captured["body"])
        self.assertNotIn("PROOF_TOKEN", str(captured["body"]))
        self.assertNotIn("ADMIN_KEY", str(captured["body"]))

    def test_error_status(self) -> None:
        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict,
        ) -> tuple[int, dict]:
            return 503, {"error": "unavailable"}

        result = submit_metrics(
            "https://optimization-inversion.genesisconductor.io",
            _sample_metrics(),
            transport=transport,
        )
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["http_status"], 503)
        self.assertEqual(result["body"]["error"], "unavailable")

    def test_invalid_goal_status_raises_before_transport(self) -> None:
        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict,
        ) -> tuple[int, dict]:
            raise AssertionError("transport must not be called")

        with self.assertRaises(ValueError):
            submit_metrics(
                "https://optimization-inversion.genesisconductor.io",
                _sample_metrics(goal_status="nope"),
                transport=transport,
            )

    def test_maps_all_goal_statuses(self) -> None:
        for status in (
            "reached",
            "not_reached",
            "partial",
            "ambient",
            "unknown",
        ):
            seen: list[str] = []

            def transport(
                method: str,
                url: str,
                headers: dict[str, str],
                body: dict,
                *,
                _seen: list[str] = seen,
            ) -> tuple[int, dict]:
                _seen.append(body["goal_status"])
                return 200, {}

            submit_metrics(
                "http://127.0.0.1:9",
                _sample_metrics(goal_status=status),
                transport=transport,
            )
            self.assertEqual(seen, [status])

    def test_bad_base_url(self) -> None:
        with self.assertRaises(ValueError):
            submit_metrics(
                "",
                _sample_metrics(),
                transport=lambda *a, **k: (200, {}),
            )
        with self.assertRaises(ValueError):
            submit_metrics(
                "ftp://evil.example",
                _sample_metrics(),
                transport=lambda *a, **k: (200, {}),
            )

    def test_untrusted_base_url_raises(self) -> None:
        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict,
        ) -> tuple[int, dict]:
            raise AssertionError("transport must not be called for untrusted base")

        with self.assertRaises(ValueError) as ctx:
            submit_metrics(
                "https://evil.example.com",
                _sample_metrics(),
                transport=transport,
            )
        self.assertIn("untrusted", str(ctx.exception).lower())

        with self.assertRaises(ValueError) as ctx2:
            submit_metrics(
                "https://not-genesis.example.org/admin",
                _sample_metrics(),
                transport=transport,
            )
        self.assertIn("untrusted", str(ctx2.exception).lower())

    def test_trusted_origin_without_path_accepted(self) -> None:
        """Path-less trusted origin still passes the is_trusted_url origin gate."""
        seen: list[str] = []

        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict,
        ) -> tuple[int, dict]:
            seen.append(url)
            return 200, {"ok": True}

        result = submit_metrics(
            "https://optimization-inversion.genesisconductor.io",
            _sample_metrics(),
            transport=transport,
        )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(seen), 1)


if __name__ == "__main__":
    unittest.main()
