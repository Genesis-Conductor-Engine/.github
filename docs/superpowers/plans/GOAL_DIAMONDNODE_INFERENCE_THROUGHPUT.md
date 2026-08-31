# Goal: Diamondnode Inference Throughput — GTX 1650 + THRML + CUDA-Q

**ID:** `goal/diamondnode-inference-throughput`  
**Status:** `not_reached`  
**Priority:** Tier 0 — inference production capacity  
**Opened:** 2026-07-30  
**Hardware:** diamondnode (192.168.1.228) · GTX 1650 4GB GDDR5 · i5-9400F · Ubuntu 26.04 LTS  
**Stack:** THRML (JAX Ising) + HuggingFace Transformers + CUDA-Q (quantum solvers) + Ollama

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                 diamondnode (GTX 1650)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Ollama   │  │  THRML   │  │    CUDA-Q        │   │
│  │ (GGUF Q4) │  │(JAX Ising│  │ (QAOA / QUBO     │   │
│  │ LLM inf.  │  │ sampling)│  │  solvers)         │   │
│  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │
│       │             │               │               │
│       └─────────────┼───────────────┘               │
│                     │                               │
│          ┌──────────▼──────────┐                    │
│          │    THRML Daemon     │                    │
│          │  (port :5192)       │                    │
│          │  CSID diffusion     │                    │
│          └──────────┬──────────┘                    │
│                     │                               │
│          ┌──────────▼──────────┐                    │
│          │   Control Server    │                    │
│          │  (port :5191)       │                    │
│          └──────────┬──────────┘                    │
└─────────────────────┼───────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
    Cloud Agents              External APIs
    (supervision,             (Twitter Spaces,
     guidance)                web intent)
```

---

## Subgoals

### SG-1 — Open-source model selection & deployment (GTX 1650, 4GB VRAM)

| Item | Target | Status |
|------|--------|--------|
| Select primary model for INT4 on 4GB VRAM | Candidate shortlist evaluated | **in progress** |
| Deploy via Ollama with CUDA acceleration | `ollama pull <model>` on diamondnode | **pending** |
| Quantization baseline (INT4 NF4 / Q4_K_M) | ~2-3 GB VRAM, 8-10 tok/s | **pending** |
| Fallback CPU offload for larger context windows | llama.cpp + partial offload | **pending** |

**Recommended candidates (ranked):**

| Model | Params | VRAM Q4 | TPS (GTX 1650) | Why |
|-------|--------|---------|-----------------|-----|
| **Phi-4-mini-instruct** | 3.8B | ~2.5 GB | 9-10 | MIT license, best reasoning-per-param, native 128K context |
| **Gemma 3 4B** | 4B | ~3 GB | 8-9 | Apache 2.0, 140+ languages, function-calling built-in |
| **Llama 3.2 3B** | 3B | ~2 GB | 10-12 | Apache 2.0, fastest on 4GB, general-purpose |
| **Qwen 2.5 7B (Q4)** | 7B | ~5 GB | 5-6 | Tight fit, may need partial CPU offload, best multilingual |
| **DeepSeek-R1-Distill-Qwen-7B (Q4)** | 7B | ~5 GB | 5-6 | Best reasoning, tight VRAM fit |

**Inkling** (975B/41B active MoE, Apache 2.0) is **too large** for GTX 1650 — requires 600GB+ VRAM. Inkling-Small (276B/12B active) not yet released as of 2026-07-30. Monitor for release.

### SG-2 — THRML + CSID diffusion integration

| Item | Target | Status |
|------|--------|--------|
| Install THRML + JAX on diamondnode GPU | `pip install thrml jax[cuda12]` | **pending** |
| Verify THRML CSID daemon uses GPU (`hasThrml=True`, `hasJax=True`) | `/api/evolve` response | **pending** |
| Benchmark Ising sampling throughput (THRML vs NumPy fallback) | tok/sec on GTX 1650 | **pending** |
| Dynamic THRML sampling: variable temperature schedule from LLM output | CSID conditioned on LLM embedding | **design** |

The CSID diffusion already has a `prefer_thrml=True` pathway that uses JAX-accelerated Ising sampling. On GTX 1650, JAX will use CUDA for GPU-accelerated matrix operations, enabling ~10-50x speedup over NumPy Gibbs for Ising models with N=48-512 spins.

### SG-3 — CUDA-Q quantum solvers + QUBO routing

| Item | Target | Status |
|------|--------|--------|
| Install CUDA-Q on diamondnode | `pip install cudaq` | **pending** |
| QAOA QUBO solver on GPU | CUDA-Q Solvers library | **pending** |
| Route optimization problems to QUBO via Ising transform | THRML ↔ QUBO bridge | **design** |
| RL-assisted annealing for dynamic QUBO | RL agent tunes annealing schedule | **research** |

CUDA-Q (`pip install cudaq`) provides GPU-accelerated quantum circuit simulation and hybrid quantum-classical solvers (VQE, QAOA, QUBO). The GTX 1650 lacks Tensor Cores but still provides CUDA acceleration for small-to-medium QUBO instances (up to ~2000 variables via JAX-based annealing).

**THRML ↔ QUBO bridge:** Ising models are directly mappable to QUBO (`x_i = (s_i + 1)/2`). The existing THRML Ising sampler can be repurposed as a QUBO solver backend, routing optimization tasks through the CSID daemon.

### SG-4 — Cloud agent supervision network

| Item | Target | Status |
|------|--------|--------|
| Cloud agents monitor diamondnode inference health | `/api/health` endpoint | **pending** |
| Agent-guided model selection (intent → optimal model) | Router agent | **design** |
| Agent-supervised QUBO annealing iteration | RL agent tunes params | **research** |
| Auto-scale: cloud → diamondnode → edge cascade | Intent-surface Worker | **design** |

### SG-5 — Inference throughput baseline & benchmark

| Item | Target | Status |
|------|--------|--------|
| Measure total inference ops across all cloud agents (current) | Baseline TPS | **pending** |
| Measure diamondnode TPS after model deployment | Target TPS | **pending** |
| Compare against Claude Pro, ChatGPT Business, Grok weekly throughput | Ratio | **pending** |
| Publish benchmark to GitHub / Postman / HuggingFace | Public benchmark | **pending** |

**Current cloud agent inference throughput (estimated):**
- Claude Pro subscription: ~45 RPM (rate-limited)
- ChatGPT Business: ~60 RPM (rate-limited)
- Grok: ~30-50 RPM (rate-limited)
- diamondnode target: **10+ tok/s** (Phi-4-mini Q4 on GTX 1650) = 600+ tok/min continuous

With THRML dynamic sampling + CUDA-Q routing, the **theoretical ceiling** on GTX 1650 exceeds all three subscription services for sustained throughput, at the cost of per-response quality variance from the smaller model.

---

## First Milestone

1. SSH diamondnode and install: Ollama, Phi-4-mini (Q4), THRML, JAX CUDA, CUDA-Q
2. Run `ollama pull phi-4-mini:q4_K_M` and benchmark: `ollama run phi-4-mini "hello" --verbose`
3. Verify THRML daemon uses GPU: `curl http://127.0.0.1:5192/api/csid | jq '.hasThrml'`
4. Count active inference operations:
   - Poll all registered cloud agent endpoints
   - Sum recent inference calls across intent-surface, x402, Shopify, CSID
   - Report total TPS across the fleet
