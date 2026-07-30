"""Unit tests for gc_crew_mcp.observability (no hard logfire dep)."""

from __future__ import annotations

import sys
import unittest
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

from gc_crew_mcp.observability import (
    configure_observability,
    error,
    info,
    reset_observability_for_tests,
    sanitize_attrs,
    span,
)


class TestSanitizeAttrs(unittest.TestCase):
    def test_strips_secret_like_keys(self) -> None:
        cleaned = sanitize_attrs(
            {
                "base_host": "example.com",
                "payment_proof": "SECRET",
                "admin_key": "K",
                "api_token": "T",
                "X_SECRET": "S",
                "user_password": "P",
                "goal_status": "partial",
                "candidate_id": "c-1",
            }
        )
        self.assertEqual(
            cleaned,
            {
                "base_host": "example.com",
                "goal_status": "partial",
                "candidate_id": "c-1",
            },
        )
        self.assertNotIn("payment_proof", cleaned)
        self.assertNotIn("admin_key", cleaned)
        self.assertNotIn("api_token", cleaned)
        self.assertNotIn("X_SECRET", cleaned)
        self.assertNotIn("user_password", cleaned)

    def test_case_insensitive_substring(self) -> None:
        cleaned = sanitize_attrs(
            {
                "PaymentProof": "x",
                "MyTOKENValue": "y",
                "safe": 1,
            }
        )
        self.assertEqual(cleaned, {"safe": 1})


class TestNoOpPath(unittest.TestCase):
    def setUp(self) -> None:
        reset_observability_for_tests()

    def tearDown(self) -> None:
        reset_observability_for_tests()

    def test_span_noop_without_logfire(self) -> None:
        # Ensure logfire is treated as missing.
        with patch.dict(sys.modules, {"logfire": None}):
            # Force ImportError path by making import fail via side effect.
            real_import = __import__

            def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
                if name == "logfire":
                    raise ImportError("no logfire")
                return real_import(name, *args, **kwargs)

            with patch("builtins.__import__", side_effect=fake_import):
                reset_observability_for_tests()
                active = configure_observability()
                self.assertFalse(active)
                ran = False
                with span("test.span", payment_proof="NOPE", ok=True):
                    ran = True
                self.assertTrue(ran)
                # Second configure is idempotent.
                self.assertFalse(configure_observability())
                self.assertFalse(configure_observability(service_name="other"))

    def test_info_error_noop_without_logfire(self) -> None:
        real_import = __import__

        def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
            if name == "logfire":
                raise ImportError("no logfire")
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=fake_import):
            reset_observability_for_tests()
            configure_observability()
            # Must not raise.
            info("hello", payment_proof="SECRET", base_host="h")
            error("boom", admin_key="K", code=1)


class TestConfigureIdempotent(unittest.TestCase):
    def setUp(self) -> None:
        reset_observability_for_tests()

    def tearDown(self) -> None:
        reset_observability_for_tests()

    def test_configure_once_with_fake_logfire(self) -> None:
        configure_calls: list[dict[str, Any]] = []

        fake = MagicMock()

        def configure(**kwargs: Any) -> None:
            configure_calls.append(kwargs)

        fake.configure = configure

        @contextmanager
        def fake_span(name: str, **attrs: Any) -> Any:
            yield attrs

        fake.span = fake_span
        fake.info = MagicMock()
        fake.error = MagicMock()

        with patch.dict(sys.modules, {"logfire": fake}):
            with patch.dict("os.environ", {}, clear=False):
                # Ensure no token for offline path.
                env = {k: v for k, v in __import__("os").environ.items()}
                env.pop("LOGFIRE_TOKEN", None)
                with patch.dict("os.environ", env, clear=True):
                    reset_observability_for_tests()
                    # Re-inject fake after reset path uses import
                    # configure imports logfire from sys.modules via import statement
                    self.assertFalse(configure_observability(service_name="gc-crew-mcp"))
                    self.assertEqual(len(configure_calls), 1)
                    self.assertIn("send_to_logfire", configure_calls[0])
                    self.assertFalse(configure_calls[0]["send_to_logfire"])
                    # Idempotent — no second configure.
                    self.assertFalse(configure_observability())
                    self.assertEqual(len(configure_calls), 1)

    def test_active_true_with_token(self) -> None:
        configure_calls: list[dict[str, Any]] = []
        fake = MagicMock()

        def configure(**kwargs: Any) -> None:
            configure_calls.append(kwargs)

        fake.configure = configure

        with patch.dict(sys.modules, {"logfire": fake}):
            with patch.dict("os.environ", {"LOGFIRE_TOKEN": "test-token"}, clear=False):
                reset_observability_for_tests()
                self.assertTrue(configure_observability())
                self.assertEqual(len(configure_calls), 1)
                self.assertTrue(configure_observability())
                self.assertEqual(len(configure_calls), 1)


