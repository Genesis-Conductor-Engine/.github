#!/usr/bin/env bash
# Cron wrapper for auto-refuel.sh — loads MAIN_PK from the .env file if set
# Install: crontab -e  then add:
#   0 * * * * /path/to/scripts/refuel-cron-wrapper.sh >> /tmp/x402-refuel.log 2>&1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HOME/.x402-refuel.env"

if [ -f "$ENV_FILE" ]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
fi

if [ -z "${MAIN_PK:-}" ]; then
  echo "[$(date -u +%FT%TZ)] MAIN_PK not set — check $ENV_FILE"
  exit 1
fi

export MAIN_PK
exec "$SCRIPT_DIR/auto-refuel.sh"
