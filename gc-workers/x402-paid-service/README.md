# x402 Paid Service - USDC Micropayments

Cloudflare Worker implementing the x402 payment protocol for pay-per-call API access with USDC micropayments on Base network.

## Deployment

| Field | Value |
|-------|-------|
| URL | https://x402-paid-service.iholt.workers.dev |
| Platform | Cloudflare Workers |
| Chain | Base Mainnet (8453) |

## Payment Details

| Parameter | Value |
|-----------|-------|
| Price | $0.01 USDC per request |
| Token | USDC |
| Token Address | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Vault | `0xB6D9935af4478fc54404DD95aC0942D28de01F08` |
| Chain ID | 8453 (Base) |

## Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/` | GET | None | Landing page with OpenGraph |
| `/api/execute` | POST | x402 | Execute paid API call |
| `/health` | GET | None | Health check |
| `/.well-known/ai-plugin.json` | GET | None | AI plugin manifest |
| `/llms.txt` | GET | None | LLM discovery |
| `/metadata.json` | GET | None | JSON-LD WebAPI schema |

## x402 Payment Flow

1. Client calls `POST /api/execute` without proof
2. Server returns `402 Payment Required` with `X-Accept-Payment` headers
3. Client signs USDC transfer to vault contract
4. Client retries with `X-Payment-Proof` header containing signed tx
5. Server verifies payment and executes request

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| VAULT_ADDRESS | var | Payment vault contract address |
| USDC_ADDRESS | var | USDC token contract address |
| CHAIN_ID | var | Base chain ID (8453) |
| PRICE_USD6 | var | Price in USDC micro-units (10000 = $0.01) |

## Testing

```bash
npm test
npm run test:coverage
```

## Deployment

```bash
wrangler deploy
```

## Health Check

```bash
curl https://x402-paid-service.iholt.workers.dev/health
```
