# intent-surface (Cloudflare)

Edge host for **Web Intent Inference** + **CSID** (contextual semantic interference diffusion) with optional **Workers AI Kimi**.

## URLs

| Route | Purpose |
|-------|---------|
| `/` | Redirect → overlay for default Space |
| `/web-intent-inference.html?space=ID` | Overlay UI (form + CSID + ARTIQ timeline) |
| `/api/health` | Worker health |
| `/api/space` | GET/POST current Space |
| `/api/csid` | Edge Ising CSID (`?space=&intent=&kimi=1`) |
| `/api/evolve` | WR + ARTIQ kernel + Ralph metrics dry (`?space=&steps=3`); POST + `kimi` optional |
| `/api/artiq` | ARTIQ RTIO model info ([intro](https://m-labs.hk/artiq/manual/introduction.html) · [product](https://m-labs-intl.com/artiq/artiq/)) |
| `/api/artiq/kernel` | CSID kernel: WR lock → `reset` → RPC → `break_realtime` → gate/parallel/TTL |
| `/api/wr` | White Rabbit fabric status ([CERN](https://white-rabbit.web.cern.ch/)) |
| `/api/wr/sync` | PTP-style sync all slave nodes (offset/delay/lock) |
| `/api/knowledge-nodes` | Knowledge-node coins + partner registry JSON |
| `/knowledge-graph.html` | Human UI for coins + partners |

Custom domain: **`intent.genesisconductor.io`**

## Deploy

```bash
cd gc-workers/intent-surface
export CLOUDFLARE_API_TOKEN='…'   # or wrangler login
npm install
npm run deploy
```

Optional secret/vars:

```bash
# Live THRML daemon origin (if tunnel exposes :5192/api/csid)
npx wrangler secret put CSID_ORIGIN   # e.g. https://….trycloudflare.com
```

## OpenCode model (Cloudflare Kimi)

Workers AI models (need CF token via `/connect` Cloudflare Workers AI):

- `cloudflare-workers-ai/@cf/moonshotai/kimi-k2.7-code`
- `cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6`

OpenCode Go Kimi K3 (not Workers AI): `opencode-go/kimi-k3`

## Local

```bash
npm run dev   # wrangler dev → http://127.0.0.1:8787
```

Pair with local THRML CSID daemon on `:5192` for origin-grade sampling.
