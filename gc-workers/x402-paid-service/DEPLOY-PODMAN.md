# Running x402-paid-service as a Node service under Podman

This service was originally a Cloudflare Worker (`wrangler.toml` + `src/index.ts`).
It now also runs as a plain Node HTTP service (`src/server.ts`) so it can live in a
rootless Podman container and read its secrets from `/run/secrets/<name>` — the
runtime chosen for the Genesis Conductor payment stack.

The request-handling logic in `src/index.ts` is unchanged and shared by both
targets. `src/server.ts` is a thin `node:http` → Fetch adapter that builds `env`
from the secret resolver (`src/lib/secrets.ts`) and calls the same handler.

## Secrets vs config

`src/lib/secrets.ts` resolves each value in this order: explicit env binding →
`/run/secrets/<name>` → `process.env[<name>]`. So any value may be delivered as a
native Podman secret or a plain environment variable. Treat these as **secrets**
(Podman secrets); the rest may be plain `--env` config:

- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` — Coinbase CDP facilitator credentials
  (required for the $4,999 / $9,999 tiers to settle production-grade).
- `GAS_ALERT_WEBHOOK` — if it embeds a token.

Config (non-secret) values: `VAULT_ADDRESS` (required — the payout address; the
service refuses to start without it), `USDC_ADDRESS`, `CHAIN_ID`, the
`TIER_*_USD6` prices, `SHOPIFY_*_URL`, `BASE_RPC_URL`, `MAIN_WALLET`, `PORT`
(default 8080), `GAS_CRON_INTERVAL_MS` (0 = off; the Worker used a Cloudflare
cron trigger instead).

## Create the Podman secrets

The host decrypts `.vault/secrets.enc.yaml` and injects values; never paste secret
values into a shell that logs history. Use a file or stdin:

```bash
printf %s "$CDP_KEY_ID_VALUE"     | podman secret create CDP_API_KEY_ID -
printf %s "$CDP_KEY_SECRET_VALUE" | podman secret create CDP_API_KEY_SECRET -
```

## Build and run

```bash
podman build -t x402-paid-service .

podman run -d --name x402 \
  -p 8080:8080 \
  --secret CDP_API_KEY_ID,type=mount \
  --secret CDP_API_KEY_SECRET,type=mount \
  -e VAULT_ADDRESS=0x3E97190CddC508778BdE37E52005f8Da7F4D476F \
  -e USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  -e CHAIN_ID=8453 \
  -e TIER_DISCOVERY_USD6=10000 \
  -e TIER_PRO_USD6=1000000 \
  -e TIER_INFERENCE_USD6=10000000 \
  -e TIER_SPECIALIZED_USD6=100000000 \
  -e TIER_FOUNDERS_USD6=4999000000 \
  -e TIER_SOURCE_EXCLUSIVE_USD6=9999000000 \
  -e SHOPIFY_FOUNDERS_URL=https://... \
  -e SHOPIFY_SOURCE_EXCLUSIVE_URL=https://... \
  x402-paid-service
```

`--secret <name>,type=mount` mounts each secret at `/run/secrets/<name>`, which is
exactly where `resolveSecret` looks. `type=mount` (not `type=env`) keeps the value
off the process environment.

## Verify

```bash
curl -s localhost:8080/health                 # {"status":"ok",...}
curl -s -X POST localhost:8080/api/execute -o /dev/null -w '%{http_code}\n'  # 402
curl -s localhost:8080/.well-known/x402 | head -c 200
```

## Local run without a container

```bash
VAULT_ADDRESS=0x... USDC_ADDRESS=0x... CHAIN_ID=8453 TIER_DISCOVERY_USD6=10000 \
  npm start          # tsx src/server.ts, listens on $PORT (default 8080)
```

## Parity note

Static files under `public/` (`.well-known/a2a.json`, `.well-known/mcp.json`) were
served by Cloudflare's static-asset layer in the Worker deployment. The Node
handler generates the critical discovery routes inline (`/.well-known/x402`,
`/openapi.json`, `/llms.txt`, `/robots.txt`, `/sitemap.xml`) but does not yet
serve the two static `public/.well-known/*` JSON files. Add a static route in
`server.ts` if those are required in the Node deployment.
