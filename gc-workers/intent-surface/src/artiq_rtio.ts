/**
 * ARTIQ-inspired RTIO timeline (software model).
 *
 * Product: https://m-labs-intl.com/artiq/artiq/
 * Manual:  https://m-labs.hk/artiq/manual/introduction.html
 * RTIO:    https://m-labs.hk/artiq/manual/rtio.html
 * Core:    https://m-labs.hk/artiq/manual/getting_started_core.html
 *
 * Host work (CSID sample) is treated as RPC → break_realtime() before
 * scheduling outputs. Positive slack required to submit (else underflow).
 */

import { generateEdgeCsid, type CsidSnapshot } from "./csid";
import { ensureLocked, wrTimeMu, REFS as WR_REFS } from "./white_rabbit";

const MU_PER_SEC = 1_000_000_000;
const DEFAULT_BREAK_HEADROOM_MU = 125_000;

export const REFS = {
  product: "https://m-labs-intl.com/artiq/artiq/",
  manual: "https://m-labs.hk/artiq/manual/introduction.html",
  rtio: "https://m-labs.hk/artiq/manual/rtio.html",
  core: "https://m-labs.hk/artiq/manual/getting_started_core.html",
  white_rabbit: WR_REFS.project,
  white_rabbit_collab: WR_REFS.collaboration,
} as const;

export function secondsToMu(s: number): number {
  return Math.floor(s * MU_PER_SEC);
}

export class RTIOUnderflow extends Error {
  now_mu: number;
  rtio_counter_mu: number;
  channel: string;
  constructor(now_mu: number, rtio_counter_mu: number, channel = "") {
    super(
      `RTIOUnderflow channel=${channel} now_mu=${now_mu} rtio_counter_mu=${rtio_counter_mu} slack_mu=${now_mu - rtio_counter_mu}`,
    );
    this.name = "RTIOUnderflow";
    this.now_mu = now_mu;
    this.rtio_counter_mu = rtio_counter_mu;
    this.channel = channel;
  }
}

export type RtioEvent = {
  timestamp_mu: number;
  timestamp_us: number;
  channel: string;
  kind: string;
  payload: Record<string, unknown>;
  zero_duration: boolean;
};

/** Process-scoped core (seamless handover across kernels). */
export class Core {
  now_mu = 0;
  private bootMs: number;
  private counterOffsetMu = 0;
  events: RtioEvent[] = [];
  underflow_count = 0;
  last_underflow: Record<string, unknown> | null = null;
  strict = true;
  wr_node: string | null = null;
  wr_locked = false;

  constructor(wrNode?: string) {
    this.bootMs = performance.now();
    this.wr_node = wrNode ?? null;
  }

  attachWhiteRabbit(node = "node.edge", sync = true): void {
    this.wr_node = node;
    if (sync) {
      ensureLocked(node);
      this.wr_locked = true;
    }
  }

  /** Wall clock (ARTIQ rtio_counter_mu) in machine units. */
  rtioCounterMu(): number {
    if (this.wr_node) {
      try {
        if (!this.wr_locked) {
          ensureLocked(this.wr_node);
          this.wr_locked = true;
        }
        return wrTimeMu(this.wr_node) + this.counterOffsetMu;
      } catch {
        /* fall through to free-run */
      }
    }
    const elapsedNs = (performance.now() - this.bootMs) * 1e6;
    return this.counterOffsetMu + Math.floor(elapsedNs);
  }

  slackMu(): number {
    return this.now_mu - this.rtioCounterMu();
  }

  delayMu(mu: number): void {
    if (mu < 0) throw new Error("delay_mu must be non-negative");
    this.now_mu += Math.floor(mu);
  }

  delay(seconds: number): void {
    this.delayMu(secondsToMu(seconds));
  }

  atMu(t: number): void {
    this.now_mu = Math.floor(t);
  }

  reset(headroomMu = DEFAULT_BREAK_HEADROOM_MU): void {
    this.events = [];
    const wall = this.rtioCounterMu();
    this.now_mu = wall + headroomMu;
    this.underflow_count = 0;
    this.last_underflow = null;
  }

  /** Busy-wait until wall clock reaches target mu. */
  waitUntilMu(t?: number): void {
    const deadline = t ?? this.now_mu;
    while (this.rtioCounterMu() < deadline) {
      /* busy-wait — software model */
    }
  }

  /** After host/RPC work: place now_mu safely ahead of wall clock. */
  breakRealtime(headroomMu = DEFAULT_BREAK_HEADROOM_MU): void {
    const wall = this.rtioCounterMu();
    const target = wall + headroomMu;
    if (this.now_mu < target) this.now_mu = target;
  }

