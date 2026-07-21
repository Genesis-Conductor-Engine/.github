"""Tests for goals CLI (session + scan, incomplete filter, exit codes)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures"
NOT_REACHED = FIXTURES / "goal_not_reached.jsonl"
REACHED = FIXTURES / "goal_reached.jsonl"
AMBIENT = FIXTURES / "goal_ambient.jsonl"
PKG_ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable

GOAL_REPORT_KEYS = {
    "session_id",
    "path",
    "line_count",
    "first_ts",
    "last_ts",
    "status",
    "confidence",
    "incomplete_hits",
    "success_hits",
    "blockers",
    "goal_candidates",
}

# UUID filenames required by discover_sessions.
UUID_NR = "10000000-0000-0000-0000-000000000001.jsonl"
UUID_OK = "20000000-0000-0000-0000-000000000002.jsonl"
UUID_AMB = "30000000-0000-0000-0000-000000000003.jsonl"


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    full_env = os.environ.copy()
    full_env["PYTHONPATH"] = str(PKG_ROOT) + (
        os.pathsep + full_env["PYTHONPATH"] if full_env.get("PYTHONPATH") else ""
    )
    return subprocess.run(
        [PYTHON, "-m", "claude_mine", *args],
        cwd=str(PKG_ROOT),
        capture_output=True,
        text=True,
        env=full_env,
    )


class TestGoalsSessionCli(unittest.TestCase):
    def test_goals_session_writes_json_and_md(self) -> None:
        self.assertTrue(NOT_REACHED.is_file(), f"missing {NOT_REACHED}")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            proc = _run_cli("goals", "session", str(NOT_REACHED), "--out", str(out))
            self.assertEqual(proc.returncode, 0, msg=proc.stderr + proc.stdout)

            json_files = [p for p in out.glob("*.json")]
            md_files = [p for p in out.glob("*.md")]
            self.assertEqual(len(json_files), 1)
            self.assertEqual(len(md_files), 1)

            loaded = json.loads(json_files[0].read_text(encoding="utf-8"))
            self.assertEqual(set(loaded.keys()), GOAL_REPORT_KEYS)
            self.assertEqual(loaded["status"], "not_reached")
            self.assertGreater(loaded["incomplete_hits"], 0)
            self.assertIsInstance(loaded["blockers"], list)
            self.assertGreaterEqual(len(loaded["blockers"]), 1)
            self.assertIsInstance(loaded["goal_candidates"], list)

            md = md_files[0].read_text(encoding="utf-8")
            self.assertIn("not_reached", md)
            self.assertIn("Blockers", md)
            # No raw private-key material
            self.assertNotRegex(md, r"0x[0-9a-fA-F]{64}\b")
            self.assertNotRegex(
                json_files[0].read_text(encoding="utf-8"),
                r"0x[0-9a-fA-F]{64}\b",
            )

            self.assertIn("status=not_reached", proc.stdout)

    def test_goals_session_reached_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            proc = _run_cli("goals", "session", str(REACHED), "--out", str(out))
            self.assertEqual(proc.returncode, 0, msg=proc.stderr + proc.stdout)
            loaded = json.loads(next(out.glob("*.json")).read_text(encoding="utf-8"))
            self.assertEqual(loaded["status"], "reached")
            blob = next(out.glob("*.json")).read_text(encoding="utf-8")
            self.assertNotRegex(blob, r"0x[0-9a-fA-F]{64}\b")

    def test_goals_session_missing_path_exit_2(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "no-such-session.jsonl"
            out = Path(tmp) / "out"
            proc = _run_cli("goals", "session", str(missing), "--out", str(out))
            self.assertEqual(proc.returncode, 2, msg=proc.stderr + proc.stdout)


class TestGoalsScanCli(unittest.TestCase):
    def _seed_project(self, root: Path) -> None:
        project = root / "-Users-test-goals"
        project.mkdir(parents=True)
        shutil.copy(NOT_REACHED, project / UUID_NR)
        shutil.copy(REACHED, project / UUID_OK)
        shutil.copy(AMBIENT, project / UUID_AMB)
        # Nested subagent noise
        sub = project / "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" / "subagents"
        sub.mkdir(parents=True)
        (sub / "agent-deadbeef.jsonl").write_text('{"type":"system"}\n', encoding="utf-8")

    def test_scan_default_indexes_incomplete_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "projects"
            self._seed_project(root)
            out = Path(tmp) / "out"
            proc = _run_cli("goals", "scan", "--root", str(root), "--out", str(out))
            self.assertEqual(proc.returncode, 0, msg=proc.stderr + proc.stdout)

            index_path = out / "index.json"
            self.assertTrue(index_path.is_file())
            index = json.loads(index_path.read_text(encoding="utf-8"))
            self.assertEqual(index["filter"], "incomplete")
            self.assertEqual(index["classified"], 3)
            sessions = index["sessions"]
            self.assertEqual(len(sessions), 1, "default should index only not_reached/partial")
            self.assertEqual(sessions[0]["status"], "not_reached")
            self.assertIn("blockers", sessions[0])

            # Per-session reports: only incomplete written
            reports = [
                json.loads(p.read_text(encoding="utf-8"))
                for p in out.glob("*.json")
                if p.name != "index.json"
            ]
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0]["status"], "not_reached")
            self.assertTrue(any(out.glob("*.md")))

            self.assertIn("skip", proc.stdout.lower())

    def test_scan_all_includes_every_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "projects"
            self._seed_project(root)
            out = Path(tmp) / "out"
            proc = _run_cli(
                "goals", "scan", "--root", str(root), "--out", str(out), "--all"
            )
            self.assertEqual(proc.returncode, 0, msg=proc.stderr + proc.stdout)

            index = json.loads((out / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["filter"], "all")
            self.assertEqual(index["classified"], 3)
            statuses = {s["status"] for s in index["sessions"]}
            self.assertEqual(statuses, {"not_reached", "reached", "ambient"})
            self.assertEqual(len(index["sessions"]), 3)

            reports = [
                p for p in out.glob("*.json") if p.name != "index.json"
            ]
            self.assertEqual(len(reports), 3)

    def test_scan_no_sessions_exit_2(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "empty-projects"
            root.mkdir()
            out = Path(tmp) / "out"
            proc = _run_cli("goals", "scan", "--root", str(root), "--out", str(out))
            self.assertEqual(proc.returncode, 2, msg=proc.stderr + proc.stdout)

    def test_scan_missing_root_exit_2(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "no-such-root"
            out = Path(tmp) / "out"
            proc = _run_cli("goals", "scan", "--root", str(missing), "--out", str(out))
            self.assertEqual(proc.returncode, 2, msg=proc.stderr + proc.stdout)


class TestClassifySessionGoal(unittest.TestCase):
    def test_classify_session_goal_shape(self) -> None:
        from claude_mine.cli import classify_session_goal

        report = classify_session_goal(NOT_REACHED)
        self.assertEqual(set(report.keys()), GOAL_REPORT_KEYS)
        self.assertEqual(report["status"], "not_reached")
        self.assertEqual(report["session_id"], "10000000-0000-0000-0000-000000000001")


if __name__ == "__main__":
    unittest.main()
