"""Known address book for Claude session mining (ops labels, not secrets)."""

from __future__ import annotations

# Checksum-agnostic keys (lowercase 0x + 40 hex). Public fleet addresses.
KNOWN_ADDRESSES: dict[str, str] = {
    "0x54e2acab04c89a3fe02852bf8dd69ee8f526bc75": "TREASURY_UNSIGNED",
    "0x60c4499870f115664d7ffd8411b023dbef3377d9": "HOT_X402",
    "0x2ad5480d9e24be1973019b61dab4bbab2f6930eb": "SAFE_2OF3",
    "0x9545e2439c5c75d3aa723acac1aa6b0fa1db6956": "METAMASK1_FEE_SINK",
    "0x2af0103cb5348e2919ed9cf7595e8dbe157da1b8": "LEGACY_TREASURY_PANEL",
}


def _normalize_address(address: str) -> str:
    a = (address or "").strip()
    if a.startswith("0X"):
        a = "0x" + a[2:]
    elif not a.startswith("0x") and len(a) == 40:
        a = "0x" + a
    return a.lower()


def label_address(address: str) -> str:
    """Return known ops label for an address, or ``UNKNOWN``.

    Matching is checksum-insensitive (lowercase normalize).
    """
    return KNOWN_ADDRESSES.get(_normalize_address(address), "UNKNOWN")
