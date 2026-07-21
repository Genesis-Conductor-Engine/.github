"""Tests for labels and mine_session report model (stdlib unittest)."""

from __future__ import annotations

import unittest
from pathlib import Path

from claude_mine.labels import label_address
from claude_mine.mine import mine_session

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_session.jsonl"

# Synthetic known addresses from Global Constraints (public ops labels).
TREASURY = "0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75"
HOT = "0x60C4499870f115664d7FfD8411b023DBEf3377d9"
SAFE = "0x2AD5480D9E24Be1973019B61DAB4bbAB2f6930eB"
METAMASK = "0x9545e2439c5c75d3aA723AcaC1AA6B0fa1DB6956"
LEGACY = "0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8"
UNKNOWN_ADDR = "0x1111111111111111111111111111111111111111"

REPORT_KEYS = {
    "session_id",
    "path",
    "line_count",
    "addresses",
    "phrases",
    "top_user_snippets",
    "first_ts",
    "last_ts",
}


class TestLabelAddress(unittest.TestCase):
    def test_known_labels(self) -> None:
        cases = [
            (TREASURY, "TREASURY_UNSIGNED"),
            (HOT, "HOT_X402"),
            (SAFE, "SAFE_2OF3"),
            (METAMASK, "METAMASK1_FEE_SINK"),
            (LEGACY, "LEGACY_TREASURY_PANEL"),
        ]
        for addr, expected in cases:
            with self.subTest(addr=addr, label=expected):
                self.assertEqual(label_address(addr), expected)
                # Checksum-insensitive
                self.assertEqual(label_address(addr.lower()), expected)
                self.assertEqual(label_address(addr.upper()), expected)

    def test_unknown_returns_unknown(self) -> None:
        self.assertEqual(label_address(UNKNOWN_ADDR), "UNKNOWN")
        self.assertEqual(label_address(UNKNOWN_ADDR.lower()), "UNKNOWN")


class TestMineSession(unittest.TestCase):
    def test_report_keys_and_types(self) -> None:
        self.assertTrue(FIXTURE.is_file(), f"missing fixture {FIXTURE}")
        report = mine_session(FIXTURE)

        self.assertIsInstance(report, dict)
        self.assertEqual(set(report.keys()), REPORT_KEYS)

        self.assertIsInstance(report["session_id"], str)
        self.assertTrue(report["session_id"])
        self.assertIsInstance(report["path"], str)
        self.assertIsInstance(report["line_count"], int)
        self.assertGreaterEqual(report["line_count"], 1)
        self.assertIsInstance(report["addresses"], list)
        self.assertIsInstance(report["phrases"], dict)
        self.assertIsInstance(report["top_user_snippets"], list)
        self.assertLessEqual(len(report["top_user_snippets"]), 20)
        # Timestamps present on fixture lines
        self.assertIsNotNone(report["first_ts"])
        self.assertIsNotNone(report["last_ts"])
        self.assertLessEqual(str(report["first_ts"]), str(report["last_ts"]))

    def test_addresses_shape_and_treasury_label(self) -> None:
        report = mine_session(FIXTURE)
        addrs = report["addresses"]
        self.assertGreaterEqual(len(addrs), 1)

        for item in addrs:
            self.assertIsInstance(item, dict)
            self.assertEqual(set(item.keys()), {"address", "count", "label"})
            self.assertIsInstance(item["address"], str)
            self.assertTrue(item["address"].startswith("0x"))
            self.assertEqual(item["address"], item["address"].lower())
            self.assertIsInstance(item["count"], int)
            self.assertGreaterEqual(item["count"], 1)
            self.assertIsInstance(item["label"], str)

        by_addr = {a["address"]: a for a in addrs}
        treasury_key = TREASURY.lower()
        self.assertIn(treasury_key, by_addr, "treasury address missing from mine report")
        self.assertEqual(by_addr[treasury_key]["label"], "TREASURY_UNSIGNED")

        # Fixture also includes HOT and SAFE
        self.assertIn(HOT.lower(), by_addr)
        self.assertEqual(by_addr[HOT.lower()]["label"], "HOT_X402")
        self.assertIn(SAFE.lower(), by_addr)
        self.assertEqual(by_addr[SAFE.lower()]["label"], "SAFE_2OF3")

    def test_phrases_and_redacted_user_snippets(self) -> None:
        report = mine_session(FIXTURE)
        phrases = report["phrases"]
        self.assertGreaterEqual(phrases.get("treasury", 0), 1)
        self.assertGreaterEqual(phrases.get("fund-agent-gas", 0), 1)
        self.assertGreaterEqual(phrases.get("wallet_registry", 0), 1)

        snippets = report["top_user_snippets"]
        self.assertGreaterEqual(len(snippets), 1)
        for s in snippets:
            self.assertIsInstance(s, str)
            # No raw 0x+64-hex private-key material
            self.assertNotRegex(s, r"0x[0-9a-fA-F]{64}\b")

        # Fixture assistant line has private_key=0xaaa…; user snippets must be redacted
        joined = "\n".join(snippets)
        self.assertNotIn("a" * 64, joined.lower())

    def test_session_id_from_fixture(self) -> None:
        report = mine_session(FIXTURE)
        self.assertEqual(
            report["session_id"],
            "00000000-0000-0000-0000-000000000001",
        )


if __name__ == "__main__":
    unittest.main()