  submit(
    channel: string,
    kind: string,
    payload: Record<string, unknown> = {},
    opts?: { atMu?: number; zeroDuration?: boolean; allowUnderflow?: boolean },
  ): RtioEvent {
    const timestamp_mu = opts?.atMu ?? this.now_mu;
    const wall = this.rtioCounterMu();
    if (timestamp_mu < wall && this.strict && !opts?.allowUnderflow) {
      this.underflow_count += 1;
      this.last_underflow = {
        now_mu: timestamp_mu,
        rtio_counter_mu: wall,
        slack_mu: timestamp_mu - wall,
        channel,
        kind,
      };
      throw new RTIOUnderflow(timestamp_mu, wall, channel);
    }
    const ev: RtioEvent = {
      timestamp_mu,
      timestamp_us: timestamp_mu / 1000,
      channel,
      kind,
      payload,
      zero_duration: opts?.zeroDuration ?? true,
    };
    this.events.push(ev);
    return ev;
  }

  toDict() {
    const wall = this.rtioCounterMu();
    return {
      now_mu: this.now_mu,
      rtio_counter_mu: wall,
      slack_mu: this.now_mu - wall,
      positive_slack: this.now_mu >= wall,
      underflow_count: this.underflow_count,
      last_underflow: this.last_underflow,
      event_count: this.events.length,
      strict: this.strict,
      wr_node: this.wr_node,
      wr_locked: this.wr_locked,
    };
  }
}

let sharedCore = new Core();

export function getCore(): Core {
  return sharedCore;
}

export function newCore(): Core {
  sharedCore = new Core();
  return sharedCore;
}

export class Kernel {
  name: string;
  core: Core;
  private localEvents: RtioEvent[] = [];
  private parallelStack: number[] = [];
  private parallelEnds: number[] = [];

  constructor(name = "csid_kernel", core?: Core) {
    this.name = name;
    this.core = core ?? getCore();
  }

  delay(seconds: number): void {
    this.core.delay(seconds);
  }

  delayMu(mu: number): void {
    this.core.delayMu(mu);
  }

  nowMu(): number {
    return this.core.now_mu;
  }

  rtioCounterMu(): number {
    return this.core.rtioCounterMu();
  }

  slackMu(): number {
    return this.core.slackMu();
  }

  reset(headroomMu = DEFAULT_BREAK_HEADROOM_MU): void {
    this.core.reset(headroomMu);
    this.localEvents = [];
  }

  breakRealtime(headroomMu = DEFAULT_BREAK_HEADROOM_MU): void {
    this.core.breakRealtime(headroomMu);
  }

  submit(
    channel: string,
    kind: string,
    payload: Record<string, unknown> = {},
    opts?: { atMu?: number; zeroDuration?: boolean; allowUnderflow?: boolean },
  ): RtioEvent {
    const ev = this.core.submit(channel, kind, payload, opts);
    this.localEvents.push(ev);
    return ev;
  }

  ttlPulse(channel: string, widthS: number, payload: Record<string, unknown> = {}): void {
    this.submit(channel, "ttl_on", payload, { zeroDuration: true });
    this.delay(widthS);
    this.submit(channel, "ttl_off", payload, { zeroDuration: true });
  }

  /** Begin parallel block; call endParallel() after branches. */
  beginParallel(): number {
    const start = this.core.now_mu;
    this.parallelStack.push(start);
    this.parallelEnds.push(start);
    return start;
  }

  branch(): void {
    if (this.parallelStack.length) {
      this.parallelEnds[this.parallelEnds.length - 1] = Math.max(
        this.parallelEnds[this.parallelEnds.length - 1],
        this.core.now_mu,
      );
      this.core.now_mu = this.parallelStack[this.parallelStack.length - 1];
    }
  }

  endParallel(): void {
    if (!this.parallelStack.length) return;
    const end = Math.max(
      this.parallelEnds.pop()!,
      this.core.now_mu,
    );
    this.parallelStack.pop();
    this.core.now_mu = end;
  }

  gateRising(durationS: number, channel = "csid.in"): number {
    const start = this.core.now_mu;
    this.submit(channel, "gate_open", { duration_s: durationS, edge: "rising" });
    this.delay(durationS);
    const end = this.core.now_mu;
    this.submit(channel, "gate_close", { start_mu: start, end_mu: end });
    return end;
  }

  countUntil(untilMu: number, n = 0): number {
    this.core.waitUntilMu(untilMu);
    this.submit(
      "csid.in",
      "count",
      { until_mu: untilMu, n },
      { atMu: untilMu, allowUnderflow: true },
    );
    return n;
  }

