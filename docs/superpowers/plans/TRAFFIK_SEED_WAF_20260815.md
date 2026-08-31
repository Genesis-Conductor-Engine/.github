# Plan: Traefik fix + capital seed path + CF 1050 WAF

**Date:** 2026-08-15  
**Host:** diamondnode (192.168.1.228) + Mac HotPocket  
**Mode:** ops (subagent-driven-development)

## Global Constraints

- Never print secrets, private keys, recovery phrases, NWC connection secrets, or JWT tokens.
- Root treasury `0x54E2ACaB04C89A3Fe02852BF8dd69Ee8F526bC75` is **locked** — gas/sub-wallet funding only; do not agent-spend.
- HOT/flywheel: `0x60C4499870f115664d7FfD8411b023DBEf3377d9` needs ≥~2.66 ETH/WETH on Base for seed.
- Safe: `0x2AD5480D9E24Be1973019B61DAB4bbAB2f6930eB` (~0.0097 ETH; n1 second sig pending).
- Do not invent DUNS/UEI/CAGE.
- Prefer public Base RPCs; avoid Alchemy-only.
- Sudo password: never embed in scripts/logs. Prefer passwordless/NOPASSWD or human-run one-shot.
- AFK defaults: safest path; hand off reviewable artifacts.

## Task 1: Traefik Docker min-API fix

**Problem:** Traefik swarm provider uses Docker API client 1.24; engine min is 1.44 → swarm discovery fails.

**Primary (sudo):** `sudo bash ~/fix-docker-min-api-for-traefik.sh` on diamondnode sets `min-api-version: "1.24"` in `/etc/docker/daemon.json`, reloads docker, force-updates `yennefer_traefik`.

**Fallback (no sudo):** Upgrade Traefik image and/or set explicit API negotiation; or document human one-shot.

**Acceptance:**
- `docker version` shows MinAPI allowing 1.24 OR Traefik logs no longer spam "client version 1.24 is too old"
- Swarm provider retrieves services without continuous ERR

## Task 2: Capital seed path (wallet + Alby + flywheel)

**Problem:** Phase `await_weth_seed`; HOT dust; pool degenerate.

**Steps:**
1. Authenticate payments wallet (`npx awal@2.0.3 status` → login/verify if needed).
2. Report Base USDC/ETH balances and address.
3. Alby Hub: unlock/health if possible; report lightning/on-chain balances; note NWC apps without printing secrets.
4. Document executable seed paths ranked by agent capability:
   - A: Fund HOT with ≥2.66 ETH/WETH from agent-signable source
   - B: Clear Safe n1 second signature (~0.0097 ETH — still below 2.66; partial only)
   - C: Lightning/Alby sats path for tithing micro-seed (does not satisfy 2.66 ETH alone)
   - D: Human on-ramp / exchange → HOT
5. Do not move root-treasury funds. Do not broadcast spends without explicit user confirm for amounts ≥0.01 ETH.

**Acceptance:** Written seed runbook with balances, blockers, and next human action.

## Task 3: CF error 1050 WAF

**Problem:** Workers/custom hosts return 403 `error code: 1050` from Mac and diamondnode; apex genesisconductor.io may still 200.

**Steps:**
1. Query CF API: zones for genesisconductor.io, security events, firewall/WAF rulesets, IP access rules.
2. Identify rule/action causing 1050.
3. If agent-authorized: propose/apply least-privilege allow (or disable misconfigured block) for agent IPs / legitimate traffic; never open to world carelessly.
4. Validate: curl workers.dev + custom host after change.

**Acceptance:** 1050 root cause documented; either fixed with probe evidence or BLOCKED with exact dashboard steps.

## Task 4: Integration status report

Single handoff: Traefik state, seed path, WAF state, remaining human gates.