5. Record baseline, then deploy model, re-benchmark

---

## Success criteria (`reached`)

1. Open-source LLM running on diamondnode GTX 1650 with ≥8 tok/s sustained throughput
2. THRML CSID daemon using GPU acceleration (`hasThrml=True`, `hasJax=True`)
3. CUDA-Q installed with working QUBO solver example
4. Cloud agent supervising inference loop (health monitoring, model routing)
5. Published benchmark (GitHub gist or HuggingFace dataset) comparing diamondnode TPS vs Claude Pro / ChatGPT Business / Grok
6. Dynamic THRML sampling conditioned on LLM output embeddings

---

## Non-goals

- Running Inkling (975B) or other >10B models on GTX 1650 (requires 600GB+ VRAM)
- Replacing cloud subscriptions entirely (diamondnode augments, doesn't replace)
- Building a general-purpose QPU (CUDA-Q simulates quantum, doesn't replace hardware)
- Publishing private keys or vault credentials in benchmarks

---

## Related surfaces

| Doc | Role |
|-----|------|
| `gc-workers/stream-virtual-experience/` | THRML CSID daemon + control server |
| `gc-workers/thrml/` | THRML Ising sampling library |
| `gc-workers/intent-surface/` | Cloud agent edge Worker |
| `gc-workers/x402-paid-service/` | x402 payment protocol (inference monetization) |
| `AGENTS.md` | diamondnode SSH + fleet commands |

---

## Status log

| Date | Event |
|------|--------|
| 2026-07-30 | Goal opened. ARTIQ/WR stack verified (14/14 tests pass, TS builds clean). Inkling identified as too large (975B). Phi-4-mini selected as primary candidate (3.8B, fits 4GB VRAM at Q4). CUDA-Q identified as quantum solver platform. Existing THRML Ising sampler bridges to QUBO. |
