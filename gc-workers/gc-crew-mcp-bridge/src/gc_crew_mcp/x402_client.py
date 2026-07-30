"""stdlib-only x402 client helpers for self-evolving-retrainer admin routes.

Matches production retrainer contract (do not change without operator review):

- ``DEFAULT_PRICE_USDC6 = 10000`` ($0.01 USDC, 6 decimals)
- ``payTo`` = ``0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8``
- ``network`` = ``eip155:8453`` (Base mainnet)
- ``USDC`` = ``0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913``
- Auth: ``X-Payment-Proof`` header and/or ``x-admin-key``
- Discovery: ``GET /.well-known/x402``
- Admin: ``POST /admin/slices``, ``/admin/sweep``, ``/admin/evaluate/:id``

No live USDC payment is performed here. Unit tests must inject mock openers /
transports only.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any
from urllib.parse import urljoin

# Retrainer x402 contract (atomic USDC6; $0.01 = 10000).
DEFAULT_PRICE_USDC6 = 10000
RETRAINER_PAY_TO = "0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8"
RETRAINER_NETWORK = "eip155:8453"
USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

HEADER_PAYMENT_PROOF = "X-Payment-Proof"
HEADER_ADMIN_KEY = "x-admin-key"

WELL_KNOWN_PATH = "/.well-known/x402"
ADMIN_SLICES_PATH = "/admin/slices"
ADMIN_SWEEP_PATH = "/admin/sweep"
ADMIN_EVALUATE_PATH_PREFIX = "/admin/evaluate/"

Opener = Callable[[urllib.request.Request], Any]


def parse_402_body(body: dict) -> dict:
    """Extract price / network / payTo from retrainer-style 402 or discovery JSON.

    Supports:
    - Payment-required shape with ``accepts[0].{amount|maxAmountRequired,network,payTo}``
    - Top-level ``payTo`` / ``network`` / ``price`` (well-known discovery)
    - Nested ``price.amount`` objects

    Returns a normalized dict with keys ``price_usdc6`` (int|None), ``network``,
    ``payTo``, plus any raw ``accepts`` count for debugging. Never includes secrets.
    """
    if not isinstance(body, dict):
        raise TypeError(f"402 body must be a dict, got {type(body).__name__}")

    price: int | None = None
    network: str | None = None
    pay_to: str | None = None

    accepts = body.get("accepts")
    if isinstance(accepts, list) and accepts:
        first = accepts[0]
        if isinstance(first, dict):
            raw_amount = (
                first.get("amount")
                if first.get("amount") is not None
                else first.get("maxAmountRequired")
            )
            price = _coerce_usdc6(raw_amount)
            network = first.get("network") or network
            pay_to = first.get("payTo") or pay_to

    # Top-level discovery fields (well-known / fallback).
    if pay_to is None and body.get("payTo") is not None:
        pay_to = str(body["payTo"])
    if network is None and body.get("network") is not None:
        network = str(body["network"])
    if price is None:
        price = _coerce_usdc6(body.get("price") if "price" in body else body.get("amount"))

    if price is None and isinstance(body.get("endpoints"), list) and body["endpoints"]:
        ep0 = body["endpoints"][0]
        if isinstance(ep0, dict):
            if price is None:
                price = _coerce_usdc6(ep0.get("price") if "price" in ep0 else ep0.get("amount"))
            if network is None and ep0.get("network") is not None:
                network = str(ep0["network"])
            if pay_to is None and ep0.get("payTo") is not None:
                pay_to = str(ep0["payTo"])

    return {
        "price_usdc6": price if price is not None else DEFAULT_PRICE_USDC6,
        "network": network or RETRAINER_NETWORK,
        "payTo": pay_to or RETRAINER_PAY_TO,
        "accepts_count": len(accepts) if isinstance(accepts, list) else 0,
    }


def _coerce_usdc6(value: Any) -> int | None:
    """Best-effort parse of USDC6 amount from str/int/float/dict."""
    if value is None:
        return None
    if isinstance(value, dict):
        # Nested price object: {amount, currency, decimals}
        return _coerce_usdc6(value.get("amount"))
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return int(s)
        except ValueError:
            try:
                return int(float(s))
            except ValueError:
                return None
    return None


def build_admin_request(
    base_url: str,
    path: str,
    payment_proof: str | None,
    admin_key: str | None,
) -> tuple[str, dict[str, str]]:
    """Build full admin URL and auth headers (no secrets in URL/query).

    Headers include ``X-Payment-Proof`` and/or ``x-admin-key`` when provided.
    Always sets ``Content-Type: application/json`` and ``Accept: application/json``.
    """
    if not base_url or not isinstance(base_url, str):
        raise ValueError("base_url must be a non-empty string")
    if not path or not isinstance(path, str):
        raise ValueError("path must be a non-empty string")

    base = base_url if base_url.endswith("/") else base_url + "/"
    rel = path[1:] if path.startswith("/") else path
    url = urljoin(base, rel)

    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if payment_proof:
        headers[HEADER_PAYMENT_PROOF] = payment_proof
    if admin_key:
        headers[HEADER_ADMIN_KEY] = admin_key
    return url, headers


def classify_response(status: int, body: dict | None) -> str:
    """Classify HTTP outcome as ``ok`` | ``payment_required`` | ``error``."""
    if status == 200:
        return "ok"
    if status == 402:
        return "payment_required"
    return "error"


def fetch_well_known(
    base_url: str,
    opener: Opener | None = None,
) -> dict:
    """GET ``{base_url}/.well-known/x402`` and return parsed JSON.

    ``opener`` is injectable for tests: ``opener(Request) -> response`` with
    ``.read()`` and optional ``.status``. Defaults to ``urllib.request.urlopen``.
    Does not perform payment.
    """
    if not base_url or not isinstance(base_url, str):
        raise ValueError("base_url must be a non-empty string")
    base = base_url if base_url.endswith("/") else base_url + "/"
    url = urljoin(base, WELL_KNOWN_PATH.lstrip("/"))
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    open_fn: Opener = opener if opener is not None else urllib.request.urlopen
    try:
        with open_fn(req) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read() if hasattr(exc, "read") else b""
        if not raw:
            raise
    if isinstance(raw, bytes):
        text = raw.decode("utf-8")
    else:
        text = str(raw)
    data = json.loads(text) if text else {}
    if not isinstance(data, dict):
        raise ValueError("well-known response is not a JSON object")
    return data
