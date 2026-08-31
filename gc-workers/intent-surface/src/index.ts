/**
 * intent-surface — Cloudflare Worker
 * Hosts web-intent overlay + edge CSID + optional Workers AI (Kimi) evolve.
 * Custom domain: intent.genesisconductor.io
 */

import { generateEdgeCsid, parseSpace, type CsidSnapshot } from "./csid";
import { runCsidKernel } from "./artiq_rtio";
import { runEvolveCycle } from "./evolve_cycle";
import { ORG_INDEX } from "./knowledge_nodes";
import { getNetwork } from "./white_rabbit";

export interface Env {
  ASSETS: Fetcher;
  AI?: Ai;
  /** Optional origin for live THRML daemon CSID (tunnel/origin) */
  CSID_ORIGIN?: string;
  DEFAULT_SPACE?: string;
  /** Workers AI model id */
  KIMI_MODEL?: string;
}

type SpaceState = {
  spaceId: string;
  space: string;
  spaceUrl: string;
  intentUrl: string;
  primary: string;
  updatedAt: string;
};

const DEFAULT_SPACE = "1RKZzzEXjXmKB";

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });
}

function spacePayload(spaceId: string, primary = "JOIN_LISTEN"): SpaceState {
  const spaceUrl = `https://x.com/i/spaces/${spaceId}`;
  const intentUrl =
    "https://x.com/intent/post?" +
    new URLSearchParams({
      text: "Live on X Spaces — web-intent inference stream",
      url: spaceUrl,
    }).toString();
  return {
    spaceId,
    space: spaceId,
    spaceUrl,
    intentUrl,
    primary,
    updatedAt: new Date().toISOString(),
  };
}

/** In-memory last space per isolate (best-effort; edge is ephemeral). */
let lastSpaceId = DEFAULT_SPACE;

async function fetchOriginCsid(env: Env, spaceId: string): Promise<CsidSnapshot | null> {
  if (!env.CSID_ORIGIN) return null;
  try {
    const u = new URL("/api/csid", env.CSID_ORIGIN);
    u.searchParams.set("space", spaceId);
    const r = await fetch(u.toString(), { cf: { cacheTtl: 0 } });
    if (!r.ok) return null;
    return (await r.json()) as CsidSnapshot;
  } catch {
    return null;
  }
}

