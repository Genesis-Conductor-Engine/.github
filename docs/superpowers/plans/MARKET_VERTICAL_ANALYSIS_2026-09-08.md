# x402 Vertical Analysis — 2026-09-08 (Omen Alpha session)

## Method
- Pulled full CDP Bazaar discovery index: 13,490 listings / 1,004 unique domains.
- Bucketed by vertical keyword + price distribution (maxAmountRequired, USD6).
- Cross-referenced: Gökhan Ventures x402 economy report (Jul 2026), agentatwork.xyz live Bazaar
  revenue measurement (Aug 2026), minia2a State of Agent Economy (Aug 2026), Axis Intelligence
  agentic commerce stats (Jul 2026), Experian Agent Trust / KYA releases (Apr 2026).

## Saturation (Bazaar listings per vertical)
| vertical | listings | median$ | p90$ | verdict |
|---|---|---|---|---|
| crypto/market data | 2584 | 0.010 | 0.10 | saturated, pennies |
| payments/payroll | 1109 | 0.001 | 0.03 | commoditized |
| AI/LLM inference | 1029 | 0.010 | 0.19 | dominated by BlockRun (~$177K/30d, 82% tx) |
| search | 990 | 0.014 | 0.20 | crowded (Tavily et al) |
| verification/trust | 570 | 0.010 | 0.15 | cheap scam-check clones; delivery-proof near-empty |
| weather / scrape / geo | 415–517 | 0.010 | 0.15 | commodity |
| data enrichment | 65 | 0.010 | 0.20 | least saturated, but needs proprietary data GC lacks |

## Yield evidence (30d revenue, measured)
- Only 27 of ~15k endpoints earn >$50/mo. Two winning shapes:
  (a) money-movers taking a slice ($16k of $23k measured economy) — needs float/licenses: NO for GC.
  (b) proprietary data / trust an agent can't get free.
- High-price tail ($1+): 175/283 are inference (BlockRun territory); 10 licensing; trust/DD services
  (craigmbrown: due-diligence $1, arbitration $5, audits $5) clear $1–$5 per call.
- minia2a: accountability/verification layer = "least-built layer and the largest opportunity".
  Discovery fragmented; continuous health/delivery verification is the hard problem.
- KYA/KYB (Experian, Visa TAP, FIDO AP2) is human-centric; machine-native per-call attestation
  for agent services is unbuilt.

## Fit against GC assets
- verification-ledger lib already in x402-paid-service ✓
- attestation engines: euler-cycle-attestor, RTPTPA-QCG ✓
- agent identity: GC Ed25519 cert pubkey ✓
- No proprietary people/company dataset (rules out enrichment); no float/licenses (rules out rails);
  GPU is GTX 1650 (rules out inference competition).

## Decision: publish into AGENT TRUST / SERVICE ATTESTATION
Highest demand-vs-saturation × price ceiling ($1–$5 B2B trust clears $1+) × asset fit.
Product: paid x402 endpoint that attests a target endpoint's liveness, x402 payment-rail
integrity (402 → payment-requirement parse), and delivery, returning a structured
attestation recorded in the GC verification ledger. Tiered $0.10 quick / $2.50 full audit.
