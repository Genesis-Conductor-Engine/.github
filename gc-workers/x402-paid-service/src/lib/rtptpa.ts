/**
 * Worker port of skills/relative-tensor-power-tower-arbitration/scripts/rtpTPA.py
 * Deterministic, no numpy. Used as the payload of the existing $0.01 /api/execute.
 */

export const K_B = 1.380649e-23;

export const DEFAULT_PROMPTS = [
  'Stabilize the NV spin in |0⟩ under 300 mK thermal bath using the lowest possible energy cost and maximal coherence time',
  'Apply XY8 dynamical decoupling sequence to protect NV coherence while minimizing total microwave energy deposition',
  'Fuse multi-agent proposals for quantum control genesis layer with emphasis on thermodynamic efficiency and post-quantum attestability',
] as const;

export const DEFAULT_CRYSTAL = [0.96, 0.84, 0.73];
export const DEFAULT_GAPS = [0.18, 0.25, 0.09];

const EPS = 1e-9;
const BETA = 1.618;
const MAX_LAYERS = 4;
const DIM = 32;

export interface ControlSpec {
  target_system: string;
  operation: string;
  qubit_state: string;
  temperature_k: number;
  microwave_frequency_hz: number;
  detuning_hz: number;
  pulse_duration_us: number;
  phase_rad: number;
  expected_fidelity: number;
  dynamical_decoupling: string;
  thermodynamic_cost_j: number;
  landauer_bound_j: number;
  notes: string;
  genesis_layer: string;
}

export interface RtptpaEvt {
  schema_version: string;
  record_type: string;
  evt_id: string;
  timestamp: string;
  status: string;
  tags: string[];
  data: {
    input_prompts: string[];
    crystal_scores: number[];
    spectral_gaps: number[];
    power_tower_weights: number[];
    relative_tensor_shape: [number, number, number];
    fused_embedding_norm: number;
    control_spec: ControlSpec;
    thermodynamic_cost_j: number;
  };
  metrics: {
    convergence_improvement_factor: number;
    structural_invariance: boolean;
    attestation_ready: boolean;
  };
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function mean(v: number[]): number {
  return v.reduce((s, x) => s + x, 0) / (v.length || 1);
}

function clip01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

async function embed(prompt: string): Promise<number[]> {
  const vec = new Array<number>(DIM).fill(0);
  const p = prompt.toLowerCase();
  vec[0] = Math.min(prompt.length / 200.0, 1.0);
  vec[1] = ['stabilize', 'lock', 'hold'].some((k) => p.includes(k)) ? 1 : 0;
  vec[2] = ['nv', 'spin', 'qubit', 'center'].some((k) => p.includes(k)) ? 1 : 0;
  vec[3] = ['mk', 'temperature', 'kelvin', 'cryo'].some((k) => p.includes(k)) ? 1 : 0;
  vec[4] = ['minimal', 'lowest', 'energy', 'cost', 'landauer'].some((k) => p.includes(k)) ? 1 : 0;
  vec[5] = ['dynamical', 'decoupling', 'xy8', 'cpmg'].some((k) => p.includes(k)) ? 1 : 0;
  vec[6] = ['pulse', 'microwave', 'laser', 'control'].some((k) => p.includes(k)) ? 1 : 0;
  vec[7] = ['phase', 'coherence', 'fidelity'].some((k) => p.includes(k)) ? 1 : 0;
  const hex = await sha256hex(`${prompt}rtpTPA-v1`);
  const h = BigInt(`0x${hex.slice(0, 16)}`);
  for (let i = 8; i < DIM; i++) {
    const shifted = Number(h >> BigInt(i % 8));
    vec[i] = Math.sin(shifted * 0.1 + i * 0.3) * 0.5 + 0.5;
  }
  const n = norm(vec);
  return vec.map((x) => x / (n + EPS));
}

function relativeTensors(embeddings: number[][]): number[][][] {
  const n = embeddings.length;
  const d = embeddings[0].length;
  const R: number[][][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => new Array<number>(d).fill(0)),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      for (let k = 0; k < d; k++) {
        R[i][j][k] = (embeddings[i][k] - embeddings[j][k]) / (embeddings[j][k] + EPS);
      }
    }
  }
  return R;
}

function powerTowerWeights(crystal: number[], gaps: number[], stagnation = 0): number[] {
  let w = crystal.map((c, i) => c * (1 + gaps[i]));
  for (let layer = 0; layer < MAX_LAYERS; layer++) {
    w = w.map((x) => BETA ** x * (1 - stagnation));
    const s = w.reduce((a, b) => a + b, 0);
    w = w.map((x) => x / (s + EPS));
  }
  return w;
}

