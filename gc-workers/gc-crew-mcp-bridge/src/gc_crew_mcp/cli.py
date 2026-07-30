"""stdlib CLI for Domains A/B/C: trust, roster, evolve-dry, x402-discover.

Entry: ``python -m gc_crew_mcp <command> ...``

Exit codes:
  0 — success (including evolve payment_required / ok)
  1 — runtime error (network, roster validation failure, evolve error)
  2 — usage / validation (argparse errors, untrusted URLs)

No live USDC payment on default paths. Unit tests inject openers/transports only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from typing import Any
from urllib.parse import urljoin, urlparse

from gc_crew_mcp import __version__
from gc_crew_mcp.crew_topology import (
    CREW_ROSTER,
    parallel_dispatch_plan,
    validate_roster,
)
from gc_crew_mcp.evolve_hook import Transport, submit_metrics
from gc_crew_mcp.metrics import RunMetrics, VALID_GOAL_STATUSES, validate_goal_status
from gc_crew_mcp.observability import configure_observability, error, info, span
from gc_crew_mcp.trust import is_trusted_url
from gc_crew_mcp.x402_client import (
    DEFAULT_PRICE_USDC6,
    RETRAINER_NETWORK,
    RETRAINER_PAY_TO,
    WELL_KNOWN_PATH,
    Opener,
    fetch_well_known,
    parse_402_body,
)

DEFAULT_RETRAINER_BASE = "https://optimization-inversion.genesisconductor.io"


def _mock_402_transport(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
) -> tuple[int, dict]:
    """Default dry-run transport: always 402 with package contract constants."""
    return 402, {
        "accepts": [
            {
                "amount": str(DEFAULT_PRICE_USDC6),
                "network": RETRAINER_NETWORK,
                "payTo": RETRAINER_PAY_TO,
            }
        ]
    }


def _print_json(obj: Any) -> None:
    print(json.dumps(obj, indent=2, sort_keys=True))


def cmd_trust_check(urls: list[str]) -> int:
    """Domain A: check each URL against the trust policy. Exit 0 iff all trusted."""
    if not urls:
        print("error: trust-check requires one or more URLs", file=sys.stderr)
        return 2

    with span("cli.trust_check", url_count=len(urls)):
        results = [{"url": u, "trusted": is_trusted_url(u)} for u in urls]
        _print_json(results)
        all_trusted = all(r["trusted"] for r in results)
        info("trust-check complete", all_trusted=all_trusted, count=len(results))
        return 0 if all_trusted else 2


def cmd_roster() -> int:
    """Domain B: dump parallel dispatch plan; exit 1 if validate_roster has messages."""
    with span("cli.roster"):
        plan = parallel_dispatch_plan(CREW_ROSTER)
        _print_json(plan)
        messages = validate_roster(CREW_ROSTER)
        if messages:
            for msg in messages:
                print(f"roster validation: {msg}", file=sys.stderr)
            error("roster validation failed", message_count=len(messages))
            return 1
        info("roster ok", agent_count=len(plan))
        return 0


def _base_url_trusted(base_url: str) -> bool:
    """True if base_url (or its scheme://netloc/ origin) passes trust policy."""
    if not base_url or not isinstance(base_url, str):
        return False
    if is_trusted_url(base_url):
        return True
    parsed = urlparse(base_url)
    if parsed.scheme and parsed.netloc:
        return is_trusted_url(f"{parsed.scheme}://{parsed.netloc}/")
    return False


def cmd_evolve_dry(
    *,
    quality: float,
    latency_ms: float,
    cost_usdc6: int,
    goal_status: str,
    candidate_id: str | None,
    base_url: str = DEFAULT_RETRAINER_BASE,
    transport: Transport | None = None,
    live: bool = False,
    payment_proof: str | None = None,
    admin_key: str | None = None,
) -> int:
    """Domain C: dry-run submit_metrics (mock 402 by default).

    ``--live`` uses real transport only when ``base_url`` is trusted **and**
    a payment proof or admin key is provided (flag or env). Otherwise exit 2.
    """
    try:
        status = validate_goal_status(goal_status)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    # Resolve auth from flags first, then env (never log values).
    proof = payment_proof if payment_proof else os.environ.get("X402_PAYMENT_PROOF")
    key = admin_key if admin_key else os.environ.get("X_ADMIN_KEY")
    # Treat empty strings as absent.
    if proof is not None and not str(proof).strip():
        proof = None
    if key is not None and not str(key).strip():
        key = None

    if live:
        if not _base_url_trusted(base_url):
            print(
                f"error: --live requires a trusted --base-url, got {base_url!r}",
                file=sys.stderr,
            )
            return 2
        if not proof and not key:
            print(
                "error: --live requires --payment-proof (or env X402_PAYMENT_PROOF) "
                "or --admin-key (or env X_ADMIN_KEY)",
                file=sys.stderr,
            )
            return 2
        # Real transport (or injected for tests). No mock when live is requested.
        xport: Transport | None = transport  # None → submit_metrics default
        use_proof, use_key = proof, key
    else:
        # Default dry-run path: mock 402, no auth headers, no live pay.
        xport = transport if transport is not None else _mock_402_transport
        use_proof, use_key = None, None

    metrics = RunMetrics(
        quality=quality,
        latency_ms=latency_ms,
        cost_usdc6=cost_usdc6,
        goal_status=status,
        candidate_id=candidate_id,
    )

    with span(
        "cli.evolve_dry",
        goal_status=status,
        candidate_id=candidate_id,
        live=live,
    ):
        try:
            result = submit_metrics(
                base_url,
                metrics,
                payment_proof=use_proof,
                admin_key=use_key,
                transport=xport,
            )
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        except Exception as exc:  # noqa: BLE001 — CLI runtime boundary
            print(f"error: evolve-dry failed: {exc}", file=sys.stderr)
            error("evolve-dry failed", err=str(exc))
            return 1

        _print_json(result)
        st = result.get("status")
        if st in ("payment_required", "ok"):
            info("evolve-dry complete", status=st)
            return 0
        error("evolve-dry error status", status=st)
        return 1


def _well_known_url(base_url: str) -> str:
    base = base_url if base_url.endswith("/") else base_url + "/"
    return urljoin(base, WELL_KNOWN_PATH.lstrip("/"))


def cmd_x402_discover(
    base_url: str = DEFAULT_RETRAINER_BASE,
    *,
    opener: Opener | None = None,
) -> int:
    """Domain C: fetch /.well-known/x402 (no payment) and compare to package constants.

    ``opener`` is injectable for unit tests — do not hit the network in tests.
    """
    if not base_url or not isinstance(base_url, str):
        print("error: --base-url must be a non-empty string", file=sys.stderr)
        return 2

    well_known = _well_known_url(base_url)
    # Trust the constructed well-known URL, or the base origin as a fallback.
    base_origin = base_url.rstrip("/") + "/"
    if not (is_trusted_url(well_known) or is_trusted_url(base_origin) or is_trusted_url(base_url)):
        print(
            f"error: untrusted base URL for x402 discovery: {base_url!r}",
            file=sys.stderr,
        )
        return 2

    with span("cli.x402_discover", base_host=base_url):
        try:
            raw = fetch_well_known(base_url, opener=opener)
        except Exception as exc:  # noqa: BLE001 — network / parse boundary
            print(f"error: x402-discover failed: {exc}", file=sys.stderr)
            error("x402-discover failed", err=str(exc))
            return 1

        discovered = parse_402_body(raw if isinstance(raw, dict) else {})
        expected = {
            "price_usdc6": DEFAULT_PRICE_USDC6,
            "network": RETRAINER_NETWORK,
            "payTo": RETRAINER_PAY_TO,
        }
        match = (
            discovered.get("price_usdc6") == expected["price_usdc6"]
            and discovered.get("network") == expected["network"]
            and discovered.get("payTo") == expected["payTo"]
        )
        out = {
            "match": match,
            "discovered": {
                "price_usdc6": discovered.get("price_usdc6"),
                "network": discovered.get("network"),
                "payTo": discovered.get("payTo"),
            },
            "expected": expected,
            "well_known_url": well_known,
        }
        _print_json(out)
        info("x402-discover complete", match=match)
        return 0


def cmd_version() -> int:
    """Print package version."""
    print(__version__)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gc_crew_mcp",
        description=(
            "Genesis Conductor crew-mcp CLI — trust, roster, evolve dry-run, "
            "x402 discover (no live pay by default)."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_trust = sub.add_parser(
        "trust-check",
        help="Domain A: check URL(s) against MCP host trust policy",
    )
    p_trust.add_argument(
        "urls",
        nargs="+",
        metavar="URL",
        help="One or more MCP / base URLs to check",
    )

    sub.add_parser(
        "roster",
        help="Domain B: print parallel dispatch plan for CREW_ROSTER",
    )

    p_evolve = sub.add_parser(
        "evolve-dry",
        help="Domain C: dry-run submit_metrics with mock 402 transport (no pay)",
    )
    p_evolve.add_argument(
        "--quality",
        type=float,
        default=0.8,
        help="Run quality score (default: 0.8)",
    )
    p_evolve.add_argument(
        "--latency-ms",
        type=float,
        default=0.0,
        dest="latency_ms",
        help="Latency in milliseconds (default: 0)",
    )
    p_evolve.add_argument(
        "--cost-usdc6",
        type=int,
        default=0,
        dest="cost_usdc6",
        help="Cost in USDC6 atomic units (default: 0)",
    )
    p_evolve.add_argument(
        "--goal-status",
        default="partial",
        dest="goal_status",
        choices=sorted(VALID_GOAL_STATUSES),
        help="Incomplete Goals status enum (default: partial)",
    )
    p_evolve.add_argument(
        "--candidate-id",
        default=None,
        dest="candidate_id",
        help="Optional evolve candidate id",
    )
    p_evolve.add_argument(
        "--base-url",
        default=DEFAULT_RETRAINER_BASE,
        dest="base_url",
        help=f"Retrainer base URL (default: {DEFAULT_RETRAINER_BASE})",
    )
    p_evolve.add_argument(
        "--live",
        action="store_true",
        default=False,
        help=(
            "Use real transport instead of mock 402. Requires trusted --base-url "
            "and --payment-proof / X402_PAYMENT_PROOF or --admin-key / X_ADMIN_KEY"
        ),
    )
    p_evolve.add_argument(
        "--payment-proof",
        default=None,
        dest="payment_proof",
        help="X-Payment-Proof value for --live (or set env X402_PAYMENT_PROOF)",
    )
    p_evolve.add_argument(
        "--admin-key",
        default=None,
        dest="admin_key",
        help="x-admin-key value for --live (or set env X_ADMIN_KEY)",
    )

    p_disc = sub.add_parser(
        "x402-discover",
        help="Domain C: GET /.well-known/x402 and compare to package constants (no pay)",
    )
    p_disc.add_argument(
        "--base-url",
        default=DEFAULT_RETRAINER_BASE,
        dest="base_url",
        help=f"Base URL for well-known discovery (default: {DEFAULT_RETRAINER_BASE})",
    )

    sub.add_parser("version", help="Print package version")

    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    transport: Transport | None = None,
    opener: Opener | None = None,
) -> int:
    """CLI entry. ``transport`` / ``opener`` are injectable for unit tests only."""
    parser = build_parser()
    try:
        args = parser.parse_args(list(argv) if argv is not None else None)
    except SystemExit as exc:
        # argparse already printed help/usage; normalize code.
        code = exc.code
        if code is None:
            return 0
        if isinstance(code, int):
            return code
        return 2

    # Observability for all commands except version (optional Logfire / no-op).
    if args.command != "version":
        configure_observability()

    if args.command == "trust-check":
        return cmd_trust_check(list(args.urls))
    if args.command == "roster":
        return cmd_roster()
    if args.command == "evolve-dry":
        return cmd_evolve_dry(
            quality=args.quality,
            latency_ms=args.latency_ms,
            cost_usdc6=args.cost_usdc6,
            goal_status=args.goal_status,
            candidate_id=args.candidate_id,
            base_url=args.base_url,
            transport=transport,
            live=bool(getattr(args, "live", False)),
            payment_proof=getattr(args, "payment_proof", None),
            admin_key=getattr(args, "admin_key", None),
        )
    if args.command == "x402-discover":
        return cmd_x402_discover(args.base_url, opener=opener)
    if args.command == "version":
        return cmd_version()

    print(f"error: unknown command {args.command!r}", file=sys.stderr)
    return 2


# Re-export Request type usage for tests that build openers.
__all__ = [
    "DEFAULT_RETRAINER_BASE",
    "build_parser",
    "cmd_evolve_dry",
    "cmd_roster",
    "cmd_trust_check",
    "cmd_version",
    "cmd_x402_discover",
    "main",
]
