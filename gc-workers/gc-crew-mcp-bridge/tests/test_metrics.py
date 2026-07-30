"""Unit tests for gc_crew_mcp.metrics."""

from __future__ import annotations

import unittest

from gc_crew_mcp.metrics import (
    SOURCE_NAME,
    VALID_GOAL_STATUSES,
    RunMetrics,
    to_ralph_payload,
    validate_goal_status,
)


class TestValidateGoalStatus(unittest.TestCase):
    def test_accepts_all_enum_values(self) -> None:
        for s in (
            "reached",
            "not_reached",
            "partial",
            "ambient",
            "unknown",
        ):
            self.assertEqual(validate_goal_status(s), s)
            self.assertIn(s, VALID_GOAL_STATUSES)

    def test_rejects_invalid(self) -> None:
        for bad in ("", "success", "REACHED", "done", "failed"):
            with self.assertRaises(ValueError):
                validate_goal_status(bad)

    def test_rejects_non_string(self) -> None:
        with self.assertRaises(ValueError):
            validate_goal_status(None)  # type: ignore[arg-type]


class TestRunMetricsAndPayload(unittest.TestCase):
    def test_to_ralph_payload_keys(self) -> None:
        m = RunMetrics(
            quality=0.9,
            latency_ms=120.5,
            cost_usdc6=10000,
            goal_status="partial",
            candidate_id="cand-1",
        )
        payload = to_ralph_payload(m)
        self.assertEqual(
            set(payload.keys()),
            {
                "quality",
                "latency_ms",
                "cost_usdc6",
                "goal_status",
                "candidate_id",
                "source",
            },
        )
        self.assertEqual(payload["quality"], 0.9)
        self.assertEqual(payload["latency_ms"], 120.5)
        self.assertEqual(payload["cost_usdc6"], 10000)
        self.assertEqual(payload["goal_status"], "partial")
        self.assertEqual(payload["candidate_id"], "cand-1")
        self.assertEqual(payload["source"], SOURCE_NAME)
        self.assertEqual(payload["source"], "gc-crew-mcp-bridge")

    def test_candidate_id_none(self) -> None:
        m = RunMetrics(
            quality=0.5,
            latency_ms=10.0,
            cost_usdc6=0,
            goal_status="unknown",
        )
        payload = to_ralph_payload(m)
        self.assertIsNone(payload["candidate_id"])

    def test_invalid_goal_status_in_payload(self) -> None:
        m = RunMetrics(
            quality=1.0,
            latency_ms=1.0,
            cost_usdc6=0,
            goal_status="bogus",
        )
        with self.assertRaises(ValueError):
            to_ralph_payload(m)

    def test_payload_has_no_secret_keys(self) -> None:
        m = RunMetrics(
            quality=0.1,
            latency_ms=1.0,
            cost_usdc6=0,
            goal_status="ambient",
            candidate_id=None,
        )
        payload = to_ralph_payload(m)
        for key in ("payment_proof", "admin_key", "private_key", "secret"):
            self.assertNotIn(key, payload)


if __name__ == "__main__":
    unittest.main()
