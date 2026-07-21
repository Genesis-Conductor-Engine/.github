"""Tests for redact, extract, and session parser (stdlib unittest)."""

from __future__ import annotations

import unittest
from pathlib import Path

from claude_mine.extract import extract_addresses, extract_phrase_hits
from claude_mine.parser import iter_session_texts
from claude_mine.redact import redact_text

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_session.jsonl"

# Synthetic only — not a real key (all-a pattern for redaction tests).
FAKE_LONG = "0x" + ("a" * 64)
FAKE_ADDR_A = "0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75"
FAKE_ADDR_B = "0x60c4499870f115664d7ffd8411b023dbef3377d9"  # mixed case of known HOT


class TestRedactText(unittest.TestCase):
    def test_strips_0x_plus_64_hex(self) -> None:
        text = f"secret material {FAKE_LONG} in the middle"
        out = redact_text(text)
        self.assertNotIn(FAKE_LONG, out)
        self.assertNotIn("a" * 64, out.lower())
        # Allowed placeholders from global constraints
        self.assertTrue(
            "0xLONG" in out or "REDACTED" in out,
            f"expected redaction placeholder, got: {out!r}",
        )

    def test_strips_key_like_assignments(self) -> None:
        samples = [
            "private_key=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "PRIVATE_KEY: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            "mnemonic = abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            'api_key="sk-test-not-real-abcdefghijklmnopqrstuvwxyz"',
            "secret: supersecretvalue123",
        ]
        for sample in samples:
            with self.subTest(sample=sample[:40]):
                out = redact_text(sample)
                self.assertNotIn("bbbbbbbb", out)
                self.assertNotIn("deadbeef", out)
                self.assertNotIn("abandon abandon", out)
                self.assertNotIn("sk-test-not-real", out)
                self.assertNotIn("supersecretvalue123", out)
                self.assertIn("REDACTED", out)

    def test_preserves_normal_addresses(self) -> None:
        """40-hex addresses are not private keys; leave them for extract."""
        text = f"send to {FAKE_ADDR_A}"
        out = redact_text(text)
        self.assertIn("54e2acab04c89a3fe02852bf8dd69ee8f526bc75", out.lower())


class TestExtractAddresses(unittest.TestCase):
    def test_finds_unique_checksum_agnostic(self) -> None:
        text = (
            f"A={FAKE_ADDR_A} again={FAKE_ADDR_A.lower()} "
            f"B={FAKE_ADDR_B} also={FAKE_ADDR_B.upper()}"
        )
        addrs = extract_addresses(text)
        # Unique, checksum-agnostic (normalized lowercase with 0x)
        normalized = {a.lower() for a in addrs}
        self.assertEqual(len(addrs), len(normalized), "duplicates not collapsed")
        self.assertEqual(len(normalized), 2)
        self.assertIn(FAKE_ADDR_A.lower(), normalized)
        self.assertIn(FAKE_ADDR_B.lower(), normalized)

    def test_ignores_64_hex_private_key_shapes(self) -> None:
        text = f"pk {FAKE_LONG} addr {FAKE_ADDR_A}"
        addrs = extract_addresses(text)
        normalized = {a.lower() for a in addrs}
        self.assertEqual(normalized, {FAKE_ADDR_A.lower()})
        self.assertTrue(all(len(a) == 42 for a in addrs))


class TestExtractPhraseHits(unittest.TestCase):
    def test_counts_phrase_keywords_case_insensitive(self) -> None:
        text = (
            "Treasury and TREASURY again. fund-agent-gas once. "
            "gas_starved gas_starved. metamask. Safe n1. 0x54e2 prefix. "
            "wallet_registry snipebot TREASURY_PRIVATE"
        )
        hits = extract_phrase_hits(text)
        self.assertIsInstance(hits, dict)
        # Required phrases from Global Constraints
        required = [
            "treasury",
            "fund-agent-gas",
            "TREASURY_PRIVATE",
            "snipebot",
            "wallet_registry",
            "gas_starved",
            "0x54e2",
            "safe n1",
            "metamask",
        ]
        for phrase in required:
            self.assertIn(phrase, hits, f"missing phrase key {phrase!r}")
        self.assertGreaterEqual(hits["treasury"], 2)
        self.assertEqual(hits["fund-agent-gas"], 1)
        self.assertEqual(hits["gas_starved"], 2)
        self.assertGreaterEqual(hits["metamask"], 1)
        self.assertGreaterEqual(hits["safe n1"], 1)
        self.assertGreaterEqual(hits["0x54e2"], 1)
        self.assertGreaterEqual(hits["TREASURY_PRIVATE"], 1)
        self.assertGreaterEqual(hits["snipebot"], 1)
        self.assertGreaterEqual(hits["wallet_registry"], 1)

    def test_zero_when_absent(self) -> None:
        hits = extract_phrase_hits("hello world nothing special")
        self.assertEqual(hits.get("treasury", 0), 0)
        self.assertEqual(hits.get("snipebot", 0), 0)


class TestIterSessionTexts(unittest.TestCase):
    def test_yields_user_assistant_tool_result(self) -> None:
        self.assertTrue(FIXTURE.is_file(), f"missing fixture {FIXTURE}")
        rows = list(iter_session_texts(FIXTURE))
        self.assertGreaterEqual(len(rows), 3)

        roles = [r for r, _ in rows]
        texts = [t for _, t in rows]

        self.assertIn("user", roles)
        self.assertIn("assistant", roles)
        # tool_result may be tagged as tool_result or user depending on impl;
        # content must appear either way.
        joined = "\n".join(texts)
        self.assertIn("fund-agent-gas", joined)
        self.assertIn("Reviewing SAFE_2OF3", joined)
        self.assertIn("wallet_registry ok", joined)

        # Explicit role+text pairs for the three required sources
        user_texts = [t for r, t in rows if r == "user"]
        assistant_texts = [t for r, t in rows if r == "assistant"]
        tool_texts = [t for r, t in rows if r in ("tool_result", "user")]

        self.assertTrue(
            any("0x54E2ACaB" in t or "0x54e2acab" in t.lower() for t in user_texts),
            "user text with address missing",
        )
        self.assertTrue(
            any("SAFE_2OF3" in t or "metamask" in t.lower() for t in assistant_texts),
            "assistant text missing",
        )
        self.assertTrue(
            any("wallet_registry" in t for t in tool_texts),
            "tool_result string content missing",
        )

    def test_skips_non_message_lines(self) -> None:
        rows = list(iter_session_texts(FIXTURE))
        # system/thinking/tool_use-only lines should not yield empty noise
        for role, text in rows:
            self.assertTrue(role)
            self.assertTrue(text.strip())


if __name__ == "__main__":
    unittest.main()
