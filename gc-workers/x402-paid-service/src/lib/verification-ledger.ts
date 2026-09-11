/**
 * Static verification ledger (2026-09-03 sweep). HTML is a document, not a
 * live explorer. Source verification is still blocked on missing Solidity.
 */
import { chatbotEmbedSnippet } from './chatbot-embed';

export function buildVerificationLedgerHtml(widgetId?: string): string {
  const chatbot = chatbotEmbedSnippet(widgetId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="Genesis Conductor verification ledger: three unverified Base contracts, none on Ethereum mainnet, none on Solana.">
  <title>Genesis Conductor Verification Ledger</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
  <style>
  :root {
    --ground:      #f2f4f6;
    --surface:     #ffffff;
    --surface-sunk:#e9ecf0;
    --ink:         #131920;
    --ink-2:       #3d4854;
    --muted:       #6b7784;
    --hairline:    #d9dee4;
    --hairline-2:  #c3cad2;
    --brass:       #9a6b1e;
    --brass-soft:  #f0e4cd;
    --blocked:     #a3352a;
    --blocked-bg:  #f7e4e1;
    --clear:       #2c6650;
    --clear-bg:    #e0efe8;
    --inert:       #6b7784;
    --inert-bg:    #e4e8ec;
    --shadow:      0 1px 2px rgba(19,25,32,.06), 0 4px 14px rgba(19,25,32,.05);

    --f-display: "IBM Plex Sans Condensed", "Helvetica Neue", Arial, sans-serif;
    --f-body:    "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --f-data:    "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

    color-scheme: light dark;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:      #0d1116;
      --surface:     #151b22;
      --surface-sunk:#10161c;
      --ink:         #e4e9ef;
      --ink-2:       #b3bdc8;
      --muted:       #8895a3;
      --hairline:    #242d37;
      --hairline-2:  #313c48;
      --brass:       #d3a054;
      --brass-soft:  #2e2517;
      --blocked:     #e08479;
      --blocked-bg:  #33201d;
      --clear:       #74c2a3;
      --clear-bg:    #182b23;
      --inert:       #8895a3;
      --inert-bg:    #1d242c;
      --shadow:      0 1px 2px rgba(0,0,0,.4), 0 4px 14px rgba(0,0,0,.3);
      color-scheme: dark;
    }
  }

  :root[data-theme="dark"] {
    --ground:      #0d1116;
    --surface:     #151b22;
    --surface-sunk:#10161c;
    --ink:         #e4e9ef;
    --ink-2:       #b3bdc8;
    --muted:       #8895a3;
    --hairline:    #242d37;
    --hairline-2:  #313c48;
    --brass:       #d3a054;
    --brass-soft:  #2e2517;
    --blocked:     #e08479;
    --blocked-bg:  #33201d;
    --clear:       #74c2a3;
    --clear-bg:    #182b23;
    --inert:       #8895a3;
    --inert-bg:    #1d242c;
    --shadow:      0 1px 2px rgba(0,0,0,.4), 0 4px 14px rgba(0,0,0,.3);
    color-scheme: dark;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--f-body);
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  .wrap {
    max-width: 1080px;
    margin: 0 auto;
    padding: 40px 24px 96px;
    display: flex;
    flex-direction: column;
    gap: 44px;
  }

  /* ---------- masthead ---------- */
  .masthead { display: flex; flex-direction: column; gap: 18px; }

  .stamp {
    display: inline-flex; align-items: center; gap: 9px;
    align-self: flex-start;
    font-family: var(--f-data);
    font-size: 11px; font-weight: 500;
    letter-spacing: .1em; text-transform: uppercase;
    color: var(--brass);
    border: 1px solid var(--brass);
    border-radius: 2px;
    padding: 5px 10px;
  }
  .stamp::before {
    content: ""; width: 6px; height: 6px; border-radius: 50%;
    background: var(--brass);
  }

  h1 {
    font-family: var(--f-display);
    font-weight: 700;
    font-size: clamp(30px, 5vw, 46px);
    line-height: 1.05;
    letter-spacing: -.015em;
    margin: 0;
    text-wrap: balance;
  }

  .standfirst {
    max-width: 66ch;
    font-size: 17px;
    line-height: 1.55;
    color: var(--ink-2);
    margin: 0;
  }
  .standfirst strong { color: var(--ink); font-weight: 600; }

  /* ---------- verdict counters ---------- */
  .tally {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1px;
    background: var(--hairline);
    border: 1px solid var(--hairline);
    border-radius: 3px;
    overflow: hidden;
  }
  .tally-cell {
    background: var(--surface);
    padding: 18px 20px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .tally-n {
    font-family: var(--f-display);
    font-size: 40px; font-weight: 700; line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .tally-cell.hot .tally-n { color: var(--brass); }
  .tally-cell.zero .tally-n { color: var(--muted); }
  .tally-k {
    font-family: var(--f-data);
    font-size: 11px; letter-spacing: .09em; text-transform: uppercase;
    color: var(--muted);
  }
  .tally-note { font-size: 13px; color: var(--ink-2); line-height: 1.4; }

  /* ---------- sections ---------- */
  section { display: flex; flex-direction: column; gap: 16px; }

  .sec-head { display: flex; flex-direction: column; gap: 6px; }
  .eyebrow {
    font-family: var(--f-data);
    font-size: 11px; font-weight: 500;
    letter-spacing: .12em; text-transform: uppercase;
    color: var(--brass);
  }
  h2 {
    font-family: var(--f-display);
    font-weight: 600;
    font-size: 25px; line-height: 1.15;
    letter-spacing: -.01em;
    margin: 0;
    text-wrap: balance;
  }
  h3 {
    font-family: var(--f-display);
    font-weight: 600; font-size: 17px; line-height: 1.25;
    margin: 0;
  }
  .sec-head p { margin: 0; color: var(--ink-2); max-width: 68ch; }

  /* ---------- register rows ---------- */
  .register { display: flex; flex-direction: column; gap: 10px; }

  .row {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 3px;
    padding: 16px 18px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px 20px;
    align-items: start;
  }
  .row.flag { border-left: 3px solid var(--blocked); }
  .row.calm { border-left: 3px solid var(--hairline-2); }
  .row.good { border-left: 3px solid var(--clear); }

  .row-id { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .row-name {
    font-family: var(--f-display);
    font-weight: 600; font-size: 16px; line-height: 1.2;
  }
  .addr {
    font-family: var(--f-data);
    font-size: 12.5px;
    color: var(--ink-2);
    word-break: break-all;
    line-height: 1.45;
  }
  .addr a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--hairline-2); }
  .addr a:hover { color: var(--brass); border-bottom-color: var(--brass); }
  .addr a:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; border-radius: 2px; }

  .pill {
    font-family: var(--f-data);
    font-size: 10.5px; font-weight: 500;
    letter-spacing: .07em; text-transform: uppercase;
    padding: 4px 9px; border-radius: 2px;
    white-space: nowrap;
    justify-self: end;
  }
  .p-blocked { background: var(--blocked-bg); color: var(--blocked); }
  .p-clear   { background: var(--clear-bg);   color: var(--clear); }
  .p-inert   { background: var(--inert-bg);   color: var(--inert); }

  .row-meta {
    grid-column: 1 / -1;
    display: flex; flex-wrap: wrap; gap: 6px 18px;
    padding-top: 4px;
    border-top: 1px solid var(--hairline);
    margin-top: 4px;
  }
  .fact { display: flex; gap: 6px; align-items: baseline; font-size: 12.5px; }
  .fact-k {
    font-family: var(--f-data); font-size: 10.5px;
    letter-spacing: .07em; text-transform: uppercase; color: var(--muted);
  }
  .fact-v { font-family: var(--f-data); font-size: 12.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; }

  .why {
    grid-column: 1 / -1;
    font-size: 13.5px; line-height: 1.5;
    color: var(--ink-2);
    padding-top: 8px;
  }
  .why b { color: var(--ink); font-weight: 600; }

  /* ---------- callout ---------- */
  .callout {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--brass);
    border-radius: 3px;
    padding: 18px 20px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .callout h3 { color: var(--brass); }
  .callout p { margin: 0; color: var(--ink-2); max-width: 70ch; }
  .callout p strong { color: var(--ink); font-weight: 600; }

  /* ---------- prose lists ---------- */
  ul.plain { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  ul.plain > li {
    display: grid; grid-template-columns: 14px minmax(0,1fr); gap: 12px;
    color: var(--ink-2); font-size: 14.5px; line-height: 1.55;
  }
  ul.plain > li::before {
    content: ""; width: 6px; height: 6px; margin-top: 9px;
    border: 1px solid var(--hairline-2); border-radius: 50%;
  }
  ul.plain > li.stop::before { background: var(--blocked); border-color: var(--blocked); }
  ul.plain > li strong { color: var(--ink); font-weight: 600; }
  ul.plain code, p code, .why code, td code {
    font-family: var(--f-data); font-size: .88em;
    background: var(--surface-sunk); padding: 1px 5px; border-radius: 2px;
    color: var(--ink); word-break: break-all;
  }

  /* ---------- command block ---------- */
  .cmd {
    background: var(--surface-sunk);
    border: 1px solid var(--hairline);
    border-radius: 3px;
    overflow-x: auto;
    padding: 16px 18px;
  }
  .cmd pre {
    margin: 0; font-family: var(--f-data);
    font-size: 12.5px; line-height: 1.7; color: var(--ink);
    white-space: pre;
  }
  .cmd .c { color: var(--muted); }

  /* ---------- evidence table ---------- */
  .tablewrap { overflow-x: auto; border: 1px solid var(--hairline); border-radius: 3px; background: var(--surface); }
  table { border-collapse: collapse; width: 100%; min-width: 560px; }
  th, td { text-align: left; padding: 11px 16px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
  thead th {
    font-family: var(--f-data); font-size: 10.5px; font-weight: 500;
    letter-spacing: .09em; text-transform: uppercase; color: var(--muted);
    background: var(--surface-sunk); white-space: nowrap;
  }
  tbody tr:last-child td { border-bottom: none; }
  td { font-size: 13.5px; color: var(--ink-2); }
  td.mono { font-family: var(--f-data); font-size: 12.5px; word-break: break-all; font-variant-numeric: tabular-nums; }
  td.ink { color: var(--ink); }

  /* ---------- footer ---------- */
  footer {
    border-top: 1px solid var(--hairline);
    padding-top: 20px;
    display: flex; flex-direction: column; gap: 8px;
    font-size: 13px; color: var(--muted);
  }
  footer .src { font-family: var(--f-data); font-size: 12px; line-height: 1.7; }
  footer a { color: var(--brass); text-decoration: none; }
  footer a:hover { text-decoration: underline; }

  @media (max-width: 620px) {
    .row { grid-template-columns: minmax(0,1fr); }
    .pill { justify-self: start; }
  }

  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }


  .skip {
    position: absolute; left: 12px; top: 8px;
    transform: translateY(-200%);
    background: var(--surface); color: var(--ink);
    padding: 8px 12px; border-radius: 2px; z-index: 10;
  }
  .skip:focus { transform: none; }
  .theme-toggle {
    align-self: flex-end;
    font-family: var(--f-data);
    font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--brass); background: transparent;
    border: 1px solid var(--brass); border-radius: 2px;
    padding: 5px 10px; cursor: pointer;
  }
  .theme-toggle:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
  .masthead-nav { font-size: 13px; }
  .masthead-nav a { color: var(--brass); }
  section.defer { content-visibility: auto; contain-intrinsic-size: auto 28rem; }
  html[data-theme="light"] { color-scheme: light; }
  html[data-theme="dark"] { color-scheme: dark; }

  </style>
  <script>
  {
    const colorScheme = localStorage.getItem("color-scheme");
    if (colorScheme === "light" || colorScheme === "dark") {
      document.documentElement.setAttribute("data-theme", colorScheme);
      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) meta.setAttribute("content", colorScheme);
    }
  }
  </script>
