"""Evolve hook: POST RunMetrics to self-evolving-retrainer admin slices.

Default path: ``POST {base_url}/admin/slices`` with Ralph payload from
``metrics.to_ralph_payload``. Auth via ``X-Payment-Proof`` and/or ``x-admin-key``
headers only — never put secrets in the JSON body.

Live settlement is out of scope; inject ``transport`` for tests and dry-runs.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

from gc_crew_mcp.metrics import RunMetrics, to_ralph_payload
from gc_crew_mcp.x402_client import (
    ADMIN_SLICES_PATH,
    build_admin_request,
    classify_response,
    parse_402_body,
)

# transport(method, url, headers, body) -> (status_code, response_body_dict)
Transport = Callable[[str, str, dict[str, str], dict[str, Any]], tuple[int, dict]]


def _default_transport(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
) -> tuple[int, dict]:
    """stdlib urllib transport. Not used in unit tests (mock instead)."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            status = getattr(resp, "status", 200) or 200
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read() if hasattr(exc, "read") else b""
    if not raw:
        return status, {}
    text = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
    try:
        parsed = json.loads(text) if text else {}
    except json.JSONDecodeError:
        return status, {"raw": text}
    if isinstance(parsed, dict):
        return status, parsed
    return status, {"data": parsed}


def submit_metrics(
    base_url: str,
    metrics: RunMetrics,
    *,
    payment_proof: str | None = None,
    admin_key: str | None = None,
    transport: Transport | None = None,
) -> dict:
    """POST metrics to retrainer ``/admin/slices``.

    Returns:
      - ``{status: "ok", body: ...}`` on HTTP 200
      - ``{status: "payment_required", x402: parsed}`` on HTTP 402 (no raise)
      - ``{status: "error", http_status: int, body: ...}`` otherwise

    Never includes ``payment_proof`` / ``admin_key`` in the JSON body.
    """
    if not base_url or not isinstance(base_url, str):
        raise ValueError("base_url must be a non-empty string")
    # Soft trust check: refuse clearly non-http(s) schemes (no secret smuggling).
    parsed = urlparse(base_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"base_url must be http(s), got scheme={parsed.scheme!r}")

    payload = to_ralph_payload(metrics)
    # Defense in depth: strip any accidental secret-like keys from payload.
    for forbidden in ("payment_proof", "admin_key", "private_key", "secret", "mnemonic"):
        payload.pop(forbidden, None)

    url, headers = build_admin_request(
        base_url,
        ADMIN_SLICES_PATH,
        payment_proof=payment_proof,
        admin_key=admin_key,
    )
    xport: Transport = transport if transport is not None else _default_transport
    status, body = xport("POST", url, headers, payload)
    kind = classify_response(status, body if isinstance(body, dict) else None)

    if kind == "ok":
        return {"status": "ok", "body": body if isinstance(body, dict) else {}}
    if kind == "payment_required":
        x402 = parse_402_body(body if isinstance(body, dict) else {})
        return {"status": "payment_required", "x402": x402}
    return {
        "status": "error",
        "http_status": status,
        "body": body if isinstance(body, dict) else {},
    }