  toDict() {
    const events = [...this.localEvents].sort((a, b) => a.timestamp_mu - b.timestamp_mu);
    const core = this.core.toDict();
    return {
      name: this.name,
      now_mu: core.now_mu,
      now_us: Math.round((core.now_mu / MU_PER_SEC) * 1e6 * 1000) / 1000,
      rtio_counter_mu: core.rtio_counter_mu,
      slack_mu: core.slack_mu,
      positive_slack: core.positive_slack,
      underflow_count: core.underflow_count,
      last_underflow: core.last_underflow,
      event_count: events.length,
      events,
      source: "artiq-rtio-model",
      refs: REFS,
      ref: REFS.manual,
    };
  }
}

export function runCsidKernel(
  spaceId: string,
  intent = "JOIN_LISTEN",
  opts?: {
    nSteps?: number;
    stepDelayUs?: number;
    pulseUs?: number;
    gateUs?: number;
    reset?: boolean;
    wrNode?: string | null;
    wrSync?: boolean;
  },
): Record<string, unknown> {
  const nSteps = opts?.nSteps ?? 4;
  const stepDelayUs = opts?.stepDelayUs ?? 250;
  const pulseUs = opts?.pulseUs ?? 50;
  const gateUs = opts?.gateUs ?? 100;
  const doReset = opts?.reset !== false;
  const wrNode = opts?.wrNode === undefined ? "node.edge" : opts.wrNode;
  const wrSync = opts?.wrSync !== false;

  const k = new Kernel(`csid::${spaceId}`);
  let whiteRabbit: Record<string, unknown> | null = null;
  if (wrNode) {
    try {
      k.core.attachWhiteRabbit(wrNode, wrSync);
      const n = ensureLocked(wrNode);
      whiteRabbit = {
        node: wrNode,
        locked: n.locked,
        offset_mu: n.offset_mu,
        delay_mu: n.last_delay_mu,
        residual_ps: n.last_residual_ps,
        gm: "gm.intent",
        ref: REFS.white_rabbit,
      };
    } catch (e) {
      whiteRabbit = {
        node: wrNode,
        locked: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  if (doReset) k.reset();

  const snapshots: CsidSnapshot[] = [];
  let underflowsCaught = 0;

  k.submit("host", "marker", { msg: "kernel_enter", spaceId, intent });

  for (let i = 0; i < nSteps; i++) {
    // Host-side CSID sample ≡ RPC (wall advances)
    const snap = generateEdgeCsid(spaceId, intent);
    k.breakRealtime();

    const stamped = {
      ...snap,
      step: i,
      timestamp_mu: k.nowMu(),
      slack_mu_after_rpc: k.slackMu(),
    };
    snapshots.push(stamped as CsidSnapshot);

    try {
      const endGate = k.gateRising(gateUs * 1e-6, "csid.in");
      k.beginParallel();
      k.submit("csid.field", "csid_step", {
        step: i,
        M: snap.meanMagnetization,
        I: snap.interference,
        D: snap.diffusionNorm,
        S: snap.semanticEntropy,
        backend: snap.backend,
        kelvin: snap.kelvin,
      });
      k.delay(stepDelayUs * 1e-6);
      k.branch();
      k.ttlPulse("csid.out", pulseUs * 1e-6, { step: i, spaceId });
      k.endParallel();
      const nEdges = Math.floor(Math.abs(snap.interference || 0) * 100);
      k.countUntil(endGate, nEdges);
      k.breakRealtime();
      k.delay(stepDelayUs * 1e-6);
    } catch (e) {
      if (e instanceof RTIOUnderflow) {
        underflowsCaught += 1;
        k.breakRealtime();
        k.submit("host", "marker", { msg: "underflow_recovered", step: i }, {
          allowUnderflow: true,
        });
      } else {
        throw e;
      }
    }
  }

  k.breakRealtime();
  k.submit("host", "marker", { msg: "kernel_exit", steps: nSteps });

  const interferences = snapshots.map((s) => s.interference || 0);
  const mags = snapshots.map((s) => s.meanMagnetization || 0);
  const last = snapshots[snapshots.length - 1];

  return {
    kernel: k.toDict(),
    core: k.core.toDict(),
    whiteRabbit,
    spaceId,
    intent,
    steps: nSteps,
    snapshots,
    aggregate: {
      meanInterference:
        interferences.reduce((a, b) => a + b, 0) / Math.max(1, interferences.length),
      meanMagnetization: mags.reduce((a, b) => a + b, 0) / Math.max(1, mags.length),
      lastKelvin: last?.kelvin,
      backend: last?.backend,
      underflowsCaught,
      wrLocked: Boolean(whiteRabbit && whiteRabbit.locked),
    },
    primary: "ARTIQ_CSID_KERNEL",
    refs: REFS,
    ref: REFS.manual,
    ts: new Date().toISOString(),
  };
}
