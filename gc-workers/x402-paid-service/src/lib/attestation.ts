/**
 * Agent Trust / Service Attestation engine — dynamic high-signal verification
 * of an x402 endpoint's liveness and payment-rail integrity.
 * Proprietary IP of Genesis Conductor (Kovach JV).
 *
 * Quick mode ($0.10): single probe — reachable, https, latency, x402 402 rail parse.
 * Audit mode ($2.50): repeated probes, JSON requirement deep-parse, consistency.
 */

export interface AttestationCheck {
  name: string;
  ok: boolean;
  detail: string;
  ms?: number;
}

export interface AttestationX402 {
  status?: number;
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  price_usd6?: string;
  x402_version?: string;
}

export interface AttestationResult {
  target: string;
  mode: 'quick' | 'audit';
  verdict: 'A' | 'B' | 'C' | 'D';
  checks: AttestationCheck[];
  x402?: AttestationX402;
  attested_at: string;
  attestor: 'genesis-conductor';
}

export type Verdict = AttestationResult['verdict'];

const DEFAULT_TIMEOUT_MS = 8_000;

/** Pure grading: A = reachable + x402 rail; B = reachable, no x402; C = reachable but degraded; D = unreachable. */
export function gradeAttestation(checks: readonly AttestationCheck[]): Verdict {
  const byName = (n: string) => checks.find((c) => c.name === n);
  if (!byName('reachable')?.ok) return 'D';
  const degraded = checks.find((c) => c.name === 'response_shape' && !c.ok);
  if (degraded) return 'C';
  if (byName('x402_rail')?.ok) return 'A';
  return 'B';
}

/** Extract x402 payment requirements from a 402 response (header or body, both encodings). */
export function parseX402Requirements(
  status: number,
  headers: Headers,
  bodyText: string,
): AttestationX402 | undefined {
  const out: AttestationX402 = { status };
  let reqs: Record<string, unknown> | undefined;
  const header = headers.get('x-payment-required') ?? headers.get('X-PAYMENT-REQUIRED');
  if (header) {
    try {
      const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(header)));
      if (decoded && typeof decoded === 'object') reqs = decoded as Record<string, unknown>;
    } catch {
      reqs = undefined;
    }
  }
  if (!reqs && bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      if (parsed && typeof parsed === 'object' && 'accepts' in (parsed as Record<string, unknown>)) {
        reqs = parsed as Record<string, unknown>;
      }
    } catch {
      reqs = undefined;
    }
  }
  if (!reqs) return out.status === 402 ? out : undefined;
  out.x402_version = typeof reqs.x402Version === 'number' ? String(reqs.x402Version) : undefined;
  const accepts = Array.isArray(reqs.accepts) ? (reqs.accepts as Record<string, unknown>[]) : [];
  const first = accepts[0];
  if (first) {
    out.scheme = typeof first.scheme === 'string' ? first.scheme : undefined;
    out.network = typeof first.network === 'string' ? first.network : undefined;
    out.asset = typeof first.asset === 'string' ? first.asset : undefined;
    out.payTo = typeof first.payTo === 'string' ? first.payTo : undefined;
    out.price_usd6 = typeof first.maxAmountRequired === 'string' ? first.maxAmountRequired : undefined;
  }
  return out;
}

