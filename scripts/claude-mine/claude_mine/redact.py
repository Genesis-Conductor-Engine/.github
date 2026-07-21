"""Secret-safe text redaction for Claude session mining.

Never emit private keys, mnemonics, PEMs, or raw 0x+64-hex material.
"""

from __future__ import annotations

import re

# Ethereum private keys and other 32-byte hex blobs (0x + 64 hex).
_LONG_HEX = re.compile(r"0x[0-9a-fA-F]{64}\b")

# PEM blocks (full block → REDACTED).
_PEM = re.compile(
    r"-----BEGIN [A-Z0-9 ]+-----.*?-----END [A-Z0-9 ]+-----",
    re.DOTALL,
)

# Multi-word secret values (mnemonics / seed phrases): redact through EOL.
_MNEMONIC_ASSIGN = re.compile(
    r"(?i)\b(mnemonic|seed[_-]?phrase|seed)\b(\s*[:=]\s*)([^\n\r]+)"
)

# Single-token key-like assignments: name = value / name: value.
_KEY_ASSIGN = re.compile(
    r"(?i)\b("
    r"private[_-]?key|priv[_-]?key|secret[_-]?key|api[_-]?key|"
    r"access[_-]?key|auth[_-]?token|bearer|"
    r"password|passwd|passphrase|"
    r"secret|token|credential|credentials"
    r")\b(\s*[:=]\s*)(?P<val>([\"'][^\"']*[\"']|\S+))"
)


def redact_text(text: str) -> str:
    """Return text with secrets replaced by safe placeholders.

    - ``0x`` + 64 hex → ``0xLONG``
    - key-like assignments (private_key=, mnemonic:, api_key=, …) →
      name + separator + ``REDACTED``
    - PEM blocks → ``REDACTED``
    """
    if not text:
        return text

    out = _PEM.sub("REDACTED", text)
    out = _LONG_HEX.sub("0xLONG", out)

    def _repl_assign(m: re.Match[str]) -> str:
        return f"{m.group(1)}{m.group(2)}REDACTED"

    out = _MNEMONIC_ASSIGN.sub(_repl_assign, out)
    out = _KEY_ASSIGN.sub(_repl_assign, out)
    return out
