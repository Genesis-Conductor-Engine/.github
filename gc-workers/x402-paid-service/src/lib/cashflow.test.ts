import { describe, expect, it } from 'vitest';
import {
  FLEET,
  SETTLEMENT_WINDOW,
  appendLedger,
  computeRoi,
  parseWebhook,
} from './cashflow';

describe('computeRoi', () => {
  it('matches the settlement window identities and negative observed ROI', () => {
    const roi = computeRoi(SETTLEMENT_WINDOW.live_close_usdc);
    expect(roi.period_net_usdc).toBe(SETTLEMENT_WINDOW.net_usdc);
    expect(roi.period_roi_on_prose_open).toBeCloseTo(
      SETTLEMENT_WINDOW.net_usdc / SETTLEMENT_WINDOW.opening_prose_usdc,
      8,
    );
    expect(roi.implied_true_open_usdc).toBeCloseTo(
      SETTLEMENT_WINDOW.opening_prose_usdc + SETTLEMENT_WINDOW.residual_usdc,
      6,
    );
    expect(roi.period_roi_on_implied_open).toBeLessThan(0);
    expect(roi.flywheel).toHaveLength(3);
    expect(roi.flywheel[1].future_usdc).toBeGreaterThan(roi.working_capital_usdc);
  });
});

describe('parseWebhook', () => {
  it('classifies Alchemy ADDRESS_ACTIVITY against the fleet', () => {
    const settlement = FLEET.find((w) => w.id === 'settlement')!.address;
    const events = parseWebhook({
      type: 'ADDRESS_ACTIVITY',
      event: {
        activity: [
          { fromAddress: settlement, toAddress: '0x44b86c7200000000000000000000000000000001', value: 99.7, asset: 'USDC', hash: '0xabc', category: 'token' },
          { fromAddress: '0x1111111111111111111111111111111111111111', toAddress: settlement, value: 10, asset: 'USDC', hash: '0xdef', category: 'token' },
        ],
      },
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ source: 'alchemy', direction: 'out', amount: 99.7, asset: 'USDC' });
    expect(events[1]).toMatchObject({ direction: 'in', amount: 10 });
  });

  it('accepts the generic treasury event shape', () => {
    const events = parseWebhook({
      source: 'manual',
      direction: 'out',
      asset: 'USDC',
      amount: 25,
      note: 'alchemy invoice placeholder',
    });
    expect(events).toEqual([expect.objectContaining({ direction: 'out', amount: 25, source: 'manual' })]);
  });

  it('records gas_low alerts from the existing cron webhook', () => {
    const events = parseWebhook({
      alert: 'gas_low',
      vault: '0.000000 ETH',
      main: '0.000001 ETH',
      threshold: '0.002000 ETH',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'gas_monitor', asset: 'ETH', direction: 'out' });
    expect(events[0].note).toContain('gas_low');
  });

  it('returns empty for unknown payloads', () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ hello: true })).toEqual([]);
  });
});

describe('appendLedger', () => {
  it('prepends events and caps length', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
    };
    const first = await appendLedger(kv, [{
      ts: '2026-08-15T00:00:00Z', source: 't', direction: 'in', asset: 'USDC', amount: 1,
    }]);
    expect(first).toHaveLength(1);
    const many = Array.from({ length: 250 }, (_, i) => ({
      ts: `2026-08-15T00:00:${String(i).padStart(2, '0')}Z`,
      source: 't',
      direction: 'in' as const,
      asset: 'USDC',
      amount: i,
    }));
    const next = await appendLedger(kv, many);
    expect(next).toHaveLength(200);
    expect(next[0].amount).toBe(0);
  });
});