function base64UrlDecode(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

interface ProbeOutcome {
  ok: boolean;
  status: number;
  ms: number;
  headers: Headers;
  bodyText: string;
  error?: string;
}

async function probe(
  url: string,
  method: 'GET' | 'POST',
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const resp = await fetchImpl(url, {
      method,
      ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    const ms = Date.now() - started;
    let bodyText = '';
    try {
      bodyText = await resp.text();
    } catch {
      bodyText = '';
    }
    return { ok: true, status: resp.status, ms, headers: resp.headers, bodyText };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, headers: new Headers(), bodyText: '', error: String(e) };
  }
}

export async function runAttestation(
  body: unknown,
  opts?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    mode?: 'quick' | 'audit';
    now?: () => Date;
  },
): Promise<AttestationResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const mode = opts?.mode ?? 'quick';
  const now = opts?.now ?? (() => new Date());
  const input = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}) as {
    url?: unknown;
    mode?: unknown;
  };
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  const targetMode: 'quick' | 'audit' =
    mode === 'audit' || input.mode === 'audit' ? 'audit' : 'quick';

  if (!rawUrl) {
    return {
      target: '',
      mode: targetMode,
      verdict: 'D',
      checks: [{ name: 'reachable', ok: false, detail: 'missing required input: url' }],
      attested_at: now().toISOString(),
      attestor: 'genesis-conductor',
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return {
      target: rawUrl,
      mode: targetMode,
      verdict: 'D',
      checks: [{ name: 'reachable', ok: false, detail: 'invalid URL' }],
      attested_at: now().toISOString(),
      attestor: 'genesis-conductor',
    };
  }
  const target = parsedUrl.toString();
  const httpsOk = parsedUrl.protocol === 'https:';

  const first = await probe(target, 'GET', fetchImpl, timeoutMs);
  const checks: AttestationCheck[] = [];

  checks.push({
    name: 'reachable',
    ok: first.ok && first.status > 0,
    detail: first.ok ? `HTTP ${first.status} in ${first.ms}ms` : `unreachable: ${first.error ?? 'no response'}`,
    ms: first.ms,
  });
  checks.push({
    name: 'https',
    ok: httpsOk,
    detail: httpsOk ? 'https transport' : 'non-https transport',
  });

  let x402: AttestationX402 | undefined;
  if (first.ok && first.status === 402) {
    x402 = parseX402Requirements(first.status, first.headers, first.bodyText);
    const railOk = Boolean(x402 && (x402.scheme || x402.price_usd6));
    checks.push({
      name: 'x402_rail',
      ok: railOk,
      detail: railOk
        ? `402 requirements parsed: ${x402?.scheme ?? '?'} ${x402?.network ?? '?'} price=${x402?.price_usd6 ?? '?'}`
        : '402 returned but payment requirements unparseable',
    });
  } else if (first.ok) {
    // Maybe a POST-only paid endpoint: try POST once to look for the 402 rail.
    const postProbe = await probe(target, 'POST', fetchImpl, timeoutMs);
    if (postProbe.status === 402) {
      x402 = parseX402Requirements(postProbe.status, postProbe.headers, postProbe.bodyText);
      const railOk = Boolean(x402 && (x402.scheme || x402.price_usd6));
      checks.push({
        name: 'x402_rail',
        ok: railOk,
        detail: railOk
          ? `402 (POST) requirements parsed: ${x402?.scheme ?? '?'} ${x402?.network ?? '?'} price=${x402?.price_usd6 ?? '?'}`
          : '402 (POST) returned but payment requirements unparseable',
        ms: postProbe.ms,
      });
    } else {
      checks.push({
        name: 'x402_rail',
        ok: false,
        detail: `no x402 402 rail detected (GET=${first.status}, POST=${postProbe.status})`,
        ms: postProbe.ms,
      });
    }
  }

  if (targetMode === 'audit' && first.ok) {
    const second = await probe(target, 'GET', fetchImpl, timeoutMs);
    const drift = second.ok ? Math.abs(second.ms - first.ms) : -1;
    checks.push({
      name: 'latency_consistency',
      ok: second.ok && drift <= Math.max(1_500, first.ms),
      detail: second.ok ? `GET ${first.ms}ms vs ${second.ms}ms (drift ${drift}ms)` : 'second probe failed',
      ms: second.ms,
    });
    const jsonOk = second.ok && (second.headers.get('content-type') ?? '').includes('json');
    checks.push({
      name: 'response_shape',
      ok: jsonOk || second.status === 402,
      detail: jsonOk
        ? `content-type json (HTTP ${second.status})`
        : second.status === 402
          ? '402 payment response shape'
          : `non-JSON content-type (HTTP ${second.status})`,
      ms: second.ms,
    });
  }

  const verdict = gradeAttestation(checks);
  const result: AttestationResult = {
    target,
    mode: targetMode,
    verdict,
    checks,
    ...(x402 ? { x402 } : {}),
    attested_at: now().toISOString(),
    attestor: 'genesis-conductor',
  };
  return result;
}
