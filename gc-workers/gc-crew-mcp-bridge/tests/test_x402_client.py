"""Unit tests for gc_crew_mcp.x402_client (no live HTTP pay)."""

from __future__ import annotations

import json
import unittest
from urllib.request import Request

from gc_crew_mcp.x402_client import (
    DEFAULT_PRICE_USDC6,
    HEADER_ADMIN_KEY,
    HEADER_PAYMENT_PROOF,
    RETRAINER_NETWORK,
    RETRAINER_PAY_TO,
    USDC_BASE,
    build_admin_request,
    classify_response,
    fetch_well_known,
    parse_402_body,
)


class TestConstants(unittest.TestCase):
    def test_price_and_contract(self) -> None:
        self.assertEqual(DEFAULT_PRICE_USDC6, 10000)
        self.assertEqual(
            RETRAINER_PAY_TO, "0x2aF0103Cb5348e2919ed9CF7595E8Dbe157dA1B8"
        )
        self.assertEqual(RETRAINER_NETWORK, "eip155:8453")
        self.assertEqual(
            USDC_BASE, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        )


class TestParse402Body(unittest.TestCase):
    def test_accepts_style_retrainer(self) -> None:
        body = {
            "x402Version": 2,
            "accepts": [
                {
                    "scheme": "exact",
                    "network": "eip155:8453",
                    "asset": USDC_BASE,
                    "amount": "10000",
                    "payTo": RETRAINER_PAY_TO,
                    "maxTimeoutSeconds": 60,
                }
            ],
        }
        parsed = parse_402_body(body)
        self.assertEqual(parsed["price_usdc6"], 10000)
        self.assertEqual(parsed["network"], "eip155:8453")
        self.assertEqual(parsed["payTo"], RETRAINER_PAY_TO)
        self.assertEqual(parsed["accepts_count"], 1)

    def test_max_amount_required_alias(self) -> None:
        body = {
            "accepts": [
                {
                    "network": "eip155:8453",
                    "maxAmountRequired": "25000",
                    "payTo": "0xabc",
                }
            ]
        }
        parsed = parse_402_body(body)
        self.assertEqual(parsed["price_usdc6"], 25000)
        self.assertEqual(parsed["payTo"], "0xabc")

    def test_top_level_discovery(self) -> None:
        body = {
            "version": "2.0",
            "payTo": RETRAINER_PAY_TO,
            "network": RETRAINER_NETWORK,
            "price": {"amount": "10000", "currency": "USDC", "decimals": 6},
        }
        parsed = parse_402_body(body)
        self.assertEqual(parsed["price_usdc6"], 10000)
        self.assertEqual(parsed["payTo"], RETRAINER_PAY_TO)
        self.assertEqual(parsed["network"], RETRAINER_NETWORK)

    def test_endpoints_fallback(self) -> None:
        body = {
            "endpoints": [
                {
                    "path": "/admin/slices",
                    "price": {"amount": "10000"},
                    "network": "eip155:8453",
                    "payTo": RETRAINER_PAY_TO,
                }
            ]
        }
        parsed = parse_402_body(body)
        self.assertEqual(parsed["price_usdc6"], 10000)
        self.assertEqual(parsed["payTo"], RETRAINER_PAY_TO)

    def test_defaults_when_empty(self) -> None:
        parsed = parse_402_body({})
        self.assertEqual(parsed["price_usdc6"], DEFAULT_PRICE_USDC6)
        self.assertEqual(parsed["network"], RETRAINER_NETWORK)
        self.assertEqual(parsed["payTo"], RETRAINER_PAY_TO)

    def test_non_dict_raises(self) -> None:
        with self.assertRaises(TypeError):
            parse_402_body([])  # type: ignore[arg-type]


class TestBuildAdminRequest(unittest.TestCase):
    def test_url_and_headers_with_both_auth(self) -> None:
        url, headers = build_admin_request(
            "https://example.genesisconductor.io",
            "/admin/slices",
            payment_proof="proof-abc",
            admin_key="key-xyz",
        )
        self.assertEqual(url, "https://example.genesisconductor.io/admin/slices")
        self.assertEqual(headers[HEADER_PAYMENT_PROOF], "proof-abc")
        self.assertEqual(headers[HEADER_ADMIN_KEY], "key-xyz")
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_payment_proof_only(self) -> None:
        url, headers = build_admin_request(
            "https://example.genesisconductor.io/",
            "admin/sweep",
            payment_proof="p",
            admin_key=None,
        )
        self.assertEqual(url, "https://example.genesisconductor.io/admin/sweep")
        self.assertIn(HEADER_PAYMENT_PROOF, headers)
        self.assertNotIn(HEADER_ADMIN_KEY, headers)

    def test_admin_key_only(self) -> None:
        _, headers = build_admin_request(
            "http://localhost:8787",
            "/admin/evaluate/1",
            payment_proof=None,
            admin_key="k",
        )
        self.assertNotIn(HEADER_PAYMENT_PROOF, headers)
        self.assertEqual(headers[HEADER_ADMIN_KEY], "k")

    def test_no_auth_headers_when_none(self) -> None:
        _, headers = build_admin_request(
            "https://example.genesisconductor.io",
            "/admin/slices",
            None,
            None,
        )
        self.assertNotIn(HEADER_PAYMENT_PROOF, headers)
        self.assertNotIn(HEADER_ADMIN_KEY, headers)

    def test_empty_base_raises(self) -> None:
        with self.assertRaises(ValueError):
            build_admin_request("", "/admin/slices", None, None)


class TestClassifyResponse(unittest.TestCase):
    def test_ok(self) -> None:
        self.assertEqual(classify_response(200, {"ok": True}), "ok")

    def test_payment_required(self) -> None:
        self.assertEqual(classify_response(402, {"accepts": []}), "payment_required")

    def test_error(self) -> None:
        self.assertEqual(classify_response(500, None), "error")
        self.assertEqual(classify_response(401, {}), "error")
        self.assertEqual(classify_response(404, {}), "error")


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._raw = json.dumps(payload).encode("utf-8")
        self.status = 200

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None


class TestFetchWellKnown(unittest.TestCase):
    def test_injectable_opener(self) -> None:
        captured: list[Request] = []

        def opener(req: Request) -> _FakeResponse:
            captured.append(req)
            return _FakeResponse(
                {
                    "payTo": RETRAINER_PAY_TO,
                    "network": RETRAINER_NETWORK,
                    "price": {"amount": "10000"},
                }
            )

        data = fetch_well_known(
            "https://optimization-inversion.genesisconductor.io",
            opener=opener,
        )
        self.assertEqual(data["payTo"], RETRAINER_PAY_TO)
        self.assertEqual(len(captured), 1)
        self.assertIn("/.well-known/x402", captured[0].full_url)

    def test_no_network_without_opener_override_is_optional(self) -> None:
        # Ensure injectable path is the only one unit tests use; empty base fails
        # without calling the network.
        with self.assertRaises(ValueError):
            fetch_well_known("", opener=lambda r: _FakeResponse({}))


if __name__ == "__main__":
    unittest.main()
