/**
 * SIWE auth-token minting, shared verbatim by both protocols.
 *
 * The x402 and MPP SIWE messages are field-for-field identical except for the
 * domain/uri pair, so there is exactly one implementation here.
 *
 * We build the message with viem/siwe directly rather than @alchemy/x402's
 * `signSiwe()`. The MPP contract's own example does exactly this
 * (`createSiweMessage` + `generateSiweNonce`), `signSiwe()`'s options beyond
 * `{ privateKey, expiresAfter }` are undocumented (no way to set domain), and
 * this removes a vendor dependency from the auth path entirely.
 */

import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import type { GatewaySigner } from "./signer";
import { memoryStore, type TokenStore } from "./store";
import type { Hex, Transport } from "./types";

export const GATEWAY_DOMAIN: Readonly<Record<Transport, string>> = {
  x402: "x402.alchemy.com",
  mpp: "mpp.alchemy.com",
};

export const GATEWAY_ORIGIN: Readonly<Record<Transport, string>> = {
  x402: "https://x402.alchemy.com",
  mpp: "https://mpp.alchemy.com",
};

export const SIWE_STATEMENT = "Sign in to Alchemy Gateway";

/**
 * ALWAYS 8453 (Base Mainnet), regardless of which chain the request targets.
 * Both contracts state this explicitly and both flag inferring it from the
 * queried chain as wrong.
 */
export const SIWE_CHAIN_ID = 8453;

export const SIWE_TTL_MS = 60 * 60 * 1000;
export const SIWE_VERSION = "1";

export interface SiweToken {
  /** `${base64(message)}.${signature}` — exactly one "." separator. */
  readonly token: string;
  readonly address: Hex;
  readonly domain: string;
  readonly expiresAt: number;
}

/** base64 that works in both Node and a Worker. SIWE messages are ASCII. */
function toBase64(value: string): string {
  const g = globalThis as { btoa?: (s: string) => string };
  if (typeof g.btoa === "function") return g.btoa(value);
  const buf = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(e: string): string } } }).Buffer;
  if (buf) return buf.from(value, "utf8").toString("base64");
  throw new Error("No base64 encoder available in this runtime");
}

export function decodeSiweToken(token: string): { message: string; signature: string } {
  const idx = token.indexOf(".");
  if (idx < 0 || token.indexOf(".", idx + 1) >= 0) {
    throw new Error("Malformed SIWE token: expected exactly one '.' separator");
  }
  const b64 = token.slice(0, idx);
  const g = globalThis as { atob?: (s: string) => string };
  const message =
    typeof g.atob === "function"
      ? g.atob(b64)
      : (globalThis as { Buffer: { from(s: string, e: string): { toString(e: string): string } } }).Buffer
          .from(b64, "base64")
          .toString("utf8");
  return { message, signature: token.slice(idx + 1) };
}

export interface MintSiweOptions {
  signer: GatewaySigner;
  transport: Transport;
  ttlMs?: number;
  now?: () => number;
  nonce?: () => string;
}

export async function mintSiweToken(options: MintSiweOptions): Promise<SiweToken> {
  const { signer, transport } = options;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? SIWE_TTL_MS;
  const issuedAt = now();
  const expiresAt = issuedAt + ttlMs;
  const domain = GATEWAY_DOMAIN[transport];

  const message = createSiweMessage({
    address: signer.address,
    chainId: SIWE_CHAIN_ID,
    domain,
    nonce: (options.nonce ?? generateSiweNonce)(),
    uri: GATEWAY_ORIGIN[transport],
    version: SIWE_VERSION,
    statement: SIWE_STATEMENT,
    issuedAt: new Date(issuedAt),
    expirationTime: new Date(expiresAt),
  });

  const signature = await signer.signMessage(message);
  return { token: `${toBase64(message)}.${signature}`, address: signer.address, domain, expiresAt };
}

export interface SiweTokenCacheOptions {
  signer: GatewaySigner;
  store?: TokenStore;
  ttlMs?: number;
  /** Remint this far before hard expiry so an in-flight request cannot straddle it. */
  skewMs?: number;
  now?: () => number;
  nonce?: () => string;
}

/**
 * One cached token per transport. Reminted only on expiry or explicit
 * invalidate(). An over-eager cache miss costs a real settlement, so this is a
 * cost lever, not a latency one.
 */
export class SiweTokenCache {
  private readonly signer: GatewaySigner;
  private readonly store: TokenStore;
  private readonly ttlMs: number;
  private readonly skewMs: number;
  private readonly now: () => number;
  private readonly nonce?: () => string;
  private readonly inflight = new Map<Transport, Promise<SiweToken>>();

  constructor(options: SiweTokenCacheOptions) {
    this.signer = options.signer;
    this.now = options.now ?? Date.now;
    this.store = options.store ?? memoryStore(this.now);
    this.ttlMs = options.ttlMs ?? SIWE_TTL_MS;
    this.skewMs = options.skewMs ?? 60_000;
    this.nonce = options.nonce;
  }

  private key(transport: Transport): string {
    return `siwe:${transport}:${this.signer.address.toLowerCase()}`;
  }

  async get(transport: Transport): Promise<SiweToken> {
    const pending = this.inflight.get(transport);
    if (pending) return await pending;

    const task = this.load(transport).finally(() => this.inflight.delete(transport));
    this.inflight.set(transport, task);
    return await task;
  }

  private async load(transport: Transport): Promise<SiweToken> {
    const raw = await this.store.get(this.key(transport));
    if (raw) {
      try {
        const cached = JSON.parse(raw) as SiweToken;
        if (cached.expiresAt - this.skewMs > this.now()) return cached;
      } catch {
        // Corrupt entry: fall through and remint.
      }
    }

    const minted = await mintSiweToken({
      signer: this.signer,
      transport,
      ttlMs: this.ttlMs,
      now: this.now,
      nonce: this.nonce,
    });
    await this.store.put(this.key(transport), JSON.stringify(minted), Math.ceil(this.ttlMs / 1000));
    return minted;
  }

  async invalidate(transport: Transport): Promise<void> {
    this.inflight.delete(transport);
    await this.store.delete(this.key(transport));
  }
}
