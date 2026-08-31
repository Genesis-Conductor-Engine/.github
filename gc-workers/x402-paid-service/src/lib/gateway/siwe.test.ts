/**
 * SIWE token minting and caching.
 *
 * Every field of the signed message is asserted, because a single wrong field is
 * a 401 the gateway describes as a configuration bug you must fix in code — and
 * `domain` in particular is the only thing distinguishing an x402 token from an
 * MPP one.
 *
 * The cache assertions are cost assertions, not latency ones: payment is charged
 * per AUTH TOKEN, so an over-eager cache miss buys a second settlement.
 */

import { describe, expect, it, vi } from "vitest";
import {
  decodeSiweToken,
  GATEWAY_DOMAIN,
  GATEWAY_ORIGIN,
  mintSiweToken,
  SIWE_CHAIN_ID,
  SIWE_STATEMENT,
  SIWE_TTL_MS,
  SiweTokenCache,
} from "./siwe";
import { signerFromPrivateKey, type GatewaySigner } from "./signer";
import { memoryStore } from "./store";
import type { Hex, Transport } from "./types";

const KEY = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const ADDRESS = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const T0 = 1_800_000_000_000;

function countingSigner(): GatewaySigner & { calls: () => number } {
  const inner = signerFromPrivateKey(KEY);
  let calls = 0;
  return {
    address: inner.address,
    async signMessage(message: string) {
      calls += 1;
      return await inner.signMessage(message);
    },
    withPrivateKey: inner.withPrivateKey.bind(inner),
    calls: () => calls,
  };
}

function fields(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of message.split("\n")) {
    const m = /^([A-Za-z ]+): (.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe("mintSiweToken", () => {
  it.each<[Transport]>([["x402"], ["mpp"]])("signs every documented field for %s", async (transport) => {
    const signer = signerFromPrivateKey(KEY);
    const token = await mintSiweToken({
      signer,
      transport,
      now: () => T0,
      nonce: () => "abcd1234efgh",
    });

    const { message, signature } = decodeSiweToken(token.token);
    const f = fields(message);

    expect(message.startsWith(`${GATEWAY_DOMAIN[transport]} wants you to sign in`)).toBe(true);
    expect(message).toContain(ADDRESS);
    expect(message).toContain(SIWE_STATEMENT);
    expect(f.URI).toBe(GATEWAY_ORIGIN[transport]);
    expect(f.URI).toBe(`https://${GATEWAY_DOMAIN[transport]}`);
    expect(f.Version).toBe("1");
    // ALWAYS Base, never the chain being queried.
    expect(f["Chain ID"]).toBe(String(SIWE_CHAIN_ID));
    expect(f["Chain ID"]).toBe("8453");
    expect(f.Nonce).toMatch(/^[A-Za-z0-9]{8,}$/);
    expect(new Date(f["Expiration Time"]).getTime()).toBe(T0 + SIWE_TTL_MS);
    expect(signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(token.domain).toBe(GATEWAY_DOMAIN[transport]);
  });

  it("emits exactly one '.' separator (the INVALID_AUTH_FORMAT guard)", async () => {
    const token = await mintSiweToken({ signer: signerFromPrivateKey(KEY), transport: "x402", now: () => T0 });
    expect(token.token.split(".")).toHaveLength(2);
  });

  it("produces messages that differ ONLY in domain and uri", async () => {
    const signer = signerFromPrivateKey(KEY);
    const args = { signer, now: () => T0, nonce: () => "abcd1234efgh" } as const;
    const a = decodeSiweToken((await mintSiweToken({ ...args, transport: "x402" })).token).message;
    const b = decodeSiweToken((await mintSiweToken({ ...args, transport: "mpp" })).token).message;

    const normalize = (s: string) => s.split("x402.alchemy.com").join("§").split("mpp.alchemy.com").join("§");
    expect(normalize(a)).toBe(normalize(b));
    expect(a).not.toBe(b);
  });

  it("does not infer chainId from the chain being queried", async () => {
    // There is deliberately no chain parameter to pass — solana-mainnet,
    // polygon-mainnet and eth-mainnet all get the same Base-pinned message.
    const token = await mintSiweToken({ signer: signerFromPrivateKey(KEY), transport: "x402", now: () => T0 });
    expect(fields(decodeSiweToken(token.token).message)["Chain ID"]).toBe("8453");
  });
});

describe("SiweTokenCache", () => {
  it("signs exactly once for repeated gets inside the TTL", async () => {
    const signer = countingSigner();
    let now = T0;
    const cache = new SiweTokenCache({ signer, store: memoryStore(() => now), now: () => now });

    const first = await cache.get("x402");
    const second = await cache.get("x402");
    expect(second.token).toBe(first.token);
    expect(signer.calls()).toBe(1);
  });

  it("remints with a fresh nonce once the skew window is entered", async () => {
    const signer = countingSigner();
    let now = T0;
    const cache = new SiweTokenCache({ signer, store: memoryStore(() => now), now: () => now, skewMs: 60_000 });

    const first = await cache.get("x402");
    now = T0 + SIWE_TTL_MS - 59_000;
    const second = await cache.get("x402");

    expect(second.token).not.toBe(first.token);
    expect(signer.calls()).toBe(2);
    const nonceOf = (t: string) => fields(decodeSiweToken(t).message).Nonce;
    expect(nonceOf(second.token)).not.toBe(nonceOf(first.token));
  });

  it("remints after invalidate()", async () => {
    const signer = countingSigner();
    const cache = new SiweTokenCache({ signer, store: memoryStore(() => T0), now: () => T0 });
    await cache.get("mpp");
    await cache.invalidate("mpp");
    await cache.get("mpp");
    expect(signer.calls()).toBe(2);
  });

  it("keeps the two transports' tokens independent", async () => {
    const signer = countingSigner();
    const cache = new SiweTokenCache({ signer, store: memoryStore(() => T0), now: () => T0 });
    const x = await cache.get("x402");
    const m = await cache.get("mpp");
    expect(x.domain).toBe("x402.alchemy.com");
    expect(m.domain).toBe("mpp.alchemy.com");
    expect(signer.calls()).toBe(2);
    await cache.invalidate("x402");
    await cache.get("mpp");
    expect(signer.calls()).toBe(2);
  });

  it("reuses a token recovered from the store rather than paying to remint", async () => {
    const store = memoryStore(() => T0);
    const signerA = countingSigner();
    const first = await new SiweTokenCache({ signer: signerA, store, now: () => T0 }).get("x402");

    // A fresh cache, as after an isolate restart: same store, same signer address.
    const signerB = countingSigner();
    const second = await new SiweTokenCache({ signer: signerB, store, now: () => T0 }).get("x402");

    expect(second.token).toBe(first.token);
    expect(signerB.calls()).toBe(0);
  });

  it("collapses concurrent gets into a single signature", async () => {
    const signer = countingSigner();
    const spy = vi.spyOn(signer, "signMessage");
    const cache = new SiweTokenCache({ signer, store: memoryStore(() => T0), now: () => T0 });
    await Promise.all([cache.get("x402"), cache.get("x402"), cache.get("x402")]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