class TestSpanRedactionWithFakeLogfire(unittest.TestCase):
    def setUp(self) -> None:
        reset_observability_for_tests()

    def tearDown(self) -> None:
        reset_observability_for_tests()

    def test_span_strips_secrets(self) -> None:
        import gc_crew_mcp.observability as obs

        captured: list[tuple[str, dict[str, Any]]] = []

        class FakeLf:
            @contextmanager
            def span(self, name: str, **attrs: Any) -> Any:
                captured.append((name, dict(attrs)))
                yield

            def configure(self, **kwargs: Any) -> None:
                return None

            def info(self, msg: str, **attrs: Any) -> None:
                return None

            def error(self, msg: str, **attrs: Any) -> None:
                return None

        # Bypass configure; inject module directly as available.
        obs._logfire = FakeLf()  # type: ignore[attr-defined]
        obs._configured = True  # type: ignore[attr-defined]
        obs._active = False  # type: ignore[attr-defined]

        with span(
            "evolve.submit_metrics",
            base_host="optimization-inversion.genesisconductor.io",
            goal_status="partial",
            candidate_id="c-1",
            payment_proof="PROOF",
            admin_key="KEY",
            api_token="TOK",
        ):
            pass

        self.assertEqual(len(captured), 1)
        name, attrs = captured[0]
        self.assertEqual(name, "evolve.submit_metrics")
        self.assertEqual(attrs["base_host"], "optimization-inversion.genesisconductor.io")
        self.assertEqual(attrs["goal_status"], "partial")
        self.assertEqual(attrs["candidate_id"], "c-1")
        self.assertNotIn("payment_proof", attrs)
        self.assertNotIn("admin_key", attrs)
        self.assertNotIn("api_token", attrs)

    def test_info_error_redact(self) -> None:
        import gc_crew_mcp.observability as obs

        info_calls: list[tuple[str, dict[str, Any]]] = []
        error_calls: list[tuple[str, dict[str, Any]]] = []

        class FakeLf:
            def info(self, msg: str, **attrs: Any) -> None:
                info_calls.append((msg, dict(attrs)))

            def error(self, msg: str, **attrs: Any) -> None:
                error_calls.append((msg, dict(attrs)))

            def configure(self, **kwargs: Any) -> None:
                return None

            @contextmanager
            def span(self, name: str, **attrs: Any) -> Any:
                yield

        obs._logfire = FakeLf()  # type: ignore[attr-defined]
        obs._configured = True  # type: ignore[attr-defined]
        obs._active = True  # type: ignore[attr-defined]

        info("ok", payment_proof="P", host="h")
        error("bad", admin_key="K", code=42)

        self.assertEqual(info_calls[0][0], "ok")
        self.assertEqual(info_calls[0][1], {"host": "h"})
        self.assertEqual(error_calls[0][0], "bad")
        self.assertEqual(error_calls[0][1], {"code": 42})


class TestEvolveHookSpanWiring(unittest.TestCase):
    """submit_metrics body is wrapped; secrets never reach span attrs."""

    def setUp(self) -> None:
        reset_observability_for_tests()

    def tearDown(self) -> None:
        reset_observability_for_tests()

    def test_submit_metrics_uses_safe_span_attrs(self) -> None:
        import gc_crew_mcp.observability as obs
        from gc_crew_mcp.evolve_hook import submit_metrics
        from gc_crew_mcp.metrics import RunMetrics

        captured: list[tuple[str, dict[str, Any]]] = []

        class FakeLf:
            @contextmanager
            def span(self, name: str, **attrs: Any) -> Any:
                captured.append((name, dict(attrs)))
                yield

            def configure(self, **kwargs: Any) -> None:
                return None

            def info(self, msg: str, **attrs: Any) -> None:
                return None

            def error(self, msg: str, **attrs: Any) -> None:
                return None

        obs._logfire = FakeLf()  # type: ignore[attr-defined]
        obs._configured = True  # type: ignore[attr-defined]
        obs._active = False  # type: ignore[attr-defined]

        def transport(
            method: str,
            url: str,
            headers: dict[str, str],
            body: dict,
        ) -> tuple[int, dict]:
            return 200, {"ok": True}

        result = submit_metrics(
            "https://optimization-inversion.genesisconductor.io",
            RunMetrics(
                quality=0.5,
                latency_ms=10.0,
                cost_usdc6=0,
                goal_status="ambient",
                candidate_id="cand-9",
            ),
            payment_proof="PROOF_SECRET",
            admin_key="ADMIN_SECRET",
            transport=transport,
        )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(captured), 1)
        name, attrs = captured[0]
        self.assertEqual(name, "evolve.submit_metrics")
        self.assertEqual(attrs.get("base_host"), "optimization-inversion.genesisconductor.io")
        self.assertEqual(attrs.get("goal_status"), "ambient")
        self.assertEqual(attrs.get("candidate_id"), "cand-9")
        # No secret keys and no secret values in span attrs.
        for k, v in attrs.items():
            self.assertNotIn("proof", k.lower())
            self.assertNotIn("key", k.lower())
            self.assertNotIn("token", k.lower())
            self.assertNotEqual(v, "PROOF_SECRET")
            self.assertNotEqual(v, "ADMIN_SECRET")
        blob = str(attrs)
        self.assertNotIn("PROOF_SECRET", blob)
        self.assertNotIn("ADMIN_SECRET", blob)


if __name__ == "__main__":
    unittest.main()
