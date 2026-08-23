/**
 * Token persistence port.
 *
 * A SIWE token costs REAL MONEY to establish: both protocols charge on the first
 * call per auth token and then serve free for that token's ~1h life. Losing a
 * token to isolate churn or a process restart therefore costs a second
 * settlement. That makes persistence a cost control, not a performance tweak.
 */

import type { KVNamespace } from "../../runtime-types";

export interface TokenStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/** Process-local store with real TTL semantics against an injectable clock. */
export function memoryStore(now: () => number = Date.now): TokenStore {
  const map = new Map<string, MemoryEntry>();
  return {
    async get(key: string): Promise<string | null> {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= now()) {
        map.delete(key);
        return null;
      }
      return hit.value;
    },
    async put(key: string, value: string, ttlSeconds: number): Promise<void> {
      map.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    async delete(key: string): Promise<void> {
      map.delete(key);
    },
  };
}

/**
 * Cloudflare KV-backed store. `delete` is optional on the local KVNamespace
 * shape (see src/runtime-types.ts) because the existing binding surface never
 * needed it; when absent we no-op rather than throw, and rely on the TTL.
 */
export function kvStore(kv: KVNamespace, prefix = "gateway:"): TokenStore {
  return {
    async get(key: string): Promise<string | null> {
      return await kv.get(prefix + key);
    },
    async put(key: string, value: string, ttlSeconds: number): Promise<void> {
      await kv.put(prefix + key, value, { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) });
    },
    async delete(key: string): Promise<void> {
      const del = (kv as KVNamespace & { delete?: (k: string) => Promise<void> }).delete;
      if (typeof del === "function") await del.call(kv, prefix + key);
    },
  };
}
