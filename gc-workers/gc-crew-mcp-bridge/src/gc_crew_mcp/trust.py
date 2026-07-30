"""MCP host trust policy and deny-all-then-allow tool filtering."""

from __future__ import annotations

from urllib.parse import urlparse

TRUSTED_HOSTS: frozenset[str] = frozenset(
    {
        "optimization-inversion.genesisconductor.io",
        "fed.genesisconductor.io",
        "localhost",
        "127.0.0.1",
    }
)

DEFAULT_BLOCKED_TOOLS: frozenset[str] = frozenset(
    {
        "delete",
        "deploy",
        "secret_put",
        "write_file",
        "rm",
        "drop_table",
    }
)

_GENESIS_SUFFIX = ".genesisconductor.io"
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})


def _host_is_trusted(hostname: str) -> bool:
    host = hostname.lower().rstrip(".")
    if host in TRUSTED_HOSTS:
        return True
    if host.endswith(_GENESIS_SUFFIX) and len(host) > len(_GENESIS_SUFFIX):
        return True
    return False


def is_trusted_url(url: str) -> bool:
    """Return True only for trusted MCP/base URLs.

    Remote trusted hosts (and ``*.genesisconductor.io``) require ``https://``.
    ``localhost`` / ``127.0.0.1`` are trusted only over ``http://`` (tests).
    """
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url)
    except Exception:
        return False

    scheme = (parsed.scheme or "").lower()
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return False

    if scheme == "https":
        # Remote only: do not treat bare local hosts as production MCP over https.
        if hostname in _LOCAL_HOSTS:
            return False
        return _host_is_trusted(hostname)

    if scheme == "http":
        return hostname in _LOCAL_HOSTS

    return False


def filter_tools(
    tool_names: list[str],
    allowed: set[str] | None = None,
    blocked: set[str] | None = None,
) -> list[str]:
    """Filter tool names with deny-all-then-allow semantics.

    - If ``allowed`` is None, return ``[]`` (deny all — no tools pass).
    - If ``allowed`` is provided, keep only names in that set that are not blocked.
    - ``blocked`` is always ``DEFAULT_BLOCKED_TOOLS`` unioned with any extra
      names the caller passes; callers can only add blocks, never remove defaults.
    """
    # Deny-all when no explicit allowlist is provided.
    if allowed is None:
        return []

    blocked_set: set[str] = set(DEFAULT_BLOCKED_TOOLS)
    if blocked is not None:
        blocked_set |= set(blocked)

    result: list[str] = []
    for name in tool_names:
        if name in blocked_set:
            continue
        if name not in allowed:
            continue
        result.append(name)
    return result


def assert_trusted_mcps(mcps: list[str]) -> None:
    """Raise ``ValueError`` if any MCP URL fails the trust policy.

    Primarily enforces that HTTPS hosts are trusted; untrusted or malformed
    URLs also fail so callers cannot smuggle open endpoints.
    """
    if mcps is None:
        raise ValueError("mcps must be a list of URL strings")
    for mcp in mcps:
        if not is_trusted_url(mcp):
            raise ValueError(f"untrusted MCP URL: {mcp!r}")