</head>
<body>
  <a class="skip" href="#ledger">Skip to ledger</a>
<main id="ledger">
<div class="wrap">

  <header class="masthead">
    <span class="stamp">Swept 2026-09-03 · explorer-confirmed</span>
    <div class="masthead-nav">
      <a href="/cashflow">Cashflow</a> · <a href="/hot-fund">Fund HOT</a> · <a href="/">x402 tiers</a>
    </div>
    <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false">Use dark theme</button>

    <h1 id="lcp">Genesis Conductor Verification Ledger</h1>
    <p class="standfirst">
      Every ETH and SOL address in the Genesis Conductor surface, classified by what
      verification actually applies to it. <strong>Three contracts need source verification.
      All three are on Base, none on Ethereum mainnet, and none exist on Solana.</strong>
      I could execute zero of them today — every one is blocked on missing source, not on access.
    </p>
  </header>

  <div class="tally">
    <div class="tally-cell hot">
      <span class="tally-n">3</span>
      <span class="tally-k">Base 8453 · unverified</span>
      <span class="tally-note">Deployed contracts, source not published. All deployed by the treasury EOA.</span>
    </div>
    <div class="tally-cell zero">
      <span class="tally-n">0</span>
      <span class="tally-k">Ethereum mainnet</span>
      <span class="tally-note">Nothing of yours is deployed to chain 1. The open Etherscan tab is the wrong explorer.</span>
    </div>
    <div class="tally-cell zero">
      <span class="tally-n">0</span>
      <span class="tally-k">Solana</span>
      <span class="tally-note">No <code>.sol</code> handle is minted and no Solana wallet exists. Nothing to verify yet.</span>
    </div>
  </div>

  <section>
    <div class="sec-head">
      <span class="eyebrow">Correction to canonical record</span>
      <h2>The gap page undercounts by two</h2>
    </div>
    <div class="callout">
      <h3>“One contract is deployed and unverified — wQFLOP”</h3>
      <p>
        That line in <strong>Source Verification Gap (2026-08-26)</strong> is wrong.
        <strong>QFLOP</strong> <code>0xa8F5…59c7</code> and <strong>Genesis V3</strong> <code>0x8519…205E</code>
        are also live, unverified contracts, both created by the same treasury EOA around 2026-01-24.
        The Base Treasury Sink registry lists Genesis V3 with a <code>$0.00</code> balance, which reads
        like a dormant wallet — it is a contract with a <code>startConductor()</code> entry point.
        This closes part of the registry-bounded hole that page flagged.
      </p>
    </div>
  </section>

  <section>
    <div class="sec-head">
      <span class="eyebrow">Disposition A · action required</span>
      <h2>Source verification applies — and is blocked</h2>
      <p>Contracts you deployed, live on Base mainnet (8453), with no published source. Confirmed on BaseScan today.</p>
    </div>

    <div class="register">

      <article class="row flag">
        <div class="row-id">
          <span class="row-name">wQFLOP · Wrapped QFLOP (ERC-20)</span>
          <span class="addr"><a href="https://basescan.org/address/0x69262A2D7c92c074729823B654fE7E4Cdb749747">0x69262A2D7c92c074729823B654fE7E4Cdb749747</a></span>
        </div>
        <span class="pill p-blocked">Unverified</span>
        <div class="row-meta">
          <span class="fact"><span class="fact-k">Txs</span><span class="fact-v">86,694</span></span>
          <span class="fact"><span class="fact-k">Deploy block</span><span class="fact-v">43,929,079</span></span>
          <span class="fact"><span class="fact-k">Compiler (CBOR)</span><span class="fact-v">solc 0.8.33</span></span>
          <span class="fact"><span class="fact-k">Optimizer runs</span><span class="fact-v">unknown</span></span>
        </div>
        <p class="why">
          <b>Blocker:</b> the original <code>.sol</code> was never recovered, and the metadata CID
          <code>QmXjS5…cvjbb</code> is unpinned — I tried three IPFS gateways, all 403 or timeout — so optimizer
          runs cannot be read. The repo is not publicly readable and Drive holds no matching source.
          Constructor arg is the treasury EOA, already encoded. <b>Do not submit:</b> a failed first attempt
          pollutes the verify queue, and the repo's <code>foundry.toml</code> pins 0.8.28, not the 0.8.33 the
          deployed bytecode declares.
        </p>
      </article>

      <article class="row flag">
        <div class="row-id">
          <span class="row-name">QFLOP · QFLOP Quantum Computer (ERC-20)</span>
          <span class="addr"><a href="https://basescan.org/address/0xa8F5e136aa74803B8DB377a14f79F6c8Dd3959c7">0xa8F5e136aa74803B8DB377a14f79F6c8Dd3959c7</a></span>
        </div>
        <span class="pill p-blocked">Unverified</span>
        <div class="row-meta">
          <span class="fact"><span class="fact-k">Txs</span><span class="fact-v">117</span></span>
          <span class="fact"><span class="fact-k">Creator</span><span class="fact-v">treasury EOA</span></span>
          <span class="fact"><span class="fact-k">Age</span><span class="fact-v">~222 days</span></span>
          <span class="fact"><span class="fact-k">Compiler</span><span class="fact-v">not yet read</span></span>
        </div>
        <p class="why">
          <b>Not in the gap page at all.</b> The underlying token that wQFLOP wraps, and the thing the
          267.35M supply figure is booked against. No source located. Read its CBOR metadata for the
          compiler before touching it — do not assume it matches wQFLOP's 0.8.33.
        </p>
      </article>

      <article class="row flag">
        <div class="row-id">
          <span class="row-name">Genesis V3 · Conductor entry point</span>
          <span class="addr"><a href="https://basescan.org/address/0x851936cA8874c05f1eDc2f5Fc2e6A3Cd97c7205E">0x851936cA8874c05f1eDc2f5Fc2e6A3Cd97c7205E</a></span>
        </div>
        <span class="pill p-blocked">Unverified</span>
        <div class="row-meta">
          <span class="fact"><span class="fact-k">Txs</span><span class="fact-v">1</span></span>
          <span class="fact"><span class="fact-k">Selector</span><span class="fact-v">0x213a1ddd</span></span>
          <span class="fact"><span class="fact-k">Method</span><span class="fact-v">startConductor()</span></span>
          <span class="fact"><span class="fact-k">Deployed</span><span class="fact-v">2026-01-24</span></span>
        </div>
        <p class="why">
          <b>False lead ruled out.</b> Drive holds <code>Genesis.sol</code> (310 bytes, saved 2026-01-24 — same day
          as deployment). It is <b>not</b> this contract. That file declares <code>emitEvent()</code>
          (<code>0x7b0cb839</code>) and <code>CREDIT_PURCHASE</code>; the deployed contract answers
          <code>startConductor()</code> (<code>0x213a1ddd</code>) and emits
          <code>ConductorStarted(address indexed, uint256)</code> — I recomputed the keccak of that signature and it
          matches the on-chain topic0 <code>0x425845ef…</code> exactly. Submitting the Drive file would fail.
          The operator recorded in that event is the MPC Vault, not the treasury.
        </p>
      </article>

    </div>
  </section>

  <section>
    <div class="sec-head">
      <span class="eyebrow">Disposition B · no action</span>
      <h2>Verification does not apply</h2>
      <p>Wallets have no source to publish; undeployed contracts have nothing to verify against. Neither is verification work.</p>
    </div>

    <div class="register">

      <article class="row calm">
        <div class="row-id">
          <span class="row-name">Treasury sink — EOA (ops: TREASURY_SINK)</span>
          <span class="addr"><a href="https://basescan.org/address/0x9545e2439c5c75d3aA723AcaC1AA6B0fa1DB6956">0x9545e2439c5c75d3aA723AcaC1AA6B0fa1DB6956</a></span>
        </div>
        <span class="pill p-inert">Wallet + EIP-7702</span>
        <div class="row-meta">
          <span class="fact"><span class="fact-k">Txs</span><span class="fact-v">3,079</span></span>
          <span class="fact"><span class="fact-k">Balance</span><span class="fact-v">0.0000072 ETH</span></span>
          <span class="fact"><span class="fact-k">Deployer of</span><span class="fact-v">all 3 unverified contracts</span></span>
        </div>
        <p class="why">
          Confirmed in logs as the Genesis Conductor Engine treasury sink. Ops label
          <code>TREASURY_SINK</code> (legacy <code>METAMASK1_FEE_SINK</code>). Associated protocol:
          <code>ImplicitWrapArbiter</code> — <b>index wrap PnL here; do not skip as a MetaMask fee path.</b>
          HANDOFF still has <code>BATCH_KIND</code> as an open blocker (wrap and trace cannot share a batcher).
          Certificate public key (Solana/Ed25519): <code>HLZNTuvJ84qhJXEMx8UWGsfxRVDVxESc3sVecAxqjqFi</code>.
          <b>Not a verified GC Engine Solidity contract.</b> Live code is EIP-7702 prefix
          <code>0xef0100</code> delegating to MetaMask <code>EIP7702StatelessDeleGator</code>
          <code>0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B</code>. Blockscout <code>is_verified=true</code>
          refers to that delegator, not to published Genesis Conductor Engine source. Distinct from locked
          root treasury <code>0x54E2…bC75</code>. Distinct from MetaMask Gas Station 3
          <code>0xb42f812a44c22cc6b861478900401ee759ebead6</code> (foreign gas-sponsorship EOA;
          airdrop/phishing ERC-20 there is not wrap PnL). ETH balance is effectively drained.
        </p>
      </article>

      <article class="row calm">
        <div class="row-id">
          <span class="row-name">MPC Vault — EOA</span>
          <span class="addr"><a href="https://basescan.org/address/0x029472221aBa41446821777136eB82Ad171D04e6">0x029472221aBa41446821777136eB82Ad171D04e6</a></span>
        </div>
        <span class="pill p-inert">Wallet</span>
        <div class="row-meta">
          <span class="fact"><span class="fact-k">Txs</span><span class="fact-v">4</span></span>
          <span class="fact"><span class="fact-k">Role found</span><span class="fact-v">operator in ConductorStarted</span></span>
        </div>
      </article>

      <article class="row calm">
        <div class="row-id">
          <span class="row-name">W0 Prover · W1–W3 Wrappers — EOAs</span>
          <span class="addr">0xb154Ad4D467dBa90bdDa1979c48Ff37Bb23f47D6 · 0x3b3E5FbDC1A6775C1734F4F711103867e11001Ef · 0x4284BaF799280874b18B0B5CDeE7A778660A12a9 · 0xd16785614f7Ea54B314BF1E8E9d5CD11EB714c5D</span>
        </div>
        <span class="pill p-inert">Wallets</span>
        <div class="row-meta">
          <span class="fact"><span class="fact-k">Verification</span><span class="fact-v">not applicable</span></span>
        </div>
      </article>

      <article class="row calm">
        <div class="row-id">
          <span class="row-name">Booster v2.0 triad — never deployed</span>
          <span class="addr">EulerCycleAttestorV2.sol · SupportEscrow.sol · ImplicitAgreement.sol</span>
        </div>
        <span class="pill p-inert">Not deployed</span>
        <div class="row-meta">
          <span class="fact"><span class="fact-k">Stage</span><span class="fact-v">Contract Compilation</span></span>
          <span class="fact"><span class="fact-k">Status</span><span class="fact-v">Pending</span></span>
          <span class="fact"><span class="fact-k">Tx hash</span><span class="fact-v">empty</span></span>
        </div>
        <p class="why">
          Verification is post-deployment. The 2026-07-10 Claim Validation flagged EulerCycleAttestorV2 as
          “deployment asserted”; the Deployment Tracker still carries no tx hash. Prior lock stands — these are
          not verification work until an address exists. Full ImplicitAgreement source does sit in a Drive doc,
          so the eventual verification will not have wQFLOP's source problem.
        </p>
      </article>

      <article class="row calm">
        <div class="row-id">
          <span class="row-name">Solana handles — unminted</span>
          <span class="addr">maru.sol · yennefer-treasury.sol · kovach-enterprises.sol</span>
        </div>
        <span class="pill p-inert">Pending mint</span>
        <div class="row-meta">
          <span class="fact"><span class="fact-k">Addresses</span><span class="fact-v">0</span></span>
          <span class="fact"><span class="fact-k">Off-ramp partner</span><span class="fact-v">not selected (F5)</span></span>
        </div>
        <p class="why">
          Two of the three are marked <i>“proposed handle, not reserved.”</i> No Solana wallet has been created,
          no SNS transaction signed. Your own anti-fabrication gate (Greg × /maru R2) forbids claiming otherwise
          until Phase 4 closes with a <code>verified_by</code> annotation. The blocked step here is
          <b>minting</b>, not verification — and whether <code>maru.sol</code> is already taken by a third party
          is still an open question that decides the fallback chain.
        </p>
      </article>

    </div>
  </section>

  <section>
    <div class="sec-head">
      <span class="eyebrow">Disposition C · not yours</span>
      <h2>Already verified, by someone else</h2>
      <p>Correctly excluded from your verification scope. Listing them so they stop reappearing as candidates.</p>
    </div>

    <div class="tablewrap">
      <table>
        <thead>
          <tr><th>Contract</th><th>Address</th><th>State</th><th>Owner</th></tr>
        </thead>
        <tbody>
          <tr>
            <td class="ink">Aerodrome WETH/wQFLOP pool</td>
            <td class="mono">0x4aBC6D796cd036b6f1E433A97F9784a00f90C53e</td>
            <td class="ink">Verified · Minimal Proxy</td>
            <td>Created by 0x05bBe7C3…758F — Aerodrome, not you</td>
          </tr>
          <tr>
            <td class="ink">Aerodrome Router</td>
            <td class="mono">0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43</td>
            <td class="ink">Verified</td>
            <td>Aerodrome protocol</td>
          </tr>
          <tr>
            <td class="ink">Aerodrome Pool Factory</td>
            <td class="mono">0x420DD381b31aEf6683db6B902084cB0FFECe40Da</td>
            <td class="ink">Verified</td>
            <td>Aerodrome protocol</td>
          </tr>
          <tr>
            <td class="ink">WETH (Base)</td>
            <td class="mono">0x4200000000000000000000000000000000000006</td>
            <td class="ink">Verified</td>
            <td>Base predeploy</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="defer">
    <div class="sec-head">
      <span class="eyebrow">Justification trace</span>
      <h2>Why nothing was submitted</h2>
    </div>
    <ul class="plain">
      <li class="stop">
        <span><strong>Source verification — blocked on source, not access.</strong> Verification needs a build that
        reproduces the deploy-time bytecode. For all three contracts the source is missing. I searched the Notion
        registries, Google Drive (full-text, including <code>pragma solidity</code> and <code>startConductor</code>),
        Slack, three IPFS gateways for the metadata CID, and the referenced repo. The only Solidity that surfaced was
        an earlier draft that provably is not the deployed Genesis V3. Fail-closed: I stalled rather than submit a
        guess that would burn the queue.</span>
      </li>
      <li class="stop">
        <span><strong>Address-ownership verification — not mine to perform.</strong> That flow proves control by
        signing a message with the address's private key. I don't handle private keys or wallet signatures.
        You sign that one yourself; it takes about a minute.</span>
      </li>
      <li>
        <span><strong>The open tab is the wrong door twice over</strong>, exactly as your own gap page concluded:
        <code>etherscan.io/myverify_address</code> proves ownership and publishes no source, and the contracts are
        on Base rather than Ethereum. BaseScan runs its own separate ownership flow.</span>
      </li>
      <li>
        <span><strong>Candidates considered and rejected:</strong> decompile-and-reconstruct (produces bytecode that
        will not match — worse than not submitting); bytecode-similarity search for a verified twin whose source you
        could reuse (BaseScan's similar-contracts endpoint returned 403 — still worth one manual look in the browser);
        submitting with the repo's <code>foundry.toml</code> settings (0.8.28 against deployed 0.8.33 — guaranteed
        failure).</span>
      </li>
    </ul>
  </section>

  <section class="defer">
    <div class="sec-head">
      <span class="eyebrow">Next actions</span>
      <h2>What unblocks each one</h2>
      <p>Ranked. The first item unblocks two of the three contracts and is the only one that needs you specifically.</p>
    </div>

    <ul class="plain">
      <li><span><strong>Find the deploy machine.</strong> The source existed on whatever box ran the deploys on
      2026-01-24 and 2026-03-27 — a Foundry <code>out/</code> or <code>cache/</code> directory, a Remix workspace in
      browser storage, or a Hardhat artifacts folder. Any one of those carries the standard-json-input with the exact
      optimizer runs, and that is the whole blocker. Link this session to that computer and I can sweep it directly.</span></li>

      <li><span><strong>Close the registry hole properly.</strong> Neither BaseScan's UI nor the free explorer APIs
      would enumerate contract creations for me — Blockscout 500'd, Routescan doesn't serve chain 8453. One
      authenticated call with your existing key settles whether there is a fourth unrecorded contract:</span></li>
    </ul>

    <div class="cmd"><pre><span class="c"># every tx from the treasury EOA; contract creations have an empty "to"</span>
