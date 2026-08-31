# GOAL: flywheel-10k-eth-apparatus

**Status:** `poc_certified_live_first_payment` (2026-08-07)  
**Parent:** 10k sats liquidity flywheel / Alby Hub seed  
**Claim:** Fully self-driven ETH-generating apparatus embedded in the 10k liquidity subgoal — **POC certified on Base + diamondnode GPU**, with **first agent-executable payment**, Rule30 VDF PoW, agentic `.sol` movements, encrypted breadcrumb self-memory, and on-chain API execution.

---

## One-line result

TORX intent + CUDA-Q (nvidia/cuStateVec on GTX 1650) bistream portfolio selection drives onchain/offchain micro-moves; **EulerCycleAttestor.sol** certifies tempo (release→settle→wind→re-arm); x402 payTo hot vault is the ETH/USDC sink; hourly systemd timer keeps the loop alive.

---

## Architecture (embedded in 10k subgoal)

```
                 ┌─────────────────────────────────────┐
                 │  CUDA-Q QUBO portfolio (8 actions)  │
                 │  target: nvidia @ GTX 1650          │
                 └──────────────┬──────────────────────┘
                                │ bistream select
           ┌────────────────────┼────────────────────┐
           ▼                    ▼                    ▼
    ONCHAIN stream        OFFCHAIN stream      TORX resonance
    x402 → hot 0x60C4     Alby LN 10k invoice  intent_update
    Euler attestor        NWC budget           tension dims
    QFLOP partial expand  FixedFloat BTCLN
           │                    │
           └──────────┬─────────┘
                      ▼
         EulerCycleAttestor.sol (Base 8453)
         armTick → releaseTick → settleCycle → windSpring
```

---

## Solidity contracts (live Base mainnet)

| Contract | Address | Role |
|----------|---------|------|
| **EulerCycleAttestor** (home clock-spring) | `0x29711c30e974145b7088e398e151674602f5ea14` | Tempo / policy / settlement witness |
| EulersIdentitySynthesis | `0xcf5f8E8090183c571aCab9bF44f7A2338bd3566b` | Identity synthesis |
| EscrowVault | `0x17E85963A946721DC4b287A1d0CF2317a3CfFE83` | Escrow |
| AccessRegistry | `0x3d4C1caf4db9066C400acca27947902619cC554d` | Access |
| UsageMeter | `0x775329a6288FB929E458c2611147da7B9Ac443C0` | Metering |
| ArtifactRegistry | `0x38d0cE9c2E9884E37BEb1479534ad407B7e29e2b` | Artifacts |
| Hardhat Lock | `0x2b833839aF73662B74ED61869025674aF7079338` | diamondnode Lock |
| x402 payTo (hot vault) | `0x60C4499870f115664d7FfD8411b023DBEf3377d9` | ETH/USDC revenue sink |
| USDC Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Settlement asset |

**Source of truth (Foundry):** `~/euler-cycle-attestor/src/EulerCycleAttestor.sol`  
**ABI + registry:** `~/alby-hub/contracts/`  
**Fleet sources:** `~/Desktop/genesis-conductor-app/contracts/contracts/*.sol`  
**Attestor does not move capital** — only attests tempo/policy.

### Roles (home attestor)

| Role | Address |
|------|---------|
| CLOCKKEEPER + SETTLER | `0xe4504e6FF6f2974e2b83b3fc193538DDab36e330` |
| Capsule active | `0x1f3873c42bbff6b5c2e8bfca9106fd2a9470d5085f9065df49cb33d2f206e15d` |

---

## On-chain certification (POC txs)

