import { describe, expect, it } from 'vitest';
import { gradeAttestation, parseX402Requirements, runAttestation } from './attestation';
import type { AttestationCheck } from './attestation';

function b64(obj: unknown): string {
  return btoa(JSON.stringify(obj));
}

describe('gradeAttestation', () => {
  const base: AttestationCheck[] = [
    { name: 'reachable', ok: true, detail: 'HTTP 402' },
    { name: 'https', ok: true, detail: 'https transport' },
    { name: 'x402_rail', ok: true, detail: 'parsed' },
  ];
  it('grades A when reachable with a parsed x402 rail', () => {
    expect(gradeAttestation(base)).toBe('A');
  });
  it('grades B when reachable but no x402 rail', () => {
    const checks = base.map((c) => (c.name === 'x402_rail' ? { ...c, ok: false } : c));
    expect(gradeAttestation(checks)).toBe('B');
  });
  it('grades C when response shape is degraded even with a rail', () => {
    expect(gradeAttestation([...base, { name: 'response_shape', ok: false, detail: 'non-JSON' }])).toBe('C');
  });
  it('grades D when unreachable', () => {
    expect(gradeAttestation([{ name: 'reachable', ok: false, detail: 'no response' }])).toBe('D');
  });
});

describe('parseX402Requirements', () => {
  it('parses the base64url X-PAYMENT-REQUIRED header encoding', () => {
    const headers = new Headers({ 'x-payment-required': b64({ x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0xabc', payTo: '0xdef', maxAmountRequired: '100000' }] }) });
    const out = parseX402Requirements(402, headers, '');
    expect(out?.scheme).toBe('exact');
    expect(out?.network).toBe('eip155:8453');
    expect(out?.price_usd6).toBe('100000');
  });
  it('parses the JSON body accepts encoding', () => {
    const body = JSON.stringify({ x402Version: 1, accepts: [{ scheme: 'exact', maxAmountRequired: '50000' }] });
    const out = parseX402Requirements(402, new Headers(), body);
    expect(out?.price_usd6).toBe('50000');
  });
  it('returns undefined for a plain 200 response', () => {
    expect(parseX402Requirements(200, new Headers(), '{"ok":true}')).toBeUndefined();
  });
  it('keeps status-only info for an unparseable 402', () => {
    const out = parseX402Requirements(402, new Headers(), '<html>nope</html>');
    expect(out?.status).toBe(402);
    expect(out?.scheme).toBeUndefined();
  });
});

describe('runAttestation', () => {
  const attestorFetch = (status: number, body: string, headers: Record<string, string> = {}) =>
    (async () => new Response(body, { status, headers })) as typeof fetch;

  it('rejects D when url input is missing', async () => {
    const out = await runAttestation({});
    expect(out.verdict).toBe('D');
    expect(out.checks[0].name).toBe('reachable');
  });

  it('grades A for a live x402 endpoint with a 402 rail', async () => {
    const headers = { 'x-payment-required': b64({ accepts: [{ scheme: 'exact', network: 'eip155:8453', maxAmountRequired: '100000' }] }) };
    const fetchImpl = attestorFetch(402, '{"error":"payment required"}', headers);
    const out = await runAttestation({ url: 'https://example.com/api/thing' }, { fetchImpl });
    expect(out.verdict).toBe('A');
    expect(out.mode).toBe('quick');
    expect(out.x402?.price_usd6).toBe('100000');
    expect(out.attestor).toBe('genesis-conductor');
  });

  it('grades B for a reachable endpoint without an x402 rail', async () => {
    const fetchImpl = attestorFetch(200, '{"ok":true}', { 'content-type': 'application/json' });
    const out = await runAttestation({ url: 'https://example.com' }, { fetchImpl });
    expect(out.verdict).toBe('B');
    const rail = out.checks.find((c) => c.name === 'x402_rail');
    expect(rail?.ok).toBe(false);
  });

  it('grades C in audit mode when content-type is not json and no 402', async () => {
    const fetchImpl = attestorFetch(200, '<html>hello</html>', { 'content-type': 'text/html' });
    const out = await runAttestation({ url: 'https://example.com' }, { fetchImpl, mode: 'audit' });
    expect(out.mode).toBe('audit');
    expect(out.checks.some((c) => c.name === 'latency_consistency')).toBe(true);
    expect(out.verdict).toBe('C');
  });

  it('grades D when the target is unreachable', async () => {
    const fetchImpl = (async () => {
      throw new Error('dns failure');
    }) as typeof fetch;
    const out = await runAttestation({ url: 'https://dead.example' }, { fetchImpl });
    expect(out.verdict).toBe('D');
    expect(out.checks[0].ok).toBe(false);
  });
});
