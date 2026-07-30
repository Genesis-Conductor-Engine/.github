"""Allow ``python -m gc_crew_mcp``."""

from __future__ import annotations

import sys

from gc_crew_mcp.cli import main

if __name__ == "__main__":
    sys.exit(main())
