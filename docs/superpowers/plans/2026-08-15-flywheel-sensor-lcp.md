# Plan: flywheel sensors + cashflow LCP

**Date:** 2026-08-15  
**Frame:** stacked skills as sensors, one increment (not 15 products).  
**Spec authority:** keep x402 Worker dual-runtime, reuse KV `API_KEYS`, no new KV/D1, treasury locked, payTo stays HOT.

## Ruling

- **Not 15 products.** Skills are rails. Ship one increment on the existing cashflow Worker.
- **feature-dev ask-and-wait overridden** by prior yolo / do-not-ask.
- **SDD dispatch skipped** — one tightly coupled file cluster (`cashflow.ts` + `index.ts` + tests).
- **NemoClaw onboard skipped** — host is Darwin; diamondnode H(s)=OFFLOAD; no new GPU sandbox.
- **No new Express x402** — monetize-service already satisfied by `x402-paid-service`.
- **`/fork`** is GitHub `fork_repository`, not a product. No fork.
- **ens-profit-engine** is a stub. Probe only; no invented ENS flipper.
- **Alby Hub :8029 is down.** Record offline; do not start a node.
- **Alchemy CLI 0.22 monthly 429.** Worker live_rpc key is the cashflow path. Do not print keys.
- **DexPaprika wQFLOP:** token exists, **0 pools, no price**. Keep unpriced. Do not invent TVL.

## Tasks

1. Snapshot-first `/cashflow` + `/api/cashflow` (KV hit → respond, `waitUntil` refresh). Parallel wallet RPC. LCP: `id="lcp"` on h1, `content-visibility: auto` below the fold.
2. DexPaprika market marks (ETH + honest wQFLOP unpriced). Fix stale payTo=0x7cb8 assumption. MCP well-known lists cashflow tools.

## Done when

Tests green. Dashboard TTFB no longer waits on the full RPC fan-out when a KV snapshot exists.
