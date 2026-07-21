"""Address and phrase extraction from session text."""

from __future__ import annotations

import re
from collections import OrderedDict

# Ethereum address: 0x + exactly 40 hex (not 64-char private keys).
# Negative lookahead/lookbehind avoids matching inside longer hex runs.
_ADDRESS = re.compile(r"(?<![0-9a-fA-F])0x([0-9a-fA-F]{40})(?![0-9a-fA-F])")

# Global Constraints phrase scan (case-insensitive). Canonical keys as listed.
PHRASES: tuple[str, ...] = (
    "treasury",
    "fund-agent-gas",
    "TREASURY_PRIVATE",
    "snipebot",
    "wallet_registry",
    "gas_starved",
    "0x54e2",
    "safe n1",
    "metamask",
)

# Precompiled patterns; longer / multi-word phrases match as written.
_PHRASE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (phrase, re.compile(re.escape(phrase), re.IGNORECASE)) for phrase in PHRASES
)


def extract_addresses(text: str) -> list[str]:
    """Return unique Ethereum addresses, checksum-agnostic (lowercase ``0x…``).

    Order is first-seen. 64-hex private-key shapes are not addresses.
    """
    if not text:
        return []
    seen: OrderedDict[str, None] = OrderedDict()
    for m in _ADDRESS.finditer(text):
        addr = "0x" + m.group(1).lower()
        seen.setdefault(addr, None)
    return list(seen.keys())


def extract_phrase_hits(text: str) -> dict[str, int]:
    """Count phrase keyword hits (case-insensitive). Keys are canonical phrases.

    All known phrases are present in the result (0 when absent).
    """
    hits: dict[str, int] = {p: 0 for p in PHRASES}
    if not text:
        return hits
    for phrase, pattern in _PHRASE_PATTERNS:
        hits[phrase] = len(pattern.findall(text))
    return hits
