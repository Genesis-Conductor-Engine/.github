/**
 * Minimal platform types for the request handler.
 *
 * The handler in index.ts is written entirely against Fetch API globals
 * (Request, Response, URL, fetch, Headers), which exist in both Cloudflare
 * Workers and Node 18+. The only Cloudflare-specific types it references are the
 * four below. Defining them locally lets the code typecheck under `@types/node`
 * without pulling in `@cloudflare/workers-types`, whose ambient Request/Response/
 * fetch declarations conflict with Node's own globals.
 *
 * The Node entry point (server.ts) supplies a concrete ExecutionContext; the
 * (optional) Cloudflare Worker deployment supplies its own. KVNamespace and
 * AnalyticsEngineDataset appear in the Env interface but are not used by any code
 * path, so they are aliased to `unknown`.
 */

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}

// KVNamespace is declared in Env but unused by the handler.
export type KVNamespace = unknown;

// AnalyticsEngineDataset is used optionally (env.ANALYTICS?.writeDataPoint) to
// record settled payments. In the Cloudflare deployment the real binding is
// present; in Node it is simply absent and the optional chain no-ops.
export interface AnalyticsEngineDataset {
  writeDataPoint(event: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}
