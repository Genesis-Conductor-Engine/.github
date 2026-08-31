import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPOSIT_CAP_WEI,
  ENTRY_POINT_V06,
  estimateMaxCostWei,
  parseUserOp,
  quoteSponsorship,
} from './sponsor-userop';

const validOp = {
  sender: '0x1111111111111111111111111111111111111111',
  nonce: '0x0',
  initCode: '0x',
  callData: '0x',
  callGasLimit: '100000',
  verificationGasLimit: '100000',
  preVerificationGas: '50000',
  maxFeePerGas: '1000',
  maxPriorityFeePerGas: '100',
  paymasterAndData: '0x',
  signature: '0x',
};

describe('parseUserOp', () => {
  it('accepts a v0.6 userOp', () => {
    const r = parseUserOp({ userOp: validOp });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userOp.sender).toBe(validOp.sender);
  });

  it('rejects a missing sender', () => {
    const r = parseUserOp({ ...validOp, sender: 'nope' });
    expect(r.ok).toBe(false);
  });
});

describe('estimateMaxCostWei', () => {
  it('is (call+ver+pre)*maxFeePerGas', () => {
    const r = parseUserOp(validOp);
    expect(r.ok).toBe(true);
    if (r.ok) expect(estimateMaxCostWei(r.userOp)).toBe(250000n * 1000n);
  });
});

describe('quoteSponsorship', () => {
  it('quotes within the default 0.05 ETH cap and never signs', () => {
    const q = quoteSponsorship({ userOp: validOp });
    expect(q.sponsorship_status).toBe('quoted_not_broadcast');
    expect(q.broadcast).toBe(false);
    expect(q.worker_signs).toBe(false);
    expect(q.network).toBe('eip155:8453');
    expect(q.entry_point).toBe(ENTRY_POINT_V06);
    expect(q.deposit_cap_wei).toBe(DEFAULT_DEPOSIT_CAP_WEI.toString());
    expect(q.within_cap).toBe(true);
  });

  it('flags maxCost above the cap without broadcasting', () => {
    const q = quoteSponsorship({
      userOp: { ...validOp, callGasLimit: '5000000', maxFeePerGas: '100000000000' },
    });
    expect(q.sponsorship_status).toBe('quoted_not_broadcast');
    expect(q.within_cap).toBe(false);
    expect(q.broadcast).toBe(false);
  });

  it('returns invalid_userop after a paid call with a bad body (no 5xx)', () => {
    const q = quoteSponsorship({ hello: 'world' });
    expect(q.sponsorship_status).toBe('invalid_userop');
    expect(q.reason).toMatch(/sender/);
  });

  it('surfaces PAYMASTER_ADDRESS when it is a real address', () => {
    const q = quoteSponsorship(validOp, {
      PAYMASTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    });
    expect(q.paymaster).toBe('0x2222222222222222222222222222222222222222');
  });
});
