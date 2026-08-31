# Spec: Settlement USDC outflow + diamondnode AGENTS.md redaction

**Date:** 2026-08-15  
**Requester:** execute both follow-ups via subagent-driven-development.

## S1 — Settlement USDC outflow since 2026-08-09

Produce a written, reconcilable report of USDC movement for the diamondnode **settlement** wallet on Base (8453).

| Field | Value |
|-------|--------|
| Wallet | `0x937897fe19F675c96a71078820F21cA9bD637180` |
| Token | USDC on Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) |
| Window start | `2026-08-09T00:00:00Z` |
| Window end | time of the query (UTC) |
| Opening balance (prose, 2026-08-09 notes) | 61,745 USDC |
| Live close (2026-08-15 RPC) | 54,428.133083 USDC |

Requirements:

1. List every ERC-20 Transfer of that USDC contract where `from` or `to` is the settlement wallet in the window.
2. For each transfer: UTC time, tx hash, counterparty, direction (`out` / `in`), amount in USDC (human units), and a one-line label if the counterparty is a known GC/fleet address from `~/AGENTS.md` or `/home/diamondnode/AGENTS.md` **public address table only**.
3. Totals: `sum(out)`, `sum(in)`, `net = in - out`.
4. Reconciliation: `opening + net` should be compared to live `balanceOf`. If they disagree, state the residual and the most likely cause (opening figure was approximate; transfers before 00:00Z on Aug 9; failed RPC page; etc.). Do **not** invent transfers to force a match.
5. Do not query or print private keys. Public RPC, Blockscout, or Dune SQL only. Alchemy is over monthly quota — do not use it.

Deliverable path: `docs/superpowers/plans/2026-08-15-settlement-usdc-outflow.md`

## S2 — Redact `/home/diamondnode/AGENTS.md`

The remote file contains live credentials in plaintext. Redact **values**, keep **operational facts**.

Redact (replace the secret value only):

- API keys and tokens (Alchemy `alcht_…`, Infura project ids, Coinbase RPC path tokens, GetBlock tokens, Etherscan keys, xAI keys, Slack tokens, any `sk-` / `xai-` / `dune_` / `sim_` prefixes)
- Private keys and keystore material (full `0x` + 64 hex, truncated private-key prefixes, mnemonic references that include words)
- Passwords and passcodes (keystore passwords, screen-lock digits, SSH login passwords)
- Any other bearer credential sitting next to a label like `key`, `password`, `secret`, `token`

Keep:

- Public Ethereum/Base/Sui addresses
- Contract and pool addresses
- Hostnames, ports, paths, operational runbooks
- Role labels (treasury, HOT, settlement, etc.)

Replacement form: `[REDACTED:<KIND>]` where KIND is one of `ALCHEMY_API_KEY`, `INFURA_PROJECT_ID`, `RPC_TOKEN`, `ETHERSCAN_API_KEY`, `XAI_API_KEY`, `SLACK_SECRET`, `PRIVATE_KEY`, `PASSWORD`, `PASSCODE`, `MNEMONIC`, `OTHER_SECRET`.

Process:

1. Copy the live file to `/home/diamondnode/AGENTS.md.bak.pre-redact-20260815` (do not overwrite an existing backup).
2. Write the redacted file back to `/home/diamondnode/AGENTS.md` with the same ownership/mode as before.
3. Scan the redacted file for leftover secret-shaped strings. The scan must report zero hits for: `alcht_`, `sk-`, `xai-`, `sim_`, `dune_`, `temp-password`, a 6+ digit screen-lock next to “passcode”, and untruncated `0x` + 64 hex.
4. Do **not** rotate keys, restart services, commit the remote file, or copy secret values onto the Mac or into git.
5. Local log (categories and counts only, **never values**): `docs/superpowers/plans/2026-08-15-agents-md-redaction-log.md`

## Global Constraints

- Never print, log, commit, or paste secret values (including into reports, briefs, or chat).
- Never pass private keys or API keys on a command line.
- Trust live RPC / explorer / Dune rows over prose when they disagree.
- Redact only — do not rotate, delete, or force-push.
- Stage only allowlisted `docs/` paths in the home-directory git repo.
- Conventional Commits (`docs:` / `security:`).
- Do not spawn nested reviewers or helper subagents.
