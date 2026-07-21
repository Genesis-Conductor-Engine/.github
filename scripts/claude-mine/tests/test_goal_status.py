"""Tests for classify_goal_outcome (stdlib unittest)."""

from __future__ import annotations

import unittest
from pathlib import Path

from claude_mine.goal_status import classify_goal_outcome
from claude_mine.parser import iter_session_texts

FIXTURES = Path(__file__).resolve().parent / "fixtures"
NOT_REACHED = FIXTURES / "goal_not_reached.jsonl"
REACHED = FIXTURES / "goal_reached.jsonl"
AMBIENT = FIXTURES / "goal_ambient.jsonl"

RESULT_KEYS = {
    "status",
    "confidence",
    "incomplete_hits",
    "success_hits",
    "blockers",
    "goal_candidates",
}

STATUSES = {"reached", "not_reached", "partial", "ambient", "unknown"}


def _load(path: Path) -> list[tuple[str, str]]:
    return list(iter_session_texts(path))


class TestClassifyGoalOutcomeShape(unittest.TestCase):
    def test_result_keys_and_types(self) -> None:
        result = classify_goal_outcome(
            [("user", "Goal: ship it"), ("assistant", "all tasks complete")]
        )
        self.assertEqual(set(result.keys()), RESULT_KEYS)
        self.assertIn(result["status"], STATUSES)
        self.assertIsInstance(result["confidence"], float)
        self.assertGreaterEqual(result["confidence"], 0.0)
        self.assertLessEqual(result["confidence"], 1.0)
        self.assertIsInstance(result["incomplete_hits"], int)
        self.assertIsInstance(result["success_hits"], int)
        self.assertGreaterEqual(result["incomplete_hits"], 0)
        self.assertGreaterEqual(result["success_hits"], 0)
        self.assertIsInstance(result["blockers"], list)
        self.assertIsInstance(result["goal_candidates"], list)
        self.assertLessEqual(len(result["blockers"]), 10)
        self.assertLessEqual(len(result["goal_candidates"]), 5)

    def test_empty_texts_unknown(self) -> None:
        result = classify_goal_outcome([])
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["incomplete_hits"], 0)
        self.assertEqual(result["success_hits"], 0)

    def test_goal_candidates_redacted_and_capped(self) -> None:
        long_hex = "0x" + ("c" * 64)
        texts = [
            (
                "user",
                f"Goal: deploy worker with private_key={long_hex} and win CI",
            ),
            ("user", "Objective: fund gas later"),
            ("user", "Win condition: merge-ready"),
            ("user", "Also fund-agent-gas runbook"),
            ("user", "Deploy checklist item five"),
            ("user", "Extra goal should be dropped by cap"),
            ("assistant", "all tasks complete. goal met."),
        ]
        result = classify_goal_outcome(texts)
        self.assertLessEqual(len(result["goal_candidates"]), 5)
        self.assertGreaterEqual(len(result["goal_candidates"]), 1)
        joined = "\n".join(result["goal_candidates"])
        self.assertNotIn("c" * 64, joined.lower())
        self.assertNotRegex(joined, r"0x[0-9a-fA-F]{64}\b")
        self.assertTrue(
            "0xLONG" in joined or "REDACTED" in joined,
            f"expected redaction in goal_candidates: {joined!r}",
        )

    def test_blockers_deduped_max_10(self) -> None:
        texts = [
            (
                "assistant",
                "blocked blocked underfunded GAS_STARVED can_sign false "
                "TREASURY_PRIVATE waiting for secrets not set session limit "
                "failed to settle blocked again underfunded",
            ),
        ]
        result = classify_goal_outcome(texts)
        self.assertEqual(result["status"], "not_reached")
        self.assertGreater(result["incomplete_hits"], 0)
        self.assertEqual(len(result["blockers"]), len(set(result["blockers"])))
        self.assertLessEqual(len(result["blockers"]), 10)
        self.assertGreaterEqual(len(result["blockers"]), 1)

    def test_partial_when_both_end_window_signals(self) -> None:
        # Pad early noise so terminal phrases sit in last 20% by length.
        pad = "context " * 80
        texts = [
            ("user", f"Goal: finish {pad}"),
            (
                "assistant",
                "all tasks complete but still blocked and underfunded; "
                "waiting for secrets not set before goal met fully",
            ),
        ]
        result = classify_goal_outcome(texts)
        self.assertEqual(result["status"], "partial")
        self.assertGreater(result["incomplete_hits"], 0)
        self.assertGreater(result["success_hits"], 0)

    def test_end_window_prefers_terminal_status(self) -> None:
        # Early success noise, terminal incomplete → not_reached.
        early = "all tasks complete. goal achieved. " * 5
        late = "Blocked: GAS_STARVED and secrets not set; failed to settle."
        pad = "x" * max(0, 5 * len(late))  # push late into end window
        texts = [
            ("assistant", early + pad),
            ("assistant", late),
        ]
        result = classify_goal_outcome(texts)
        self.assertEqual(result["status"], "not_reached")
        self.assertGreater(result["incomplete_hits"], 0)


class TestClassifyFixtures(unittest.TestCase):
    def test_goal_not_reached_fixture(self) -> None:
        self.assertTrue(NOT_REACHED.is_file(), f"missing {NOT_REACHED}")
        result = classify_goal_outcome(_load(NOT_REACHED))
        self.assertEqual(result["status"], "not_reached")
        self.assertGreater(result["incomplete_hits"], 0)
        self.assertGreaterEqual(result["confidence"], 0.0)
        self.assertLessEqual(result["confidence"], 1.0)
        self.assertGreaterEqual(len(result["blockers"]), 1)
        self.assertGreaterEqual(len(result["goal_candidates"]), 1)

    def test_goal_reached_fixture(self) -> None:
        self.assertTrue(REACHED.is_file(), f"missing {REACHED}")
        result = classify_goal_outcome(_load(REACHED))
        self.assertEqual(result["status"], "reached")
        self.assertGreater(result["success_hits"], 0)
        self.assertGreaterEqual(result["confidence"], 0.0)
        self.assertLessEqual(result["confidence"], 1.0)
        # Synthetic private_key in assistant must not appear in candidates
        for cand in result["goal_candidates"]:
            self.assertNotRegex(cand, r"0x[0-9a-fA-F]{64}\b")

    def test_goal_ambient_fixture(self) -> None:
        self.assertTrue(AMBIENT.is_file(), f"missing {AMBIENT}")
        result = classify_goal_outcome(_load(AMBIENT))
        self.assertEqual(result["status"], "ambient")
        self.assertEqual(result["incomplete_hits"], 0)
        self.assertEqual(result["success_hits"], 0)


if __name__ == "__main__":
    unittest.main()
