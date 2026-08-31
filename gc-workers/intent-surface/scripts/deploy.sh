#!/usr/bin/env bash
# Deploy intent-surface to Cloudflare Workers + custom domain.
# Auth: CLOUDFLARE_API_TOKEN (preferred) or interactive `wrangler login`.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! npx wrangler whoami >/dev/null 2>&1; then
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    cat <<EOF >&2
Not authenticated with Cloudflare.

  export CLOUDFLARE_API_TOKEN='…'   # Account: Workers Edit + Workers AI + Zone DNS
  # or: npx wrangler login

Then re-run: npm run deploy
EOF
    exit 2
  fi
fi

npm install --silent
npx wrangler deploy
echo
echo "Confirm:"
echo "  curl -sS https://intent-surface.<subdomain>.workers.dev/api/health"
echo "  curl -sS 'https://intent.genesisconductor.io/api/csid?space=1RKZzzEXjXmKB'"
echo "  curl -sS 'https://intent.genesisconductor.io/api/csid?space=1RKZzzEXjXmKB&kimi=1'"
