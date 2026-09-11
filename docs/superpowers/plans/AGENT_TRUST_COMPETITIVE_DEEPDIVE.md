# Agent Trust / Endpoint Attestation — Competitive Deep Dive
**Date:** 2026-09-11 · **Owner:** Genesis Conductor (Kovach JV) · **Session:** Omen Alpha
**Inputs:** live CDP Bazaar index snapshot (13,490 listings, `bazaar.json`); prior analysis
`MARKET_VERTICAL_ANALYSIS_2026-09-08.md`; shipped SKUs `gc-workers/x402-paid-service` `/api/attest` ($0.10) and `/api/attest-audit` ($2.50).

---

## Method

1. **Cluster extraction.** Filtered all 13,490 Bazaar listings on `(verif|attest|proof|reputation|trust|kyc|identity|scam|rug|honeypot|uptime|monitor)` against resource + description. Broad match: **1,852 listings** (our regex also sweeps verification-adjacent data work). Strict word-boundary match (`verify|verification|verified|attest|attestation|proof|reputation|trust|trusted|kyc|identity|scam|rug|honeypot|uptime|monitor`): **1,484 listings across 453 unique domains**, median **$0.01**, p90 **$0.15**, **51 listings ≥ $1**. (Prior report's 570 used a narrower keyword set; both counts are internally consistent — the cluster is bigger than first estimated but prices are unchanged.)
2. **Sub-vertical classification** by description regex, first-match priority: scam/token safety → KYA/agent identity → uptime/monitor → endpoint attest/liveness → delivery proof/receipt → other.
3. **Incumbent scan** by domain repetition + description specificity (does the listing name concrete checks, prices, endpoints?).
4. **Demand evidence** via web search restricted to 2026 sources; every external claim cited, unverifiable claims marked `[UNVERIFIED]`.
5. **Benchmark** of our `attestation.ts` (268 lines, quick + audit modes) against the 5 nearest priced competitors.

---

## Sub-vertical saturation table

Prices are `maxAmountRequired` (USD6). Broad-classified counts; "other" = verification-adjacent data work, excluded from verdicts.

| sub-vertical | listings | median $ | p90 $ | credible incumbents | verdict |
|---|---|---|---|---|---|
| scam / token safety check | 272 | 0.010 | 0.200 | yes (4+) | crowded, pennies |
| KYA / agent identity | 167 | 0.010 | 0.250 | yes (4+) | crowded at low end; **paid gap at $1–5 tier** |
| uptime monitoring | 229 | 0.010 | 0.100 | partial (1 credible) | **one real incumbent** (fuchss watch); open |
| endpoint attestation / liveness | 300 | 0.010 | 0.103 | partial (2 credible) | commodity probes; **signed/ledgered attest open** |
| delivery proof / receipt | 77 | 0.010 | 0.150 | **no** | **empty** — lowest supply in cluster |
| other (verification-adjacent) | 807 | 0.010 | 0.200 | n/a | noise (FDA lookups, RSS, DNS, etc.) |

Strict-cluster extras: 453 domains compete for 1,484 listings (≈3.3 listings/domain — heavy micro-farm pollution, consistent with ForgeMesh's finding that 40% of the catalog is one wallet); only 51 trust-cluster listings price ≥ $1.

---

## Incumbent scan

**Endpoint attestation / liveness (our direct lane):**
1. `x402.fuchss.app` — trust score 0–100 grade A–F for any x402 endpoint ($0.005), raw observation history ($0.02), bulk-10 ($0.045), **30-day watch with payTo-change alerts ($0.20)**. Runs a live ecosystem report (112,872 endpoints probed: 50% unreachable, 11% non-compliant envelope). Most credible competitor; no on-chain signature.
2. `api.oblique.markets` — `/api/v1/paid/x402-endpoint-verify` $0.02: probe + lint third-party x402 endpoint; also receipt lookup $0.002, payer profile $0.01.
3. `x402.cloudpulsepoint.com` — $0.01 URL reachability + status + latency. Generic probe, no x402 parsing.
4. `anywaypossible.com` — $0.001 URL uptime/health for agents. Commodity.
5. `merchant-audit.clankerceo.workers.dev` — $0.01 "is this x402 merchant safe to pay" audit.

**KYA / agent identity:**
1. `x402.asterpay.io` — KYA Trust Score for agent wallets, 7-component 0–100 + sanctions ($0.005 quick / $0.01 deep batch). Wallet-centric, not endpoint-centric.
2. `api.craigmbrown.com` — procurement trust layer $0.01, agent reputation/settlement track record $0.01, queryable trust badge $0.01. Clearest $1–5 due-diligence seller per prior analysis.
3. `agents.dyoeway.org` — DYOE KYA pre-flight $0.10; trust check (scam/fraud/rug) $0.01.
4. `trust-agent.io` — funding-chain walk for an address $0.01.
5. `rubric-protocol.com` — attested verification-event custody $0.005 (seals that a KYC/liveness check ran; Hedera-anchored).

**Scam / token safety:** `gateway.stride20k.com` rug-check $0.15; `pulsefeed.dev` pay/avoid verdict $0.004 + bulk trust dataset $0.10 + full dataset $1; `402.com.tr` (20 listings). Saturated.

**Delivery proof / receipt — NO credible incumbent:** nearest are `api.craigmbrown.com` single-use delivery seal $0.05, `10x402.com` dispute pack $0.12 (SHA-256 attestation), `cyre.dev` Guardian Decision Receipt $0.005, `aeml-x402.zeabur.app` payment receipt token $0.03. All one-off/adjacent; nobody sells a standing paid delivery-proof ledger for x402 calls. **Sub-vertical with no credible incumbent: delivery proof/receipt; second-weakest: uptime monitoring (one player).**

---

## Demand evidence (external, 2026)

- **Total market is tiny and top-heavy.** Full-catalog measurement (Aug 2026): ~$23.5k/30d across ~15k endpoints; median endpoint earns $0.02/mo; only 27 endpoints > $50/mo; two winning shapes = money-moving rails or proprietary data an agent can't get free — "data you own or money you can move, not the commodity middle." https://agentatwork.xyz/notes/x402-economy.html
- **Independent cross-check** (Jul 2026, 25,443 resources): ~$26k/30d total, ~$7.3k of it API fees; "Identity and compliance" active segment = 48 resources, 791 calls, **$39/30d** — near-zero today; "attested data" flagged as supply lagging demand. https://philpher0x.dev/posts/x402-bazaar-market-state/
- **The trust problem is measured and huge:** of 112,872 listed endpoints, 50% unreachable, 11% of reachable ones serve a non-compliant payment envelope, only 55.5% of payTo wallets ever received payment — "the directory is mostly ghosts." Direct proof of demand for pre-pay attestation. https://x402.fuchss.app/trust/report
- **Wash/ghost traffic is real:** ~20% of x402 tx filtered as wash or idle machine traffic in real-volume accounting. https://app.barker.money/agent-economy
- **Experian Agent Trust** (Apr 2026, with Visa/Cloudflare/Skyfire): human-to-agent binding, KYA trust token, Agent Registry; explicitly human-anchored ("traces every action back to a real, verified person"). Leaves open machine-native per-endpoint verification. https://www.experian.com/business/products/agent-trust · https://www.businesswire.com/news/home/20260430719198/en/ · https://www.experian.com/blogs/insights/what-is-know-your-agent-kya/
- **Visa Trusted Agent Protocol**: RFC-9421-signed agent credentials so *merchants* verify *agents* — direction is merchant-protects-from-agent, not agent-protects-from-seller. No paid per-call verification service. https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications/ · https://github.com/visa/trusted-agent-protocol
- **FIDO AP2** (donated to FIDO Alliance, Apr 2026): checkout/payment mandates = cryptographic intent receipts; verifiable evidence layer for payments, not liveness/rail integrity of paid endpoints. https://fidoalliance.org/google-donates-agent-payments-protocol-to-fido-alliance/ · https://fidoalliance.org/building-the-trust-layer-for-agentic-payments-with-ap2-and-verifiable-intent/
- **Skyfire KYAPay**: signed kya/pay/kya-pay JWTs, USDC on Base settlement, ERC-8004 identity linkage; identity+payment envelope, again not endpoint attestation. https://skyfire.xyz/product/ · https://docs.skyfire.xyz/docs/kyapay-tokens · https://stellagent.ai/insights/skyfire-kyapay-know-your-agent
- **Machine-native paid gap:** all four incumbents bind *human identity → agent → payment intent*. None offer paid, per-call, machine-verifiable attestation that a specific **seller endpoint** is alive, https, and serves a parseable x402 rail — the check an agent needs *before* its first payment. fuchss's $0.20/30d watch and craigmbrown's $1–5 due-diligence are the only proven paid prices in that lane. [UNVERIFIED beyond sources cited]

---

## Feature benchmark table

Our shipped engine (`src/lib/attestation.ts`): quick mode = reachable, https, latency, x402 402-rail parse (header `x-payment-required` base64url AND body `accepts`, GET then POST fallback); audit mode adds latency-consistency drift and response-shape checks; A–D grading; `attested_at` + `attestor` fields.

| feature | GC attest ($0.10) | fuchss x402-trust ($0.005) | oblique verify ($0.02) | cloudpulsepoint ($0.01) | asterpay KYA ($0.01) | craigmbrown trust-layer ($0.01) |
|---|---|---|---|---|---|---|
| liveness + latency | ✅ | ✅ (catalog-crawled) | ✅ | ✅ | ❌ (wallet only) | partial (link-integrity SKU) |
| https check | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **x402 402-rail deep parse** (scheme/network/payTo/price, header+body, GET+POST) | ✅ | ✅ (envelope compliance) | ✅ | ❌ | ❌ | ❌ |
| audit mode (drift + response shape) | ✅ ($2.50) | ❌ | ❌ | ❌ | ❌ | ❌ |
| A–D grading | ✅ | 0–100 + A–F | pass/lint | raw status | tier | pass/flag |
| signed attestation (verifiable key) | ❌ | ❌ | ❌ | ❌ | ❌ (insumer.dev signs data, $0.05, not endpoints) | partial ("signed evidence" claimed) |
| historical attestation ledger / trend | ❌ | ✅ ($0.02 history) | ✅ ($0.002 receipt lookup) | ❌ | partial | ✅ (settlement track record) |
| continuous watch + change alerts | ❌ | ✅ ($0.20/30d) | ❌ | ❌ | ❌ | ❌ |
| bulk scoring | ❌ | ✅ ($0.045/10) | ❌ | ❌ | ✅ ($0.01 batch) | ❌ |
| webhook re-attestation / SLA | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Cheap gaps we could close:** signed attestations (we already hold a GC Ed25519 cert pubkey and a `verification-ledger` lib in the same Worker — currently unused by the attest path), historical lookup endpoint, continuous watch (Worker already has a `0 */6 * * *` cron), bulk tier, numeric trust score. We are the only listed competitor whose audit mode does drift + response-shape; nobody sells webhook re-attestation.

---

## Ranked recommendations (revenue per engineering hour)

**1. Signed attestations + historical ledger lookup (2 SKUs: add signature to attest output; new `/api/attest-history` at $0.01, bulk history $0.10).**
What: sign the existing `AttestationResult` with the GC Ed25519 cert pubkey (Ed25519 available in Workers via WebCrypto; publish JWK at `/.well-known/attestor-jwks.json`); persist each attestation to the existing verification ledger; expose lookup/trend by URL.
Yield mechanism: converts one-shot $0.10 probes into recurring lookups (the only recurring shape the Bazaar rewards — per agentatwork, repeat-payer data wins); a signature makes the result portable into agent-to-agent procurement disputes (what AP2/TAP call evidence), which nobody in the cluster offers. Also validates fuchss's history SKU at $0.02/call as a proven price point.
Effort: **~1–2 days** — no new probing logic, crypto + storage + one endpoint.

**2. Continuous watch tier `/api/attest-watch` at $1.00/endpoint/30d with webhook alert on verdict change or payTo drift.**
What: paid registration of a URL into the Worker cron (`0 */6 * * *` already live); each cron pass re-runs quick attestation for watched URLs, appends to ledger, fires webhook on verdict flip or `payTo` change (the #1 critical signal fuchss sells at $0.20/30d — we undercut 5× and add webhook).
Yield mechanism: highest price-per-build in the cluster; recurring by construction (the entire measured x402 API economy is one-shot); rides on the same `runAttestation` engine — pure scheduling + KV/ledger + webhook. A single 100-endpoint book ≈ $100/mo, ~5× the median trust endpoint's total.
Effort: **~2–3 days**.

**3. Numeric trust score + bulk scoring tier (`/api/attest-score` $0.05, bulk-10 $0.50) and reposition the $2.50 audit as a signed "procurement dispute pack" (SHA-256 digest over the full check set, fit for pre-purchase and dispute evidence).**
What: collapse checks into a 0–100 score (weights: rail-parse > reachable > drift > shape > https), add bulk input; package audit output with digest + signature and match TAP/AP2 evidence vocabulary.
Yield mechanism: scores are what agent loops actually branch on (fuchss and asterpay both sell scores, neither scores x402-rail quality + drift together); bulk captures dataset/re-seller demand (pulsefeed sells its whole trust dataset at $1 — proof of bulk appetite); the dispute-pack framing defends the $2.50 price against the $0.01–0.05 p90 cluster by aligning it with the only $1+ proven trust price points (craigmbrown due-diligence/audits, 10x402 dispute pack).
Effort: **~1 day** (pure derivation from existing checks + listing copy update).

Sequencing: ship 1 → 2 → 3; #2's cron reuses #1's ledger, #3's score reuses both.
