/**
 * Edge CSID — Contextual Semantic Interference Diffusion
 * Pure JS Ising/Gibbs (no JAX) for Cloudflare Workers.
 */

export type CsidSnapshot = {
  spaceId: string;
  intent: string;
  backend: string;
  temperature: number;
  beta: number;
  nSpins: number;
  meanMagnetization: number;
  energy: number;
  interference: number;
  diffusionNorm: number;
  semanticEntropy: number;
  fieldPreview: number[];
  kelvin: number;
  ts: string;
  primary: string;
  semantic?: string;
};

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function contextBiases(spaceId: string, n: number): Float64Array {
  const b = new Float64Array(n);
  const bytes = new TextEncoder().encode(spaceId);
  for (let i = 0; i < bytes.length; i++) {
    b[i % n] += ((bytes[i] % 17) - 8) * 0.08;
  }
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n;
    b[i] += 0.25 * Math.sin(x * (1 + (spaceId.length % 5)));
    b[i] += 0.12 * Math.cos(x * 3 + (hash32(spaceId) % 7));
  }
  return b;
}

function gibbs(
  biases: Float64Array,
  beta: number,
  J: number,
  steps: number,
  rnd: () => number,
): Float64Array {
  const n = biases.length;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = rnd() < 0.5 ? -1 : 1;
  for (let t = 0; t < steps; t++) {
    for (let i = 0; i < n; i++) {
      let neigh = 0;
      if (i > 0) neigh += s[i - 1];
      if (i < n - 1) neigh += s[i + 1];
      const field = biases[i] + J * neigh;
      const pUp = 1 / (1 + Math.exp(-2 * beta * field));
      s[i] = rnd() < pUp ? 1 : -1;
    }
  }
  return s;
}

function energy(spins: Float64Array, biases: Float64Array, J: number): number {
  let e = 0;
  for (let i = 0; i < spins.length; i++) e -= biases[i] * spins[i];
  for (let i = 0; i < spins.length - 1; i++) e -= J * spins[i] * spins[i + 1];
  return e;
}

function corr(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-12 ? 0 : num / den;
}

export function generateEdgeCsid(
  spaceId: string,
  intent = "JOIN_LISTEN",
  opts?: { nSpins?: number; temperature?: number; J?: number; steps?: number },
): CsidSnapshot {
  const n = opts?.nSpins ?? 48;
  const temperature = opts?.temperature ?? 1.15;
  const J = opts?.J ?? 0.55;
  const steps = opts?.steps ?? 64;
  const beta = 1 / Math.max(temperature, 1e-3);
  const sid = (spaceId || "unknown").trim();
  const biases = contextBiases(sid, n);
  const intentHash = [...intent].reduce((a, c) => a + c.charCodeAt(0), 0) % 11;
  for (let i = 0; i < n; i++) biases[i] += 0.05 * (intentHash - 5);

  const seed =
    (hash32(sid + "|" + intent + "|" + String(Math.floor(Date.now() / 10_000))) >>>
      0) ||
    1;
  const rnd = mulberry32(seed);
  const spins = gibbs(biases, beta, J, steps, rnd);

  const carrierA = new Float64Array(n);
  const carrierB = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n;
    carrierA[i] = Math.sin(x * 2);
    carrierB[i] = Math.cos(x * 5 + 0.3);
  }
  const interference =
    Math.abs(corr(spins, carrierA)) * 0.5 + Math.abs(corr(spins, carrierB)) * 0.5;

  let diff2 = 0;
  for (let i = 1; i < n; i++) {
    const d = spins[i] - spins[i - 1];
    diff2 += d * d;
  }
  const diffusionNorm = Math.sqrt(diff2 / (n - 1));

  let m = 0;
  let up = 0;
  for (let i = 0; i < n; i++) {
    m += spins[i];
    if (spins[i] > 0) up++;
  }
  m /= n;
  const pUp = up / n;
  const pDn = 1 - pUp;
  let semH = 0;
  for (const p of [pUp, pDn]) {
    if (p > 1e-12) semH -= p * Math.log(p + 1e-12);
  }
  semH /= Math.log(2);

  const kelvin = Math.round(
    280 + (1 - Math.abs(m)) * 400 + interference * 180 + diffusionNorm * 90,
  );

  const step = Math.max(1, Math.floor(n / 16));
  const fieldPreview: number[] = [];
  for (let i = 0; i < n; i += step) fieldPreview.push(Math.round(spins[i] * 10000) / 10000);

  return {
    spaceId: sid,
    intent,
    backend: "edge-ising",
    temperature,
    beta,
    nSpins: n,
    meanMagnetization: m,
    energy: energy(spins, biases, J),
    interference,
    diffusionNorm,
    semanticEntropy: semH,
    fieldPreview,
    kelvin,
    ts: new Date().toISOString(),
    primary: "CSID_DIFFUSION",
  };
}

export function parseSpace(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m1 = s.match(/(?:x|twitter)\.com\/i\/spaces\/([A-Za-z0-9]+)/i);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]space=([A-Za-z0-9]+)/i);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9]{8,}$/.test(s)) return s;
  return null;
}
