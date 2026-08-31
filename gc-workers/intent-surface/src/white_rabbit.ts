/**
 * White Rabbit–inspired multi-node time fabric (software model).
 * @see https://white-rabbit.web.cern.ch/
 * @see https://white-rabbit.tech
 * @see IEEE 1588-2019 High Accuracy (WR profile)
 */

export const REFS = {
  project: "https://white-rabbit.web.cern.ch/",
  collaboration: "https://white-rabbit.tech",
  wiki: "https://gitlab.com/ohwr/project/white-rabbit/-/wikis/home",
  ieee1588: "https://standards.ieee.org/ieee/1588/6825/",
} as const;

const MU_PER_SEC = 1_000_000_000;
const PS_PER_MU = 1000;

export type SyncSample = {
  t1_mu: number;
  t2_mu: number;
  t3_mu: number;
  t4_mu: number;
  delay_mu: number;
  offset_mu: number;
  residual_ps: number;
};

export class WrNode {
  name: string;
  role: "grandmaster" | "slave" | "switch";
  private bootMs: number;
  cable_delay_mu: number;
  free_run_bias_mu: number;
  offset_mu = 0;
  last_delay_mu = 0;
  last_residual_ps = 0;
  locked = false;
  lock_count = 0;
  last_sync: SyncSample | null = null;
  history: SyncSample[] = [];

  constructor(
    name: string,
    role: "grandmaster" | "slave" | "switch" = "slave",
    opts?: { freeRunBiasMu?: number; cableDelayMu?: number },
  ) {
    this.name = name;
    this.role = role;
    this.bootMs = performance.now();
    this.free_run_bias_mu = opts?.freeRunBiasMu ?? 0;
    this.cable_delay_mu = opts?.cableDelayMu ?? 0;
  }

  freeRunMu(): number {
    return Math.floor((performance.now() - this.bootMs) * 1e6) + this.free_run_bias_mu;
  }

  /** WR-corrected time: free_run − offset (master domain). */
  wrTimeMu(): number {
    if (this.role === "grandmaster") return this.freeRunMu();
    return this.freeRunMu() - this.offset_mu;
  }

  toDict() {
    return {
      name: this.name,
      role: this.role,
      locked: this.locked,
      lock_count: this.lock_count,
      free_run_mu: this.freeRunMu(),
      wr_time_mu: this.wrTimeMu(),
      offset_mu: this.offset_mu,
      offset_ns: this.offset_mu,
      last_delay_mu: this.last_delay_mu,
      last_delay_ns: this.last_delay_mu,
      last_residual_ps: this.last_residual_ps,
      cable_delay_mu: this.cable_delay_mu,
      last_sync: this.last_sync,
      history: this.history,
    };
  }
}

function computeSample(s: Omit<SyncSample, "delay_mu" | "offset_mu" | "residual_ps">): SyncSample {
  const ms = s.t2_mu - s.t1_mu;
  const sm = s.t4_mu - s.t3_mu;
  const delay_mu = Math.floor((ms + sm) / 2);
  const offset_mu = Math.floor((ms - sm) / 2);
  const residual_ps = Math.abs((ms + sm) % 2) * Math.floor(PS_PER_MU / 2);
  return { ...s, delay_mu, offset_mu, residual_ps };
}

export class WhiteRabbitNetwork {
  gm: WrNode;
  nodes: Map<string, WrNode> = new Map();
  sync_rounds = 0;

  constructor(gmName = "gm.intent") {
    this.gm = new WrNode(gmName, "grandmaster");
    this.nodes.set(gmName, this.gm);
  }

  addNode(
    name: string,
    opts?: { freeRunBiasMu?: number; cableDelayMu?: number },
  ): WrNode {
    const existing = this.nodes.get(name);
    if (existing) return existing;
    const n = new WrNode(name, "slave", opts);
    this.nodes.set(name, n);
    return n;
  }

  get(name: string): WrNode | undefined {
    return this.nodes.get(name);
  }

  syncNode(name: string): SyncSample {
    const node = this.nodes.get(name);
    if (!node) throw new Error(`unknown WR node ${name}`);
    if (node.role === "grandmaster") {
      node.locked = true;
      node.offset_mu = 0;
      const sample = computeSample({ t1_mu: 0, t2_mu: 0, t3_mu: 0, t4_mu: 0 });
      node.last_sync = sample;
      return sample;
    }
    // Snapshot free-runs once, then apply symmetric cable delay (PTP model)
    const gm_t = this.gm.freeRunMu();
    const sl_t = node.freeRunMu();
    const d = node.cable_delay_mu;
    const sample = computeSample({
      t1_mu: gm_t,
      t2_mu: sl_t + d,
      t3_mu: sl_t,
      t4_mu: gm_t + d,
    });
    node.offset_mu = sample.offset_mu;
    node.last_delay_mu = sample.delay_mu;
    node.last_residual_ps = sample.residual_ps;
    node.locked = true;
    node.lock_count += 1;
    node.last_sync = sample;
    node.history.push(sample);
    if (node.history.length > 32) node.history = node.history.slice(-32);
    this.sync_rounds += 1;
    return sample;
  }

  syncAll() {
    const exchanges: Record<string, SyncSample> = {};
    for (const [name, node] of this.nodes) {
      if (node.role === "grandmaster") {
        node.locked = true;
        continue;
      }
      exchanges[name] = this.syncNode(name);
    }
    return {
      ok: true,
      sync_rounds: this.sync_rounds,
      grandmaster: this.gm.toDict(),
      nodes: Object.fromEntries([...this.nodes].map(([n, nd]) => [n, nd.toDict()])),
      exchanges,
      refs: REFS,
      primary: "WHITE_RABBIT_SYNC",
      ref: REFS.project,
      ts: new Date().toISOString(),
    };
  }

  skewMu(a: string, b: string): number {
    const na = this.nodes.get(a)!;
    const nb = this.nodes.get(b)!;
    return na.wrTimeMu() - nb.wrTimeMu();
  }

  toDict() {
    return {
      ok: true,
      model: "white-rabbit-software",
      primary: "WHITE_RABBIT_FABRIC",
      sync_rounds: this.sync_rounds,
      grandmaster: this.gm.name,
      nodes: Object.fromEntries([...this.nodes].map(([n, nd]) => [n, nd.toDict()])),
      concepts: [
        "grandmaster",
        "slave_node",
        "ptp_delay_request_response",
        "offset_mu",
        "delay_mu",
        "lock",
        "wr_time_mu",
        "multi_node_artiq_wall",
      ],
      refs: REFS,
      ref: REFS.project,
      ts: new Date().toISOString(),
    };
  }
}

let net = new WhiteRabbitNetwork("gm.intent");
for (const [name, bias, cable] of [
  ["node.csid", 50_000, 120],
  ["node.edge", -30_000, 80],
  ["node.control", 10_000, 40],
] as const) {
  net.addNode(name, { freeRunBiasMu: bias, cableDelayMu: cable });
}

export function getNetwork(): WhiteRabbitNetwork {
  return net;
}

export function newNetwork(gmName = "gm.intent"): WhiteRabbitNetwork {
  net = new WhiteRabbitNetwork(gmName);
  return net;
}

export function ensureLocked(node = "node.edge"): WrNode {
  const n = net.get(node) ?? net.addNode(node);
  if (!n.locked) net.syncNode(node);
  return n;
}

export function wrTimeMu(node = "node.edge"): number {
  return ensureLocked(node).wrTimeMu();
}

export function secondsToMu(s: number): number {
  return Math.floor(s * MU_PER_SEC);
}
