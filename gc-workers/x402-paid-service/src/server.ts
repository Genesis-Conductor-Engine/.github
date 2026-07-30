/**
 * Node HTTP entry point for the x402 paid service, for running as a Node service
 * inside a Podman container instead of as a Cloudflare Worker.
 *
 * It reuses the platform-agnostic handler exported by ./index unchanged: Node
 * 18+ provides the Fetch API globals (Request, Response, Headers, fetch, URL)
 * the handler is written against, so this file only has to
 *   1. build the `env` object from the secret resolver (env binding is absent in
 *      Node, so values come from /run/secrets/<name> then process.env), and
 *   2. adapt node:http's IncomingMessage/ServerResponse to a Fetch Request and
 *      back from a Fetch Response, and
 *   3. supply a concrete ExecutionContext whose waitUntil keeps background work
 *      (e.g. the gas cron) alive until it settles.
 *
 * Secrets are injected by Podman as native secrets mounted at /run/secrets/<name>;
 * this process never reads the host .vault layout. See src/lib/secrets.ts.
 *
 * Run: `tsx src/server.ts` (PORT env, default 8080).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import worker from './index';
import { resolveSecret } from './lib/secrets';
import type { ExecutionContext, ScheduledEvent } from './runtime-types';

// Every Env field the handler reads. Any of these may be supplied as a Podman
// secret (/run/secrets/<name>) or a plain environment variable; resolveSecret
// checks both. Non-secret config (tier prices, URLs) rides the same path so the
// operator can choose per value without code changes.
const ENV_KEYS = [
  'VAULT_ADDRESS',
  'USDC_ADDRESS',
  'CHAIN_ID',
  'PRICE_USD6',
  'X402_FACILITATOR_MODE',
  'TIER_DISCOVERY_USD6',
  'TIER_PRO_USD6',
  'TIER_INFERENCE_USD6',
  'TIER_SPECIALIZED_USD6',
  'TIER_FOUNDERS_USD6',
  'TIER_SOURCE_EXCLUSIVE_USD6',
  'SHOPIFY_FOUNDERS_URL',
  'SHOPIFY_SOURCE_EXCLUSIVE_URL',
  'SHOPIFY_STORE_DOMAIN',
  'CDP_API_KEY_ID',
  'CDP_API_KEY_SECRET',
  'BASE_RPC_URL',
  'MAIN_WALLET',
  'GAS_ALERT_WEBHOOK',
] as const;

// Cap the request body well below anything the tier handlers need. Defense in
// depth against a parse-stage memory attack; the tier logic has its own limits.
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

async function buildEnv(): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {};
  await Promise.all(
    ENV_KEYS.map(async (k) => {
      env[k] = await resolveSecret(k);
    }),
  );
  return env;
}

/** Collect the request body with a hard byte cap. Rejects when the cap is hit. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Adapt a node:http request into a Fetch Request the handler understands. */
function toFetchRequest(req: IncomingMessage, body: Buffer): Request {
  // Honor a reverse proxy so discovery documents advertise the public host.
  const fwdHost = firstHeader(req.headers['x-forwarded-host']);
  const host = fwdHost ?? req.headers.host ?? 'localhost';
  const url = `http://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD' && body.length > 0;
  return new Request(url, { method, headers, body: hasBody ? body : undefined });
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

async function writeFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

function makeCtx(pending: Promise<unknown>[]): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>) {
      pending.push(Promise.resolve(promise).catch((e) => console.error('[waitUntil]', e)));
    },
    passThroughOnException() {
      /* no-op in Node */
    },
  };
}

async function main(): Promise<void> {
  const env = await buildEnv();
  if (!env.VAULT_ADDRESS) {
    // Fail closed: without a payout address every 402 challenge is malformed.
    console.error('[startup] VAULT_ADDRESS is not set (env binding, /run/secrets, or process.env). Refusing to start.');
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? '8080');
  const pending: Promise<unknown>[] = [];

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const body = await readBody(req);
        const request = toFetchRequest(req, body);
        const response = await worker.fetch(request, env as never, makeCtx(pending) as never);
        await writeFetchResponse(res, response);
      } catch (e) {
        if ((e as Error).message === 'body_too_large') {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }
        console.error('[request] handler error:', e);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal error' }));
        }
      }
    })();
  });

  // Optional in-process gas cron (the Worker used a Cloudflare cron trigger).
  // Off by default; enable with GAS_CRON_INTERVAL_MS to run the same check.
  const cronMs = Number(process.env.GAS_CRON_INTERVAL_MS ?? '0');
  let cronTimer: ReturnType<typeof setInterval> | undefined;
  if (cronMs > 0 && typeof worker.scheduled === 'function') {
    cronTimer = setInterval(() => {
      const event: ScheduledEvent = { scheduledTime: Date.now(), cron: 'node-interval' };
      void worker.scheduled(event as never, env as never, makeCtx(pending) as never);
    }, cronMs);
  }

  server.listen(port, () => {
    console.log(`[x402] Node service listening on :${port} (gas cron: ${cronMs > 0 ? `${cronMs}ms` : 'off'})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[x402] ${signal} received, draining...`);
    if (cronTimer) clearInterval(cronTimer);
    server.close(async () => {
      await Promise.allSettled(pending);
      process.exit(0);
    });
    // Hard stop if draining stalls.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
