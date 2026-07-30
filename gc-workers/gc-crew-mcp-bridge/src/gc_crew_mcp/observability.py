"""Optional Logfire observability for gc-crew-mcp.

Package works with zero third-party deps: if ``logfire`` is not installed or
no token is configured, spans and logs are no-ops (optional stderr debug via
``GC_CREW_MCP_DEBUG=1``).

Never attach secret-like attributes (proof / key / token / secret / password)
to spans or structured log events.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

# Substrings (case-insensitive) that mark an attribute key as secret-like.
_SECRET_KEY_PARTS: frozenset[str] = frozenset(
    ("proof", "key", "token", "secret", "password")
)

_logfire: Any | None = None
_configured: bool = False
_active: bool = False  # True only when import ok and LOGFIRE_TOKEN present


def _is_secret_key(name: str) -> bool:
    lower = name.lower()
    return any(part in lower for part in _SECRET_KEY_PARTS)


def sanitize_attrs(attrs: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of *attrs* with secret-like keys stripped."""
    return {k: v for k, v in attrs.items() if not _is_secret_key(k)}


def _debug_enabled() -> bool:
    return os.environ.get("GC_CREW_MCP_DEBUG", "").strip() == "1"


def _debug_print(level: str, msg: str, attrs: dict[str, Any]) -> None:
    if not _debug_enabled():
        return
    extra = f" {attrs}" if attrs else ""
    print(f"[gc-crew-mcp {level}] {msg}{extra}", file=sys.stderr)


def configure_observability(
    *,
    service_name: str = "gc-crew-mcp",
    send_to_logfire: bool | None = None,
) -> bool:
    """Configure optional Logfire once.

    Returns:
        True only when Logfire is importable **and** ``LOGFIRE_TOKEN`` is set
        (real remote observability). Otherwise False (no-op or local-only).

    Idempotent: subsequent calls return the same active flag without
    re-invoking ``logfire.configure``.
    """
    global _logfire, _configured, _active

    if _configured:
        return _active

    try:
        import logfire as lf
    except ImportError:
        _logfire = None
        _configured = True
        _active = False
        return False

    token = (os.environ.get("LOGFIRE_TOKEN") or "").strip()
    has_token = bool(token)

    # Decide whether to send to Logfire cloud.
    if send_to_logfire is None:
        want_send = has_token
    else:
        want_send = send_to_logfire

    # No token and not forced: prefer local configure(send_to_logfire=False)
    # so spans still work offline; fall back to pure no-op if that fails.
    if not has_token and send_to_logfire is not True:
        try:
            lf.configure(service_name=service_name, send_to_logfire=False)
            _logfire = lf
        except TypeError:
            try:
                lf.configure(service_name=service_name)
                _logfire = lf
            except Exception:
                _logfire = None
        except Exception:
            _logfire = None
        _configured = True
        _active = False
        return False

    try:
        kwargs: dict[str, Any] = {"service_name": service_name}
        # Prefer explicit send flag when the API accepts it.
        try:
            lf.configure(**kwargs, send_to_logfire=want_send)
        except TypeError:
            lf.configure(**kwargs)
        _logfire = lf
        _active = has_token
    except Exception:
        _logfire = None
        _active = False

    _configured = True
    return _active


def reset_observability_for_tests() -> None:
    """Reset module guards — for unit tests only."""
    global _logfire, _configured, _active
    _logfire = None
    _configured = False
    _active = False


@contextmanager
def span(name: str, **attrs: Any) -> Iterator[None]:
    """Open a Logfire span if available; otherwise a no-op context manager.

    Secret-like attribute keys are stripped before being attached.
    """
    cleaned = sanitize_attrs(attrs)
    if _logfire is not None:
        with _logfire.span(name, **cleaned):
            yield
    else:
        yield


def info(msg: str, **attrs: Any) -> None:
    """Structured info log if Logfire is available; else optional stderr debug."""
    cleaned = sanitize_attrs(attrs)
    if _logfire is not None:
        try:
            _logfire.info(msg, **cleaned)
            return
        except Exception:
            pass
    _debug_print("info", msg, cleaned)


def error(msg: str, **attrs: Any) -> None:
    """Structured error log if Logfire is available; else optional stderr debug."""
    cleaned = sanitize_attrs(attrs)
    if _logfire is not None:
        try:
            _logfire.error(msg, **cleaned)
            return
        except Exception:
            pass
    _debug_print("error", msg, cleaned)