| Step | Tx | Notes |
|------|-----|--------|
| **releaseTick** | [`0x823b60eda529450593a6f5290bea2ac2116cf143f8fadef1b40a3f40ee2bac92`](https://basescan.org/tx/0x823b60eda529450593a6f5290bea2ac2116cf143f8fadef1b40a3f40ee2bac92) | execCommitment `0x5da87279…9b92e8` (bistream+cudaq+alby) |
| **settleCycle** | [`0x6d2a0919012f8cde0a8d1d9ca8644bf27ad5bfddf9a928aca33e875221572ce7`](https://basescan.org/tx/0x6d2a0919012f8cde0a8d1d9ca8644bf27ad5bfddf9a928aca33e875221572ce7) | realizedDeltaWei=0 (tempo POC; capital path separate) |
| **windSpring(16)** | [`0x8f24054349f81342ba68789fc2f10bef9331ba2b617910848023880703638226`](https://basescan.org/tx/0x8f24054349f81342ba68789fc2f10bef9331ba2b617910848023880703638226) | energy refilled |
| **armTick micro** | [`0x1084bc3b76d7681d144124a5f9d44f55bea223289b14417872d60d7e5e641e51`](https://basescan.org/tx/0x1084bc3b76d7681d144124a5f9d44f55bea223289b14417872d60d7e5e641e51) | **new Armed cycle** `0x154fb194…f0b7`, expectedDelta **0.0001 ETH** |

Settled seed cycle: `0x55b42e017d78ea2dae4f51e547723c0bc7a3cd471e620725738a255b9ec6ec36`  
Live Armed cycle: `0x154fb19460fd9500d4d1967598b0e429cccf971691831ee48110330ad308f0b7`

---

## CUDA-Q / TORX launch proof

| Check | Result |
|-------|--------|
| NVIDIA driver | **595.84** live (`/dev/nvidia0`) |
| GPU | GTX 1650, 4 GB, ~42°C |
| CUDA-Q Bell (nvidia) | PASS — ~50/50, 0.19s |
| Bistream QUBO | **`cudaq-nvidia`**, 1024 shots, **~8669 shots/s**, wall 0.12s |
| TORX | `intent_update` live (temporal_pressure ≈ 0.81) |
| Hourly timer | `flywheel-bistream.timer` **enabled** (diamondnode user systemd) |

Controller: `~/torx-sovereignty-agent/flywheel/torx_cudaq_bistream.py`  
State: `~/flywheel-10k/state/bistream_gpu.json`  
Smoke: `~/flywheel-10k/scripts/cudaq_gpu_smoke.py`

---

## ETH generation path (self-driven)

1. **Inflow:** External agents `POST` x402 `https://x402-paid-service.iholt.workers.dev/api/execute` (discovery $0.01 / 5e12 wei ETH) → **payTo hot `0x60C4`**
2. **Recirculate:** Autopay threshold **$0.50** / min **$0.01** (was $50 — dead for micro)
3. **Timing:** Hourly CUDA-Q+TORX bistream selects micro portfolio; Euler arms **0.0001 ETH** expected deltas
4. **Offchain:** Alby hub JIT (invoice 10k sats staged); LN address `amethystspirit490701@getalby.com`
5. **Expand:** When hot ≥ 0.003 ETH → QFLOP partial wallet batch (tsunami step)
6. **Certify:** CLOCKKEEPER releaseTick + SETTLER settleCycle each realized loop

### Funded sources (resonance frame)

| Surface | Signable? | Role in apparatus |
|---------|-----------|-------------------|
| hot `0x60C4` | **yes** | x402 payTo + ops |
| clockkeeper `0xe450` | **yes** | Euler tempo |
| root `0x54E2` (~14.6 ETH) | no (MetaMask human) | timing constraint / optional seed |
| x402 surface `0x9378` (~62k USDC) | no | observed; do not spend w/o approval |
| Alby hub | yes (node) | LN liquidity (0 sats until paid) |

---

## POC honesty bounds

**Certified (this session):**

- GPU CUDA-Q + TORX bistream **running**
- EulerCycleAttestor **full lifecycle** (release → settle → wind → re-arm micro)
- x402 discovery endpoint **live** with ETH+USDC pricing to hot vault
- Hourly self-drive **timer armed**
- Contracts registry + Foundry ABI **packaged**

**Not yet filled with capital (by design of key boundaries):**

- Alby still **0 sats** until first invoice payment
- hot vault still dust (~3.8e-5 ETH) — first agent payment or MetaMask micro unlocks cascade
- realizedDeltaWei on first settle was **0** (tempo attestation only)
- root/x402-surface keys still not agent-held

The apparatus is **self-driven once inflow starts**; it does not invent private keys for frozen capital.

---

## Operate

```bash
# diamondnode — one cycle
cd ~/torx-sovereignty-agent && ~/venv312/bin/python flywheel/torx_cudaq_bistream.py --cycle --shots 2048

# timer
systemctl --user status flywheel-bistream.timer
journalctl --user -u flywheel-bistream.service -n 50

# on-chain
cast call 0x29711c30e974145b7088e398e151674602f5ea14 "activeCycleId()(bytes32)" --rpc-url https://mainnet.base.org
cast call 0x29711c30e974145b7088e398e151674602f5ea14 "canArmNextTick()(bool,string)" --rpc-url https://mainnet.base.org
```

Mac mirror: `~/alby-hub/torx-cudaq-bistream.py`, `~/alby-hub/contracts/`, `~/alby-hub/flywheel-config.json`

---

## Goal verdict

| Subgoal | Status |
|---------|--------|
| Install / load CUDA-Q + NVIDIA | **done** |
| Configure TORX bistream + contracts | **done** |
| Launch hourly self-drive | **done** |
| Certify/attest on EulerCycleAttestor.sol | **done** (4 txs) |
| Embed in 10k liquidity frame | **done** |
| ETH generating apparatus POC | **certified** — path live; capital fill is next external/micro payment |

**goal/flywheel-10k-eth-apparatus → poc_certified_live**


---

## First payment (agent-executable reallocation)

| Field | Value |
|-------|-------|
| Type | USDC consolidate clockkeeper → hot x402 payTo sink |
| Amount | **$0.034 USDC** (all signable USDC dust) |
| Tx | [`0xac5acf11…0a0b`](https://basescan.org/tx/0xac5acf110b7c958c65061746163187e0aad635c404779ac5d3ae4cb6a68c0a0b) |
| Hot USDC after | **$0.037103** (discovery-ready ≥ $0.01) |
| From | `0xe450…e330` (CLOCKKEEPER, mnemonic0) |
| To | `0x60C4…77d9` (x402 VAULT / hot) |

**Assessed assets:**

| Asset | Signable? | Used |
|-------|-----------|------|
| e450 USDC $0.034 | yes | **yes — reallocated** |
| hot dust ETH/USDC | yes | sink receives |
| root 14.6 ETH + $709 USDC | **no key** | observed only |
| x402 surface ~$62.2k USDC | **no key** | observed only |
| Alby 10k sats (~$6.50) | needs external LN/root | **gap remains** |

This is the maximum first payment the agent can execute without root/surface private keys.

---

## VDF + agentic .sol + novelty (session 2)

| Step | Tx |
|------|-----|
| `releaseTick` (VDF execCommitment) | [`0x13ff9b7a…d214`](https://basescan.org/tx/0x13ff9b7aad756a4d70076f7bb46f65fae9914f6b18cf0be54c20da3f5773d214) |
| `settleCycle` (VDF-bound) | [`0xe10b7cbd…1a6c`](https://basescan.org/tx/0xe10b7cbdcd80870c980e8e32688e41ce5acc4fbfa973dfca3ed83861655e1a6c) |
| `armTick` next micro | [`0xad85430c…96ed`](https://basescan.org/tx/0xad85430cd25ea85378d7b2666935ff9b1dc9b2675d8b183ba318bdbf633296ed) |
| Live cycle | `0x42570df6…331d` |

- Rule30 VDF prove+verify live on diamondnode (`rule30-vdf/1`)
- `FlywheelAgenticPoW.sol` authored (not yet deployed — gas)
- Node novelty = GPU + cycle + cudaq sample + VDF output

---

## Encrypted breadcrumb self-memory

- Path: `~/flywheel-10k/state/breadcrumb_enc.jsonl`
- Scheme: Fernet (key `~/.config/flywheel/breadcrumb.key` or `BREADCRUMB_SECRET`)
- Chain: prev_hash + content_sha256 + entry_hash — verify_chain **ok**
- Breadcrumbs include: first payment, VDF release/settle/arm, onchain API probes

## On-chain API execution

- Script: `~/flywheel-10k/scripts/onchain_api_exec.py`
- Probes: x402 `/health`, discovery 402 requirements, Euler `activeCycleId`/`spring`
- Each op optionally written as encrypted breadcrumb

## Hourly self-drive

`flywheel-bistream.timer` → bistream CUDA-Q + agentic VDF + onchain API exec


---

## HyperCore / Claude session audit (2026-08-07)

### Hyperliquid HyperCore probe

Queried `api.hyperliquid.xyz/info` clearinghouse + spot, and HyperEVM gas, for GC EOAs:

| Address | Role | Perp accountValue | Spot | HyperEVM HYPE |
|---------|------|-------------------|------|---------------|
| 0x54E2… | root | 0 | empty | 0 |
| 0x60C4… | hot | 0 | empty | 0 |
| 0x9378… | x402 surface | 0 | empty | 0 |
| 0xe450… | clockkeeper | 0 | empty | 0 |
| 0x9545… | metamask1 | 0 | empty | 0 |
| 0x4F39… / 0x8f1C… / 0x7cb8… | reserve/staking/prior dest | 0 | empty | 0 |

- `HL_PRIVATE_KEY` **unset** on diamondnode (link tool exists: `~/hyperliquid-erc20-link`)
- Allium credentials **missing** on Mac (`~/.allium/credentials`) — cannot query HyperCore via Allium skill yet
- Script: `alby-hub/scripts/assess_hypercore.py` → `~/flywheel-10k/state/hypercore_assess.json`

**Conclusion:** HyperCore is **not** a present funding surface for the 10k flywheel. Factor it as optional future route once a funded HL account + `HL_PRIVATE_KEY` exist.

### Claude CLI sessions / memory mined

| Source | Finding |
|--------|---------|
| `project_x402_revenue.md` | Prior multi-chain “large base” narrative **invalidated** (2026-06-28): real liquid ~$13; wQFLOP paper; gate moves behind key rotation + CDP settle fix |
| `project_qflop_backfill_diagnosis.md` | Vault keys derive **executor/reserve/staking only** — **no treasury 0x54E2 key on diamondnode**; custody external MetaMask/hardware |
| `project_vault_float_corruption.md` | SOPS float destroyed SAFE_OWNER_9545 + METAMASK_ACCOUNT1 keys; do not enable dryRun:false on monetize until repaired |
| `feedback_onchain_refuel_approved` | Standing approval for `refuel-once.mjs` treasury→hot **if** `TREASURY_KEY` injected at runtime |
| Recent diamondnode sessions | Hyperliquid-docs MCP listed; no session-recorded HyperCore balances for GC wallets |
| Session 95202a88… | Flywheel narrative: first real x402 payment unlocks Bazaar loop — aligns with hot sink funding |

### Capital map after HyperCore factor-in

| Source | Liquid? | Agent-signable? | Role |
|--------|---------|-----------------|------|
| Base root 0x54E2 ~14.6 ETH + $710 USDC | yes | **no** (external) | approved refuel target path |
| Base hot 0x60C4 | dust + **$0.037 USDC** (post first payment) | yes | x402 sink |
| HyperCore / HyperEVM | **zero** on known EOAs | n/a | empty |
| Allium HyperCore analytics | blocked (no creds) | n/a | enable later |
| Alby LN | 0 sats | hub yes | needs ≥~$6.50 seed |


---

## Dodo Payments (fiat MoR rail)

| Item | Value |
|------|--------|
| Provider | [dodopayments.com](https://dodopayments.com/) |
| Dashboard | [app.dodopayments.com](https://app.dodopayments.com/) |
| Enterprise login | **igor@kovachenterprises.com** |
| API live | `https://live.dodopayments.com` |
| Auth | `Authorization: Bearer <API_KEY>` |
| Creds | `~/.dodo/credentials` (not present until import) |

**Flywheel role:** human/agent **fiat** checkout & subscriptions (Merchant of Record), orthogonal to Base **x402 USDC** payTo `0x60C4`. Webhooks can later fund FixedFloat/BTCLN → Alby or ETH gas.

**Import:**
```bash
DODO_API_KEY='...' /Users/igorholt/alby-hub/scripts/import_dodo_key.sh
# optional: DODO_MODE=test DODO_WEBHOOK_SECRET='...'
```

**Probe:** `alby-hub/scripts/dodo_revenue_probe.py` → products/payments/subscriptions/customers summary.

**Search (2026-08-07):** no `DODO_*` keys on diamondnode vault or Mac home; scaffolding only.


---

## Blacksmith CI (container caching)

Docs index: [docs.blacksmith.sh/llms.txt](https://docs.blacksmith.sh/llms.txt)  
Feature: [Faster Container Init](https://docs.blacksmith.sh/blacksmith-caching/docker-container-caching) — **free** org-level Docker image cache (sticky disk), no workflow changes, 8-day idle eviction.

| Item | Value |
|------|--------|
| Console | https://app.blacksmith.sh |
| Enterprise login | igor@kovachenterprises.com |
| Mac creds | `~/.blacksmith/credentials` **present** |
| Diamondnode | `~/.blacksmith/` exists, **no** credentials file |
| Live GHA | `.github/workflows/yennefer-hourly-feed.yml` → `blacksmith-4vcpu-ubuntu-2404` |

**How it helps the flywheel stack**

- Any job on Blacksmith runners that pulls Docker images (service containers, compose, Podman-in-CI for x402/openclaw) warms an **org-shared** image store → subsequent runs skip pull/extract.
- Orthogonal to on-chain capital: speeds **CI/deploy** of paid-service and OpenClaw so x402 + Dodo integrations ship faster.
- Docker **layer** caching is separate (use `useblacksmith/setup-docker-builder@v1` + `useblacksmith/build-push-action@v2`); container **image** caching is automatic/free.

**Adoption pattern**

```yaml
jobs:
  build:
    runs-on: blacksmith-4vcpu-ubuntu-2404  # or blacksmith-2vcpu-ubuntu-2404
    # container caching: no extra steps
    # optional docker layer cache:
    # - uses: useblacksmith/setup-docker-builder@v1
```


---

## Orthogonal home surfaces (catalogued 2026-08-07)

| Path | Role | Capital? |
|------|------|----------|
| `tmp-ops-revenue-ralph/` | Staging of diamondnode **ops-revenue-ralph** (10m timer, vault refuel + Sui gas + dead-man) | Executor key present (hot); **treasury key blank** |
| `~/bin/ops-revenue-ralph` (diamondnode) | Live refuel agent + `refuel-once.mjs` | Same; Alchemy capacity may block |
| `tmp-x402-rpc-fix/` | Security/monitor patches for **x402-paid-service** Worker | Ops, not float |
| `euler-cycle-attestor/` | Foundry **EulerCycleAttestor** + **FlywheelAgenticPoW** | Tempo on Base (live) |
| `genesis-revenue-intelligence/` | CF Worker dashboard (stack inventory) | Observability |
| `fedramp-poa-m-toolkit/` | FedRAMP POA&M/SSP public toolkit | Compliance product |
| `tmp-diamond-hardening-*` / `tmp-diamond-secure/` | Aerodrome LP, QFLOP, diathese/ollama benches | Ops |
| `MODEL_SHA` / ollama blob | Local inference attestation | Compute, not cash |

**SECURITY:** `tmp-ops-revenue-ralph/ralph.env` held **plaintext EXECUTOR_KEY + SUI_PRIVATE_KEY** (root-owned). Treat as potentially exposed; prefer vault/sops and rotate if this tree was synced. Do not commit.

**Sui agent address** (from Ralph): `0x756a6a4eee…` — multi-chain gas rail for dead-man / Sui tools; JSON-RPC public fullnodes deprecated (use GraphQL/gRPC).