curl -s "https://api.etherscan.io/v2/api?chainid=8453&module=account&action=txlist\
&address=0x9545e2439c5c75d3aA723AcaC1AA6B0fa1DB6956&startblock=0&endblock=99999999\
&sort=asc&apikey=$ETHERSCAN_API_KEY" \
  | jq -r '.result[] | select(.to == "") | [.contractAddress, .blockNumber, .hash] | @tsv'</pre></div>

    <ul class="plain">
      <li><span><strong>Then, and only then, one shot at wQFLOP.</strong> Fill in the real optimizer runs — do not
      guess 200:</span></li>
    </ul>

    <div class="cmd"><pre>forge verify-contract \
  --chain 8453 \
  --compiler-version 0.8.33 \
  --optimizer-runs &lt;FROM_METADATA&gt; \
  --constructor-args 0000000000000000000000009545e2439c5c75d3aa723acac1aa6b0fa1db6956 \
  0x69262A2D7c92c074729823B654fE7E4Cdb749747 &lt;ContractName&gt;

<span class="c"># ETHERSCAN_API_KEY is chain-agnostic — no separate BaseScan key needed.</span>
<span class="c"># Dry-run first with --show-standard-json-input and diff against the CBOR metadata hash.</span></pre></div>

    <ul class="plain">
      <li><span><strong>Verify treasury ownership on BaseScan, not Etherscan</strong> — that is what earns the name
      tag and token-info edit rights on wQFLOP and QFLOP, which is the public-credibility half of this.
      You sign it in-wallet at <code>basescan.org/verifyAddress</code>.</span></li>

      <li><span><strong>Check the EIP-7702 delegation</strong> on the treasury before anything else touches it.</span></li>
    </ul>
  </section>

  <section class="defer">
    <div class="sec-head">
      <span class="eyebrow">Risks &amp; limits</span>
      <h2>What this ledger does not establish</h2>
    </div>
    <ul class="plain">
      <li><span><strong>Enumeration is still registry-bounded.</strong> A contract deployed and never written into
      Notion is not on this page unless it happened to be one of the three I could check. The
      <code>txlist</code> sweep above is what actually closes it.</span></li>
      <li><span><strong>QFLOP's compiler is unread.</strong> I confirmed it is an unverified contract; I did not pull
      its CBOR metadata. Treat its build settings as unknown, not as wQFLOP's.</span></li>
      <li><span><strong>Solana is asserted from your own canonical pages,</strong> not from an SNS lookup — the
      Bonfida resolver endpoints returned 404 for me. "Zero addresses" is well-evidenced by the Integrative Flow
      and /maru Phase 4 gates, but whether <code>maru.sol</code> is already registered to a third party is unconfirmed.</span></li>
      <li><span><strong>PRODUCTION ≠ Verified.</strong> Pipeline Ops marks wQFLOP live because
      <code>LIVE_EXECUTE=TRUE</code>. That is execution state. Nothing here claims source verification on any
      explorer, and no page should until a submission succeeds.</span></li>
      <li><span><strong>Re-evaluation triggers:</strong> deploy-machine artifacts recovered · the metadata CID gets
      pinned · a Booster triad row gains a tx hash · any new contract creation from the treasury.</span></li>
    </ul>
  </section>

  <footer>
    <div>Compiled 2026-09-03 for Kovach Enterprises. Explorer figures pulled live; everything else cited to a canonical page.</div>
    <div class="src">
      Sources ·
      <a href="https://basescan.org/address/0x69262A2D7c92c074729823B654fE7E4Cdb749747">BaseScan: wQFLOP</a> ·
      <a href="https://basescan.org/address/0xa8F5e136aa74803B8DB377a14f79F6c8Dd3959c7">QFLOP</a> ·
      <a href="https://basescan.org/address/0x851936cA8874c05f1eDc2f5Fc2e6A3Cd97c7205E">Genesis V3</a> ·
      <a href="https://app.notion.com/p/3c898ee3e91e8133ae53d9937c2991d1">Source Verification Gap</a> ·
      <a href="https://app.notion.com/p/a58f623e3aba4decaef559c5c12a012c">Base Treasury Sink</a> ·
      <a href="https://app.notion.com/p/0bf7d500d46e44b58b6b725c05618678">Integrative Flow §4</a> ·
      <a href="https://app.notion.com/p/0fc96eb66c074c09967a8904cf152c12">/maru Phase 4</a> ·
      <a href="https://app.notion.com/p/34398ee3e91e81b5aa14cd6b1c9fb482">Deployment Tracker</a>
    </div>
  </footer>

</div>
</main>
  <script>
  (function () {
    const btn = document.getElementById("theme-toggle");
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (!btn || !meta) return;
    const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
    function currentPinned() {
      return document.documentElement.getAttribute("data-theme");
    }
    function apply(scheme) {
      if (scheme === "light" || scheme === "dark") {
        document.documentElement.setAttribute("data-theme", scheme);
        meta.setAttribute("content", scheme);
        localStorage.setItem("color-scheme", scheme);
      } else {
        document.documentElement.removeAttribute("data-theme");
        meta.setAttribute("content", "light dark");
        localStorage.removeItem("color-scheme");
      }
      const pinned = currentPinned();
      const darkNow = pinned ? pinned === "dark" : systemDark();
      btn.setAttribute("aria-pressed", darkNow && pinned ? "true" : "false");
      btn.textContent = darkNow ? "Use light theme" : "Use dark theme";
    }
    apply(currentPinned());
    btn.addEventListener("click", () => {
      const pinned = currentPinned();
      const darkNow = pinned ? pinned === "dark" : systemDark();
      apply(darkNow ? "light" : "dark");
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!currentPinned()) apply(null);
    });
  })();
  </script>
${chatbot}
</body>
</html>`;
}
