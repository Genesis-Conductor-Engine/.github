/**
 * THE CUSTODY TESTS.
 *
 * Treat any failure in this file as a security failure, not a test failure. The
 * three properties asserted here are the whole reason the gateway signing key is
 * not a Cloudflare Worker secret:
 *   - a Worker cannot construct a signer;
 *   - a key placed on an env binding is inert AND loud;
 *   - the signer can never be the receive-only revenue vault or the main wallet.
 *
 * No network, no funded wallet, no real key: the private keys below are the
 * canonical throwaway test vectors 0x…01 and 0x…02.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_SIGNER_ADDRESSES,
  GATEWAY_KEY_SECRET,
  GatewayKeyForbiddenAddressError,
  GatewayKeyMisplacedError,
  GatewayKeyUnavailableError,
  loadGatewaySigner,
  MAIN_WALLET,
  signerFromPrivateKey,
  VAULT_ADDRESS,
} from "./signer";
import type { Hex } from "./types";

const KEY_A = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const ADDRESS_A = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const KEY_B = "0x0000000000000000000000000000000000000000000000000000000000000002" as Hex;

const SIGNER_SOURCE = readFileSync(new URL("./signer.ts", import.meta.url), "utf8");

/** Swap globalThis.process for a stand-in, then always put the real one back. */
async function withProcess<T>(replacement: unknown, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.process;
  Object.defineProperty(globalThis, "process", { value: replacement, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, "process", { value: real, configurable: true, writable: true });
  }
}

afterEach(() => {
  delete process.env[GATEWAY_KEY_SECRET];
});

describe("key custody", () => {
  it("derives the documented address for a known viem test vector", () => {
    expect(signerFromPrivateKey(KEY_A).address).toBe(ADDRESS_A);
  });

  it("refuses to build a signer outside a Node runtime — a Worker cannot sign", async () => {
    await withProcess({ env: {} }, async () => {
      await expect(loadGatewaySigner()).rejects.toBeInstanceOf(GatewayKeyUnavailableError);
    });
  });

  it("throws GatewayKeyMisplacedError when the key rides an env binding", async () => {
    // i.e. `wrangler secret put ALCHEMY_GATEWAY_PRIVATE_KEY` is inert, and loud.
    await expect(loadGatewaySigner({ [GATEWAY_KEY_SECRET]: KEY_A })).rejects.toBeInstanceOf(
      GatewayKeyMisplacedError,
    );
  });

  it("ignores a binding object that does not carry the key, and reads process.env", async () => {
    process.env[GATEWAY_KEY_SECRET] = KEY_A;
    const signer = await loadGatewaySigner({ SOME_OTHER_VAR: "x" });
    expect(signer.address).toBe(ADDRESS_A);
  });

  it("throws GatewayKeyUnavailableError when the secret is simply absent", async () => {
    await expect(loadGatewaySigner()).rejects.toBeInstanceOf(GatewayKeyUnavailableError);
  });
});

describe("forbidden-address guard", () => {
  it("names the revenue vault and the main wallet, exactly as wrangler.toml does", () => {
    expect(VAULT_ADDRESS).toBe("0x60C4499870f115664d7FfD8411b023DBEf3377d9");
    expect(MAIN_WALLET).toBe("0x967a9C352a87D3a72baa7aD10632A7276101dBc9");
    expect(FORBIDDEN_SIGNER_ADDRESSES).toContain(VAULT_ADDRESS);
    expect(FORBIDDEN_SIGNER_ADDRESSES).toContain(MAIN_WALLET);
  });

  it.each([
    ["checksummed", ADDRESS_A],
    ["lowercase", ADDRESS_A.toLowerCase()],
    ["uppercase", `0x${ADDRESS_A.slice(2).toUpperCase()}`],
  ])("refuses a signer whose derived address matches a reserved one (%s)", (_label, form) => {
    try {
      signerFromPrivateKey(KEY_A, { forbiddenAddresses: [form] });
      throw new Error("expected GatewayKeyForbiddenAddressError");
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayKeyForbiddenAddressError);
      expect((err as GatewayKeyForbiddenAddressError).derived).toBe(ADDRESS_A);
    }
  });

  it("adds to the reserved list rather than replacing it, so [] cannot widen anything", () => {
    // Proven at the source level: no key deriving to the vault address exists to
    // test with, so we assert the construction that makes the guard sound.
    expect(SIGNER_SOURCE).toMatch(/\[\s*\.\.\.FORBIDDEN_SIGNER_ADDRESSES\s*,/);
    expect(signerFromPrivateKey(KEY_B, { forbiddenAddresses: [] }).address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("has no parameter, flag, or string that suppresses the guard", () => {
    const hatch = /\b(override|bypass|force|disable|opt-?out|i-accept|allow[-_]?(hot|edge|unsafe))/i;
    expect(SIGNER_SOURCE).not.toMatch(hatch);
  });
});

describe("key exposure", () => {
  it("keeps the raw key out of the signer object entirely", async () => {
    const signer = signerFromPrivateKey(KEY_A);
    await signer.signMessage("hello");
    await signer.withPrivateKey(async (pk) => {
      expect(pk).toBe(KEY_A);
      return null;
    });

    expect(JSON.stringify(signer)).not.toContain(KEY_A.slice(2));
    expect(JSON.stringify(Object.values(signer))).not.toContain(KEY_A.slice(2));
    expect(Object.getOwnPropertyNames(signer).join(",")).not.toContain(KEY_A.slice(2));
  });

  it("keeps the raw key out of thrown errors raised inside withPrivateKey", async () => {
    const signer = signerFromPrivateKey(KEY_A);
    let caught: Error | null = null;
    try {
      await signer.withPrivateKey(async () => {
        throw new Error("credential creation blew up");
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(`${caught?.message ?? ""}${caught?.stack ?? ""}`).not.toContain(KEY_A.slice(2));
  });

  it("exposes the address but never a key-shaped property", () => {
    const signer = signerFromPrivateKey(KEY_A);
    expect(signer.address).toBe(ADDRESS_A);
    for (const name of Object.getOwnPropertyNames(signer)) {
      const value = (signer as unknown as Record<string, unknown>)[name];
      if (typeof value === "string") expect(value).not.toBe(KEY_A);
    }
  });
});
