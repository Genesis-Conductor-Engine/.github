import { describe, expect, it } from 'vitest';
import {
  BASE_CHAIN_ID,
  HOT_ADDRESS,
  HOT_FUND_ATOMIC,
  SETTLEMENT_CSW,
  USDC_BASE,
  buildHotFundHtml,
  eip681UsdcTransfer,
  usdcTransferCalldata,
} from './hot-fund';

describe('hot-fund', () => {
  it('encodes transfer(HOT, 100e6) to the USDC contract, not to HOT as the token', () => {
    const data = usdcTransferCalldata(HOT_ADDRESS, HOT_FUND_ATOMIC);
    expect(data.startsWith('0xa9059cbb')).toBe(true);
    expect(data.toLowerCase()).toContain(HOT_ADDRESS.slice(2).toLowerCase());
    expect(data.endsWith('05f5e100')).toBe(true);
    expect(data.toLowerCase()).not.toContain(USDC_BASE.slice(2).toLowerCase());
  });

  it('builds an EIP-681 for Base native USDC to HOT', () => {
    const uri = eip681UsdcTransfer(HOT_ADDRESS, HOT_FUND_ATOMIC);
    expect(uri).toContain(`ethereum:${USDC_BASE}@${BASE_CHAIN_ID}/transfer`);
    expect(uri).toContain(`address=${HOT_ADDRESS}`);
    expect(uri).toContain(`uint256=${HOT_FUND_ATOMIC}`);
  });

  it('renders a page that names CSW, HOT, Base, and 100 USDC without secrets', () => {
    const html = buildHotFundHtml();
    expect(html).toContain(HOT_ADDRESS);
    expect(html).toContain(SETTLEMENT_CSW);
    expect(html).toContain(USDC_BASE);
    expect(html).toContain('100 USDC');
    expect(html).toContain('Base');
    expect(html).toContain('same-origin-allow-popups');
    expect(html).not.toMatch(/sk_test_|alch_|AvPSHy|privateKey|mnemonic/i);
  });
});