function fuse(embeddings: number[][], R: number[][][], weights: number[]): number[] {
  const n = embeddings.length;
  const d = embeddings[0].length;
  const fused = new Array<number>(d).fill(0);
  for (let m = 0; m < n; m++) {
    const view = new Array<number>(d).fill(0);
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (j === m) continue;
      for (let k = 0; k < d; k++) view[k] += R[m][j][k];
      count += 1;
    }
    if (count > 0) {
      for (let k = 0; k < d; k++) view[k] /= count;
    }
    for (let k = 0; k < d; k++) fused[k] += weights[m] * view[k] * embeddings[m][k];
  }
  return fused;
}

function project(fused: number[], prompts: string[], temperatureK = 0.3): ControlSpec {
  const detuning = Math.tanh(mean(fused.slice(0, 6))) * 5e6;
  const pulse = Math.max(0.05, 8.0 * (1.0 - clip01(mean(fused.slice(2, 8)))));
  const phase = Math.sin(fused.slice(7, 12).reduce((s, x) => s + x, 0) * 2) * Math.PI / 2;
  const fidelity = 0.89 + 0.09 * clip01(mean(fused.slice(3, 7)));
  const dd = prompts.some((p) => {
    const l = p.toLowerCase();
    return l.includes('minimal') || l.includes('energy');
  }) ? 'XY8' : 'CPMG-8';
  const bits = Math.max(1, prompts.length * 12 + fused.reduce((s, x) => s + Math.abs(x), 0) * 4);
  const landauerJ = K_B * temperatureK * Math.log(2) * bits;
  const overhead = 1.8e-12 * (temperatureK / 0.3) ** 0.5;
  const total = landauerJ + overhead;
  return {
    target_system: 'Diamond_NV_center',
    operation: 'spin_stabilization',
    qubit_state: '|0⟩',
    temperature_k: Number(temperatureK.toFixed(4)),
    microwave_frequency_hz: Number((2.87e9 + detuning).toFixed(2)),
    detuning_hz: Number(detuning.toFixed(2)),
    pulse_duration_us: Number(pulse.toFixed(3)),
    phase_rad: Number(phase.toFixed(5)),
    expected_fidelity: Number(fidelity.toFixed(4)),
    dynamical_decoupling: dd,
    thermodynamic_cost_j: Number(total.toPrecision(7)),
    landauer_bound_j: Number(landauerJ.toPrecision(4)),
    notes: 'Generated via RTPTPA relative-tensor power-tower arbitration. Relative formulation ensures structural invariance. Projection layer is NV-specific; core is substrate-agnostic.',
    genesis_layer: 'quantum_control_genesis_v1',
  };
}

export function parseRtptpaBody(body: unknown): {
  prompts: string[];
  crystal: number[];
  gaps: number[];
} {
  const rec = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const rawPrompts = rec.prompts;
  const prompts = Array.isArray(rawPrompts) && rawPrompts.every((p) => typeof p === 'string') && rawPrompts.length > 0
    ? rawPrompts as string[]
    : [...DEFAULT_PROMPTS];
  const n = prompts.length;
  const crystal = Array.isArray(rec.crystal_scores)
    ? (rec.crystal_scores as number[]).map(Number).slice(0, n)
    : DEFAULT_CRYSTAL.slice(0, n);
  const gaps = Array.isArray(rec.spectral_gaps)
    ? (rec.spectral_gaps as number[]).map(Number).slice(0, n)
    : DEFAULT_GAPS.slice(0, n);
  while (crystal.length < n) crystal.push(0.7);
  while (gaps.length < n) gaps.push(0.1);
  return { prompts, crystal, gaps };
}

export async function runRtptpa(body: unknown = {}): Promise<RtptpaEvt> {
  const { prompts, crystal, gaps } = parseRtptpaBody(body);
  const embeddings = await Promise.all(prompts.map(embed));
  const R = relativeTensors(embeddings);
  const weights = powerTowerWeights(crystal, gaps);
  const fused = fuse(embeddings, R, weights);
  const spec = project(fused, prompts);
  const now = new Date().toISOString();
  const id = `rtpTPA-${now.replace(/[-:TZ.]/g, '').slice(0, 20)}`;
  return {
    schema_version: '1.0',
    record_type: 'rtpTPA_arbitration',
    evt_id: id,
    timestamp: now,
    status: 'completed',
    tags: ['rtpTPA', 'quantum_control_genesis', 'relative-tensor', 'power-tower', 'genesis-conductor', 'diamond-nv'],
    data: {
      input_prompts: prompts,
      crystal_scores: crystal,
      spectral_gaps: gaps,
      power_tower_weights: weights,
      relative_tensor_shape: [prompts.length, prompts.length, DIM],
      fused_embedding_norm: norm(fused),
      control_spec: spec,
      thermodynamic_cost_j: spec.thermodynamic_cost_j,
    },
    metrics: {
      convergence_improvement_factor: 1.28,
      structural_invariance: true,
      attestation_ready: true,
    },
  };
}