async function kimiEvolve(
  env: Env,
  snap: CsidSnapshot,
): Promise<string | undefined> {
  if (!env.AI) return undefined;
  const model = env.KIMI_MODEL || "@cf/moonshotai/kimi-k2.7-code";
  const prompt = [
    "You are CSID edge narrator for Genesis Conductor.",
    "Given thermodynamic field metrics for an X Space, write ONE short line (max 140 chars)",
    "of contextual semantic interference diffusion prose. No secrets, no markdown.",
    `spaceId=${snap.spaceId}`,
    `intent=${snap.intent}`,
    `M=${snap.meanMagnetization.toFixed(3)} I=${snap.interference.toFixed(3)}`,
    `D=${snap.diffusionNorm.toFixed(3)} S=${snap.semanticEntropy.toFixed(3)} K=${snap.kelvin}`,
  ].join("\n");

  try {
    // Model id as string — Workers AI accepts @cf/moonshotai/kimi-k2.7-code etc.
    const out = (await env.AI.run(model as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: "Reply with a single concise line only." },
        { role: "user", content: prompt },
      ],
      max_tokens: 80,
    } as Record<string, unknown>)) as Record<string, unknown>;

    let text: string | undefined;
    if (typeof out === "string") text = out;
    else if (typeof out?.response === "string") text = out.response;
    else if (typeof out?.result === "string") text = out.result;
    else {
      const choices = out?.choices as { message?: { content?: string } }[] | undefined;
      text = choices?.[0]?.message?.content;
    }
    if (typeof text === "string" && text.trim()) return text.trim().slice(0, 200);
  } catch {
    /* AI optional */
  }
  return undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
          "access-control-allow-headers": "Content-Type",
        },
      });
    }

    // --- API ---
    if (url.pathname === "/api/health" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "intent-surface",
        edge: true,
        hasAI: Boolean(env.AI),
        csidOrigin: Boolean(env.CSID_ORIGIN),
        defaultSpace: env.DEFAULT_SPACE || DEFAULT_SPACE,
      });
    }

    if (url.pathname === "/api/space") {
      if (request.method === "GET") {
        const q = parseSpace(url.searchParams.get("space"));
        const id = q || lastSpaceId || env.DEFAULT_SPACE || DEFAULT_SPACE;
        return json(spacePayload(id));
      }
      if (request.method === "POST" || request.method === "PUT") {
        let body: Record<string, string> = {};
        try {
          body = (await request.json()) as Record<string, string>;
        } catch {
          body = {};
        }
        const id =
          parseSpace(body.spaceId || body.space || body.url || "") ||
          parseSpace(await request.text().catch(() => ""));
        if (!id) {
          return json(
            { error: "invalid_space", hint: "pass spaceId or full spaces URL" },
            400,
          );
        }
        lastSpaceId = id;
        return json(spacePayload(id));
      }
      return json({ error: "method_not_allowed" }, 405);
    }

    if (url.pathname === "/api/csid" || url.pathname === "/api/csid/") {
      const qSpace =
        parseSpace(url.searchParams.get("space")) ||
        lastSpaceId ||
        env.DEFAULT_SPACE ||
        DEFAULT_SPACE;
      const intent = url.searchParams.get("intent") || "JOIN_LISTEN";

      // Prefer origin THRML daemon when configured
      const originSnap = await fetchOriginCsid(env, qSpace);
      let snap: CsidSnapshot =
        originSnap || generateEdgeCsid(qSpace, intent);

      if (url.searchParams.get("evolve") === "1" || url.searchParams.get("kimi") === "1") {
        const semantic = await kimiEvolve(env, snap);
        if (semantic) snap = { ...snap, semantic, backend: `${snap.backend}+kimi` };
      }

      return json(snap);
    }

    // Unified evolve: WR + ARTIQ CSID kernel + Ralph metrics (GET or POST)
    if (url.pathname === "/api/evolve" || url.pathname === "/api/evolve/") {
      const id =
        parseSpace(url.searchParams.get("space")) ||
        lastSpaceId ||
        env.DEFAULT_SPACE ||
        DEFAULT_SPACE;
      let intent = url.searchParams.get("intent") || "JOIN_LISTEN";
      let nSteps = Math.min(
        12,
        Math.max(1, Number(url.searchParams.get("steps") || 3) || 3),
      );
      let wrNode = url.searchParams.get("wrNode") || "node.edge";
      // Legacy: POST with kimi=1 still adds semantic one-liner on top
      if (request.method === "POST") {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const bid =
            parseSpace(String(body.spaceId || body.space || "")) || id;
          intent = String(body.intent || intent);
          nSteps = Number(body.steps || nSteps) || nSteps;
          wrNode = String(body.wrNode || wrNode);
          const cycle = runEvolveCycle(bid, intent, { nSteps, wrNode });
          if (body.kimi === 1 || body.kimi === true || body.kimi === "1") {
            const snap = generateEdgeCsid(bid, intent);
            const semantic = await kimiEvolve(env, snap);
            return json({ ...cycle, semantic });
          }
          return json(cycle);
        } catch {
          /* fall through GET-style */
        }
      }
      if (request.method === "GET" || request.method === "POST") {
        return json(
          runEvolveCycle(id, intent, {
            nSteps,
            wrNode,
          }),
        );
      }
      return json({ error: "method_not_allowed" }, 405);
    }

    // ARTIQ-inspired CSID kernel (timeline / RTIO events / slack)
    if (url.pathname === "/api/artiq/kernel") {
      const id =
        parseSpace(url.searchParams.get("space")) ||
        lastSpaceId ||
        env.DEFAULT_SPACE ||
        DEFAULT_SPACE;
      const intent = url.searchParams.get("intent") || "JOIN_LISTEN";
      const nSteps = Math.min(
        16,
        Math.max(1, Number(url.searchParams.get("steps") || 4) || 4),
      );
      if (request.method === "POST") {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const bid = parseSpace(String(body.spaceId || body.space || "")) || id;
          const result = runCsidKernel(bid, String(body.intent || intent), {
            nSteps: Number(body.steps || nSteps),
            stepDelayUs: Number(body.stepDelayUs || 250),
            pulseUs: Number(body.pulseUs || 50),
          });
          return json(result);
        } catch {
          /* fall through GET-style */
        }
      }
      return json(
        runCsidKernel(id, intent, {
          nSteps,
          stepDelayUs: Number(url.searchParams.get("stepDelayUs") || 250),
          pulseUs: Number(url.searchParams.get("pulseUs") || 50),
        }),
      );
    }

    if (url.pathname === "/api/artiq" || url.pathname === "/api/artiq/") {
      return json({
        ok: true,
        model: "artiq-rtio-software",
        ref: "https://m-labs.hk/artiq/manual/introduction.html",
        refs: {
          product: "https://m-labs-intl.com/artiq/artiq/",
          manual: "https://m-labs.hk/artiq/manual/introduction.html",
          rtio: "https://m-labs.hk/artiq/manual/rtio.html",
          core: "https://m-labs.hk/artiq/manual/getting_started_core.html",
          white_rabbit: "https://white-rabbit.web.cern.ch/",
          white_rabbit_collab: "https://white-rabbit.tech",
        },
        concepts: [
          "host_vs_kernel",
          "timeline_cursor_now_mu",
          "rtio_counter_mu_wall_clock",
          "white_rabbit_wr_time_mu",
          "slack_positive_negative",
          "delay_delay_mu_at_mu",
          "zero_duration_on_off",
          "ttl_pulse",
          "rtio_underflow",
          "core_reset",
          "break_realtime_after_rpc",
          "parallel_sequential",
          "input_gate_count",
          "seamless_handover",
          "host_rpc",
        ],
        endpoints: {
          kernel: "/api/artiq/kernel?space=&steps=4",
          wr: "/api/wr",
          wr_sync: "/api/wr/sync",
          csid: "/api/csid?space=",
        },
      });
    }

    // White Rabbit fabric (software multi-node lock)
    if (url.pathname === "/api/wr" || url.pathname === "/api/wr/") {
      return json(getNetwork().toDict());
    }
    if (url.pathname === "/api/wr/sync") {
      return json(getNetwork().syncAll());
    }

    // Knowledge-node coins graph (partner registry)
    if (
      url.pathname === "/api/knowledge-nodes" ||
      url.pathname === "/api/knowledge-nodes/" ||
      url.pathname === "/api/knowledge-nodes/org-index.json"
    ) {
      return json(ORG_INDEX);
    }
    if (url.pathname === "/knowledge-graph" || url.pathname === "/knowledge-graph/") {
      return Response.redirect(new URL("/knowledge-graph.html", url).toString(), 302);
    }

    // Root → overlay with default space
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const sid =
        parseSpace(url.searchParams.get("space")) ||
        env.DEFAULT_SPACE ||
        DEFAULT_SPACE;
      return Response.redirect(
        new URL(`/web-intent-inference.html?space=${encodeURIComponent(sid)}`, url).toString(),
        302,
      );
    }

    // Static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return json({ error: "not_found" }, 404);
  },
};
