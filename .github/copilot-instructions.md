# Genesis Conductor — Copilot Instructions

## Branch Protection Awareness

Some repos (Check-Your-Score, Genesis-Conductor) require signed commits. Before pushing:
- Check if the repo uses branch protection: `gh api repos/{owner}/{repo}/branches/main/protection`
- If signed commits required, create a PR instead of direct push, or warn the user

## Cloudflare Worker Secrets

When deploying workers that need secrets (AAL_TOKEN, NOTION_TOKEN, ADMIN_TOKEN):
- Document which secrets are needed in the worker's README or DEPLOY.md
- After deploy, remind user to run: `wrangler secret put SECRET_NAME`
- Do NOT attempt to create dummy secrets or skip auth checks

## Cloudflare Resource Bindings

NEVER create new KV namespaces or D1 databases without explicit user approval.

Existing Genesis Conductor resources:
- KV `API_KEYS`: `4c2c5ef0988742cc8fb98102681d9986`
- D1 `ambient-db`: `56fc54e4-a04c-4f6d-b0af-048bdfa777d8`

When wiring wrangler.toml, use these IDs unless told otherwise.

## Fleet Mode Protocol

When a message starts with "Fleet deployed:", treat it as a batch execution request:
- Execute all specified steps in parallel where possible
- Use todo tracking for multi-step tasks
- Emit A2A envelopes to `~/gc-workers/a2a-envelopes.jsonl` if artifacts are produced
- Soul Capsule events go to `~/.genesis/soul-capsule-v1.jsonl`

## SEO Discovery Files (All Workers)

Every Cloudflare Worker should include in `public/`:
- `/llms.txt` — llmstxt.org format for LLM crawlers
- `/robots.txt` — Include GPTBot, ClaudeBot, anthropic-ai rules
- `/sitemap.xml` — URL list for search engines
- `/.well-known/mcp.json` — MCP server manifest (schema_version: "2024-11-05")
- `/.well-known/a2a.json` — A2A agent discovery

Use IndexNow for instant Bing/Yandex indexing (Google sitemap ping is deprecated).

## x402 Settlement Vault (Base Mainnet)

- **Vault:** `0xB6D9935af4478fc54404DD95aC0942D28de01F08`
- **USDC:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **Chain:** Base (8453)
- **Contract:** EnterpriseEscrowVault
