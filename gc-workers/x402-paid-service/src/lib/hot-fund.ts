/**
 * Operator affordance: one-tap 100 USDC (Base native) from the settlement
 * CSW to HOT. This page does not sign. The CSW owner still approves.
 */

export const HOT_ADDRESS = '0x60C4499870f115664d7FfD8411b023DBEf3377d9';
export const SETTLEMENT_CSW = '0x937897fe19F675c96a71078820F21cA9bD637180';
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const HOT_FUND_USD = '100';
export const HOT_FUND_ATOMIC = 100_000_000; // 100 * 10^6
export const BASE_CHAIN_ID = 8453;

export function usdcTransferCalldata(to: string, atomic: number): string {
  const addr = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amount = BigInt(atomic).toString(16).padStart(64, '0');
  return `0xa9059cbb${addr}${amount}`;
}

export function eip681UsdcTransfer(to: string, atomic: number): string {
  return `ethereum:${USDC_BASE}@${BASE_CHAIN_ID}/transfer?address=${to}&uint256=${atomic}`;
}

export function buildHotFundHtml(): string {
  const calldata = usdcTransferCalldata(HOT_ADDRESS, HOT_FUND_ATOMIC);
  const eip681 = eip681UsdcTransfer(HOT_ADDRESS, HOT_FUND_ATOMIC);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fund HOT — 100 USDC on Base</title>
  <meta http-equiv="Cross-Origin-Opener-Policy" content="same-origin-allow-popups">
  <style>
    :root { color-scheme: dark; --bg:#0c0f14; --fg:#e8edf5; --muted:#93a0b5; --card:#151b24; --line:#243044; --good:#3dd68c; }
    body { margin:0; font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--fg); }
    main { max-width: 40rem; margin: 0 auto; padding: 1.5rem; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1rem 1.1rem; }
    code, .addr { overflow-wrap: anywhere; font-size: .85rem; color: var(--muted); }
    button { font: inherit; padding: .7rem 1.1rem; border-radius: 10px; border: 0; background: #0052ff; color: #fff; cursor: pointer; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .ok { color: var(--good); }
    .sub { color: var(--muted); }
    a { color: #8cb4ff; }
    ul { padding-left: 1.1rem; }
  </style>
</head>
<body>
  <main>
    <h1>Fund HOT — 100 USDC on Base</h1>
    <p class="sub">Settlement CSW <code>${SETTLEMENT_CSW}</code> → HOT / payTo <code>${HOT_ADDRESS}</code>. Native USDC <code>${USDC_BASE}</code> on Base 8453. Do not send on Ethereum or Arbitrum. Do not send to the USDC contract.</p>
    <div class="card">
      <p><b>Amount</b> ${HOT_FUND_USD} USDC &nbsp;·&nbsp; <b>Chain</b> Base</p>
      <p><button id="pay" type="button">Pay 100 USDC with Base Account</button></p>
      <p id="status" class="sub">Opens the Base / Coinbase Smart Wallet prompt. Agent cannot sign 0x9378… from here.</p>
      <p>Manual / wallet-scan URI:<br><code id="eip681">${eip681}</code></p>
      <p>transfer() calldata (token = USDC, not the destination):<br><code>${calldata}</code></p>
    </div>
    <ul>
      <li>From: settlement CSW ${SETTLEMENT_CSW}</li>
      <li>To: HOT ${HOT_ADDRESS}</li>
      <li>Token: Base native USDC ${USDC_BASE}</li>
    </ul>
    <p><a href="/cashflow">Back to cashflow</a></p>
  </main>
  <script type="module">
    const HOT = ${JSON.stringify(HOT_ADDRESS)};
    const AMOUNT = ${JSON.stringify(HOT_FUND_USD)};
    const status = document.getElementById('status');
    const btn = document.getElementById('pay');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      status.textContent = 'Opening Base Pay…';
      try {
        const { pay } = await import('https://esm.sh/@base-org/account@2.5.10');
        const result = await pay({ amount: AMOUNT, to: HOT, testnet: false });
        status.className = 'ok';
        status.textContent = 'Submitted ' + (result?.id || JSON.stringify(result));
      } catch (err) {
        status.textContent = String(err && err.message ? err.message : err);
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
