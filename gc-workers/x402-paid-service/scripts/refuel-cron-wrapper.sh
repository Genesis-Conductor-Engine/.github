#!/usr/bin/env bash
# Cron wrapper for auto-refuel.sh — loads MAIN_PK + BASE_RPC_URL from macOS Keychain
# Install: crontab -e  then add:
#   0 * * * * /path/to/scripts/refuel-cron-wrapper.sh >> /tmp/x402-refuel.log 2>&1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
source "$HOME/.vault/bin/load-project-env.sh" x402-worker

if [ -z "${MAIN_PK:-}" ]; then
  echo "[$(date -u +%FT%TZ)] MAIN_PK not set — check Keychain entry vault:x402-worker:MAIN_PRIVATE_KEY"
  exit 1
fi

export MAIN_PK
exec "$SCRIPT_DIR/auto-refuel.sh"
