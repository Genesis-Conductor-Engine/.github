"""Tests for report writers and CLI (stdlib unittest, temp dirs + fixture)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from claude_mine.mine import mine_session
from claude_mine.report import write_json, write_markdown

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_session.jsonl"
PKG_ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable

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

# Synthetic UUID for discovery tests.
UUID_NAME = "11111111-1111-1111-1111-111111111111.jsonl"


def _run_cli(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    full_env = os.environ.copy()
    full_env["PYTHONPATH"] = str(PKG_ROOT) + (
        os.pathsep + full_env["PYTHONPATH"] if full_env.get("PYTHONPATH") else ""
    )
    if env:
        full_env.update(env)
    return subprocess.run(
        [PYTHON, "-m", "claude_mine", *args],
        cwd=str(PKG_ROOT),
        capture_output=True,
        text=True,
        env=full_env,
    )


class TestWriteJson(unittest.TestCase):
    def test_writes_report_schema_keys(self) -> None:
        self.assertTrue(FIXTURE.is_file(), f"missing fixture {FIXTURE}")
        report = mine_session(FIXTURE)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "report.json"
            write_json(report, out)
            self.assertTrue(out.is_file())
            loaded = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(set(loaded.keys()), REPORT_KEYS)
            self.assertEqual(loaded["session_id"], report["session_id"])
            self.assertIsInstance(loaded["addresses"], list)
            self.assertIsInstance(loaded["phrases"], dict)
            # No raw 0x+64hex private-key material in serialized report
            blob = out.read_text(encoding="utf-8")
            self.assertNotRegex(blob, r"0x[0-9a-fA-F]{64}\b")


class TestWriteMarkdown(unittest.TestCase):
    def test_includes_table_phrases_snippets_path(self) -> None:
        report = mine_session(FIXTURE)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "report.md"
            write_markdown(report, out)
            self.assertTrue(out.is_file())
            text = out.read_text(encoding="utf-8")

            # Source path
            self.assertIn(report["path"], text)
            self.assertIn(report["session_id"], text)

            # Address table / labels
            self.assertIn("TREASURY_UNSIGNED", text)
            self.assertIn("address", text.lower())
            self.assertIn("label", text.lower())

            # Phrase hits
            self.assertIn("treasury", text.lower())
            self.assertIn("fund-agent-gas", text.lower())

            # Redacted snippets section
            self.assertTrue(
                "snippet" in text.lower() or "user" in text.lower(),
                "expected snippets section",
            )
            self.assertNotRegex(text, r"0x[0-9a-fA-F]{64}\b")
            self.assertNotIn("a" * 64, text.lower())


class TestCliSession(unittest.TestCase):
    def test_session_writes_json_and_md(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            proc = _run_cli("session", str(FIXTURE), "--out", str(out))
            self.assertEqual(proc.returncode, 0, msg=proc.stderr + proc.stdout)

            json_files = list(out.glob("*.json"))
            md_files = list(out.glob("*.md"))
            self.assertGreaterEqual(len(json_files), 1, "expected at least one .json report")
            self.assertGreaterEqual(len(md_files), 1, "expected at least one .md report")

            loaded = json.loads(json_files[0].read_text(encoding="utf-8"))
            self.assertEqual(set(loaded.keys()), REPORT_KEYS)
            self.assertEqual(loaded["session_id"], "00000000-0000-0000-0000-000000000001")

            md = md_files[0].read_text(encoding="utf-8")
            self.assertIn("TREASURY_UNSIGNED", md)
            self.assertNotRegex(md, r"0x[0-9a-fA-F]{64}\b")

    def test_session_missing_path_exit_2(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "no-such-session.jsonl"
            out = Path(tmp) / "out"
            proc = _run_cli("session", str(missing), "--out", str(out))
            self.assertEqual(proc.returncode, 2, msg=proc.stderr + proc.stdout)


class TestCliScan(unittest.TestCase):
    def test_scan_finds_uuid_session_skips_subagent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "projects"
            project = root / "-Users-test-project"
            project.mkdir(parents=True)
            # Top-level UUID session (preferred)
            session = project / UUID_NAME
            session.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
            # Nested subagent noise — should not be mined by default
            sub = project / "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" / "subagents"
            sub.mkdir(parents=True)
            (sub / "agent-deadbeef.jsonl").write_text(
                '{"type":"system"}\n', encoding="utf-8"
            )
            # Non-session jsonl at depth
            (project / "skill-injections.jsonl").write_text("{}\n", encoding="utf-8")

            out = Path(tmp) / "out"
            proc = _run_cli("scan", "--root", str(root), "--out", str(out))
            self.assertEqual(proc.returncode, 0, msg=proc.stderr + proc.stdout)

            json_files = list(out.rglob("*.json"))
            self.assertGreaterEqual(len(json_files), 1)
            # Only the UUID session should produce a mine report with addresses
            reports = []
            for jf in json_files:
                data = json.loads(jf.read_text(encoding="utf-8"))
                if isinstance(data, dict) and "session_id" in data:
                    reports.append(data)
            self.assertEqual(len(reports), 1, f"expected one session report, got {len(reports)}")
            self.assertIn("addresses", reports[0])
            # Source path should be the UUID session, not the subagent file
            self.assertIn(UUID_NAME, reports[0]["path"])
            self.assertNotIn("subagents", reports[0]["path"])

    def test_scan_no_sessions_exit_2(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "empty-projects"
            root.mkdir()
            out = Path(tmp) / "out"
            proc = _run_cli("scan", "--root", str(root), "--out", str(out))
            self.assertEqual(proc.returncode, 2, msg=proc.stderr + proc.stdout)

    def test_scan_missing_root_exit_2(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "no-such-root"
            out = Path(tmp) / "out"
            proc = _run_cli("scan", "--root", str(missing), "--out", str(out))
            self.assertEqual(proc.returncode, 2, msg=proc.stderr + proc.stdout)


class TestDiscoverSessions(unittest.TestCase):
    def test_discover_uuid_preference(self) -> None:
        from claude_mine.cli import discover_sessions

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            proj = root / "proj"
            proj.mkdir()
            uuid_path = proj / UUID_NAME
            uuid_path.write_text("{}\n", encoding="utf-8")
            other = proj / "notes.jsonl"
            other.write_text("{}\n", encoding="utf-8")
            nested = proj / "sid" / "subagents"
            nested.mkdir(parents=True)
            (nested / "agent-x.jsonl").write_text("{}\n", encoding="utf-8")

            found = discover_sessions(root)
            names = {p.name for p in found}
            self.assertIn(UUID_NAME, names)
            self.assertNotIn("agent-x.jsonl", names)
            self.assertNotIn("notes.jsonl", names)


if __name__ == "__main__":
    unittest.main()
