/**
 * Unified evolve: White Rabbit → ARTIQ CSID kernel → Ralph metrics (dry).
 * Compatible with gc-crew-mcp-bridge evolve_hook payload shape.
 */

import { runCsidKernel } from "./artiq_rtio";
import { getNetwork } from "./white_rabbit";

export const SOURCE = "intent-artiq-wr-evolve";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function scoreQuality(
  kernelResult: Record<string, unknown>,
): number {
  const agg = (kernelResult.aggregate || {}) as Record<string, number>;
  const k = (kernelResult.kernel || {}) as Record<string, unknown>;
  const i = Math.abs(Number(agg.meanInterference || 0));
  const m = Math.abs(Number(agg.meanMagnetization || 0));
  const uf = Number(agg.underflowsCaught || k.underflow_count || 0);
  const wr = (kernelResult.whiteRabbit || {}) as Record<string, unknown>;
  const wrLocked = Boolean(wr.locked);
  const posSlack = Boolean(k.positive_slack);
  let q = 0.35 * clamp01(i * 2) + 0.25 * clamp01(m) + 0.2;
  if (wrLocked) q += 0.12;
  if (posSlack) q += 0.1;
  q -= Math.min(0.25, uf * 0.08);
  return Math.round(clamp01(q) * 10000) / 10000;
}

export function classifyGoal(
  quality: number,
  wrLocked: boolean,
  posSlack: boolean,
): string {
  if (quality >= 0.75 && wrLocked && posSlack) return "reached";
  if (quality >= 0.4) return "partial";
  if (quality >= 0.15) return "not_reached";
  return "unknown";
}

export function runEvolveCycle(
  spaceId: string,
  intent = "JOIN_LISTEN",
  opts?: { nSteps?: number; wrNode?: string; candidateId?: string },
): Record<string, unknown> {
  const t0 = performance.now();
  const nSteps = opts?.nSteps ?? 3;
  const wrNode = opts?.wrNode ?? "node.edge";
  const wrSync = getNetwork().syncAll();

  const kernel = runCsidKernel(spaceId, intent, {
    nSteps,
    wrNode,
    wrSync: true,
    reset: true,
  });

  const latency_ms = performance.now() - t0;
  const quality = scoreQuality(kernel);
  const wr = (kernel.whiteRabbit || {}) as Record<string, unknown>;
  const k = (kernel.kernel || {}) as Record<string, unknown>;
  const wrLocked = Boolean(wr.locked);
  const posSlack = Boolean(k.positive_slack);
  const goal_status = classifyGoal(quality, wrLocked, posSlack);
  const candidate_id =
    opts?.candidateId || `csid::${spaceId}::wr::${wrNode}`;

  const metrics = {
    quality,
    latency_ms: Math.round(latency_ms * 100) / 100,
    cost_usdc6: 0,
    goal_status,
    candidate_id,
    source: SOURCE,
    context: {
      spaceId,
      intent,
      wr_node: wrNode,
      wr_locked: wrLocked,
      positive_slack: posSlack,
      meanInterference: (kernel.aggregate as Record<string, unknown>)
        ?.meanInterference,
      backend: (kernel.aggregate as Record<string, unknown>)?.backend,
      steps: nSteps,
    },
  };

  return {
    ok: true,
    primary: "EVOLVE_CYCLE",
    generation: {
      spaceId,
      intent,
      steps: nSteps,
      wr_node: wrNode,
      latency_ms: metrics.latency_ms,
    },
    whiteRabbit: kernel.whiteRabbit,
    wr_sync: {
      rounds: wrSync.sync_rounds,
      grandmaster: wrSync.grandmaster,
      nodes_locked: Object.fromEntries(
        Object.entries(wrSync.nodes || {}).map(([n, nd]) => [
          n,
          Boolean((nd as { locked?: boolean }).locked),
        ]),
      ),
    },
    kernel: {
      name: k.name,
      now_mu: k.now_mu,
      slack_mu: k.slack_mu,
      positive_slack: posSlack,
      event_count: k.event_count,
    },
    aggregate: kernel.aggregate,
    metrics,
    goal_status,
    quality,
    ts: new Date().toISOString(),
    source: SOURCE,
    dry_run: true,
    hint: "metrics match gc-crew-mcp evolve-dry shape; no live pay",
  };
}
