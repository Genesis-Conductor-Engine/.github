"""Allow ``python -m claude_mine``."""

from __future__ import annotations

import sys

from claude_mine.cli import main

if __name__ == "__main__":
    sys.exit(main())
