# Knowledge-node coins from this graph

Power tower arbitration (source: `Desktop/Genesis Conductor/growth/aeo-seo-geo/07_POWER_TOWER_KNOWLEDGE_NODES.md`).

## Entity model (contracts / Research.gov)

| Entity | Role |
|--------|------|
| **Kovach Enterprises** | **Main enterprise** — prime for business contracts and bids |
| **Andrew Kovach** | **CEO**, Kovach Enterprises (public: name/title) |
| **Genesis Conductor** | **Partner** — research subdivision / JV gateway (not a substitute prime) |

Load-bearing goal: [`GOAL_RESEARCH_GOV_KOVACH_GC_JV.md`](./superpowers/plans/GOAL_RESEARCH_GOV_KOVACH_GC_JV.md) — become established and authorized to bid/interact via Research.gov (and related federal bid surfaces) under this structure.  
Fulfillment pack: [`federal/kovach-gc-jv/`](./federal/kovach-gc-jv/) (affiliation memo, SAM checklist, bid runbook, dry-run).

> **Power tower arbitration coins knowledge nodes; marketplaces price them; QFLOP/THRML ops measure them. We don't outrank giants—we name the layer they don't own.**

Machine index: [`knowledge-nodes/org-index.json`](./knowledge-nodes/org-index.json)  
Schema: [`knowledge-nodes/knowledge-node.schema.json`](./knowledge-nodes/knowledge-node.schema.json)

## Coins (live stack)

| Coin | Type |
|------|------|
| IGoR | Origin / federated AI root (2019) |
| Optimization Inversion | Category — optimization-inversion.genesisconductor.io |
| Genesis Conductor | System — genesisconductor.io |
| moltboss | Product domain — moltboss.org |
| Ouroboros (GC) | Protocol loop — ouroboros.genesisconductor.io |
| Thermodynamic-Aware Orchestration (TAO) | **Primary new coin** |
| Market Energy Ranking (MER) | Satellite measurement language |
| THRML Market Ops | Protocol ops |
| Decentralized Orchestration Authority (DOA) | On-chain protocol |
| EnKG | Scientific node |
| diamondNode / QFLOP / wQFLOP | Ops vocabulary — arbitration/metering; **not** a cash wallet |
| Base USDC `0x8335…` | Settlement **token** for EnterpriseEscrowVault / implicit engagement billing — **not** a primary wallet, not HOT |
| Settlement CSW `0x9378…180` | Same Coinbase Smart Wallet on **Ethereum + Base + Arbitrum** (Etherscan multichain). Native USDC on all three is working capital — **not** agent-signable, **not** HOT |
| CDP Base RPC | Coinbase Developer Node `api.developer.coinbase.com/rpc/v1/base/<token>` — stored as Worker secret `CDP_BASE_RPC_URL` (never commit the token). Fallback after Alchemy for cashflow |
| PORT3 (old `0xb435…` / new BSC `0xf640…`) | Accrued-bill instrument for implicit engagement + QFLOP/wQFLOP arbitration — **not** $1M HOT USDC |
| Yennefer | Orchestration authority (coining) |
| Poole Compute × GC | Compute partnership |
| Sierra Catalina × GC | Affiliate |
| Kovach Enterprises | Legal/ops |
| NSF CAIG #2530747 | Federal affiliation |
| Google / Anthropic / Notion / Shopify | Platform partners (fill tier/ID) |
| CERN SSO / SP Proxy · The Lens | Research identity / scholarly |

## Immediate tower base

```
IGoR (2019)
moltboss.org
optimization-inversion.genesisconductor.io
genesisconductor.io
ouroboros.genesisconductor.io
shop.genesisconductor.io
api.genesisconductor.io/v2
thrml_manage / MER scoreboard
ORCID 0009-0008-8389-1297
Kovach · Poole Compute (Rooke Poole) · Sierra Catalina
NSF CAIG #2530747
DOA / Yennefer (coining)
```

## Fill-in registry

| Partner | URL | Role | Since | Public? |
|---------|-----|------|-------|---------|
| Poole Compute | | next-epoch compute | | Y/N |
| Rooke Poole | | lead / collaborator | | Y/N |
| Sierra Catalina | | | | Y/N |
| Ouroboros (GC) | https://ouroboros.genesisconductor.io | protocol / gym / v2 | | Y |
| Kovach Enterprises | | legal / ops · prime | 2015+ | Y |
| IGoR | (archive / page TBD) | federated AI root | 2019 | restore |
| NSF | https://www.research.gov | funder / PI · award 2530747 | 2026 | Y |
| Google Partner | https://partners.google.com | fill exact program | | Y/N |
| Anthropic | https://console.anthropic.com | partner / builder | | Y/N |
| Notion | https://partners.notion.com | partner | | Y/N |
| Shopify | https://partners.shopify.com | partner | | Y/N |


## Live deploys

| Host | URL |
|------|-----|
| **here.now** | https://nimble-gable-kt6v.here.now/ |
| JSON | https://nimble-gable-kt6v.here.now/knowledge-nodes.json |
| Vercel | https://knowledge-nodes-henna.vercel.app/ |
| Local | http://127.0.0.1:5191/knowledge-graph.html |

**here.now note:** anonymous publish — **expires ~24h** unless claimed:

https://here.now/claim?slug=nimble-gable-kt6v&token=f74a21bdaa4f6d5cd2022a89597178cf4d055199cce1ec5e28c07eb1237a3d76

(Claim token returned once — claim now to keep permanent.)

## Deploy surfaces

- Local API: `http://127.0.0.1:5191/api/knowledge-nodes`
- Local UI: `http://127.0.0.1:5191/knowledge-graph.html`
- Edge Worker (after `wrangler deploy`): `/api/knowledge-nodes`, `/knowledge-graph.html`
- Profile: `profile/README.md`
- SEO map: `docs/github-seo-content-map.md`

---
*Updated from power tower + partner ecosystem dig · Kovach Enterprises / Genesis Conductor Engine*
