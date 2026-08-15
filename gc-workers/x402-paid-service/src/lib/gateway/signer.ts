/**
 * THE KEY CUSTODY BOUNDARY.
 *
 * This is the only module in the tree that ever touches private key material.
 * Three properties are enforced here by code, not by convention, and each has a
 * dedicated test in signer.test.ts:
 *
 *   1. RUNTIME GUARD — a Cloudflare Worker cannot construct a signer at all.
 *      `loadGatewaySigner()` requires a Node runtime and throws
 *      GatewayKeyUnavailableError otherwise.
 *
 *   2. BINDING REFUSAL — the key is resolved through src/lib/secrets.ts with the
 *      env-binding source deliberately amputated (we pass `undefined` where the
 *      resolver expects bindings). If a caller hands in a bindings object that
 *      CARRIES the key, we throw GatewayKeyMisplacedError rather than use it. So
 *      `wrangler secret put ALCHEMY_GATEWAY_PRIVATE_KEY` is inert: the Worker
 *      still cannot sign, and it fails loudly instead of silently working.
 *
 *   3. FORBIDDEN-ADDRESS GUARD — the derived address may never equal the
 *      receive-only revenue vault or the existing gas-monitored main wallet.
 *      There is no parameter, env var, or flag that suppresses this check. An
 *      invariant with a documented way around it is not an invariant.
 *
 * The signing key belongs to a NEW, dedicated, low-value, spend-only EOA funded
 * with at most a few dollars of USDC. Its key lives in the sops/age vault and
 * reaches this process as a Podman secret at /run/secrets/<name> (production) or
 * process.env (development). It is never a Cloudflare Worker secret.
 */

import { privateKeyToAccount } from "viem/accounts";
import { resolveSecret, type SecretBindings } from "../secrets";
import type { Hex } from "./types";

/**
 * Intentionally absent from src/index.ts's Env interface, from ENV_KEYS in
 * src/server.ts, and from wrangler.toml. custody-invariants.test.ts fails if any
 * of those three ever gain it.
 */
export const GATEWAY_KEY_SECRET = "ALCHEMY_GATEWAY_PRIVATE_KEY";

/** Receive-only revenue address. No private key for it exists anywhere. */
export const VAULT_ADDRESS = "0x60C4499870f115664d7FfD8411b023DBEf3377d9";
/** Existing gas-monitored signer. Deliberately NOT reused for the gateway. */
export const MAIN_WALLET = "0x967a9C352a87D3a72baa7aD10632A7276101dBc9";

/** Addresses the gateway signer may never be. */
export const FORBIDDEN_SIGNER_ADDRESSES: readonly string[] = [VAULT_ADDRESS, MAIN_WALLET];

export interface GatewaySigner {
  readonly address: Hex;
  /** personal_sign over a SIWE message. Never exposes the key. */
  signMessage(message: string): Promise<Hex>;
  /**
   * Scoped raw-key access, for the payment SDKs that demand the raw hex.
   * The key is an argument for the duration of one call and is never a property
   * of any object — see the leak test in signer.test.ts.
   */
  withPrivateKey<T>(fn: (privateKey: Hex) => Promise<T> | T): Promise<T>;
}

/** Thrown when no Node runtime is present, or the secret is simply absent. */
export class GatewayKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayKeyUnavailableError";
  }
}

/** Thrown when the signing key turns up on an env/binding object. */
export class GatewayKeyMisplacedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayKeyMisplacedError";
  }
}

/** Thrown when the derived address is the revenue vault or the main wallet. */
export class GatewayKeyForbiddenAddressError extends Error {
  readonly derived: Hex;
  readonly matched: string;
  constructor(derived: Hex, matched: string) {
    super(
      `Refusing to build a gateway signer for ${derived}: that address is reserved ` +
        `(${matched}). The gateway must use its own dedicated low-value wallet.`,
    );
    this.name = "GatewayKeyForbiddenAddressError";
    this.derived = derived;
    this.matched = matched;
  }
}

export interface LoadSignerOptions {
  /**
   * EXTRA addresses this signer may never be. These are added to
   * FORBIDDEN_SIGNER_ADDRESSES; they never replace them, so passing `[]` here
   * widens nothing and shrinks nothing.
   */
  forbiddenAddresses?: readonly string[];
}

function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof proc?.versions?.node === "string" && proc.versions.node.length > 0;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Build a signer from a literal key. Test seam, and the shared constructor for
 * loadGatewaySigner(). The forbidden-address check runs unconditionally.
 */
export function signerFromPrivateKey(privateKey: Hex, options?: LoadSignerOptions): GatewaySigner {
  const account = privateKeyToAccount(privateKey);
  const address = account.address as Hex;

  const forbidden = [...FORBIDDEN_SIGNER_ADDRESSES, ...(options?.forbiddenAddresses ?? [])];
  const lower = address.toLowerCase();
  for (const candidate of forbidden) {
    if (candidate.toLowerCase() === lower) {
      throw new GatewayKeyForbiddenAddressError(address, candidate);
    }
  }

  // `privateKey` stays captured in this closure. It is never assigned to a
  // property of the returned object, so it cannot surface through
  // JSON.stringify, Object.values, or property enumeration.
  return {
    address,
    async signMessage(message: string): Promise<Hex> {
      return (await account.signMessage({ message })) as Hex;
    },
    async withPrivateKey<T>(fn: (pk: Hex) => Promise<T> | T): Promise<T> {
      return await fn(privateKey);
    },
  };
}

/**
 * Resolve the gateway signing key from /run/secrets then process.env ONLY, and
 * build a signer from it.
 *
 * @param bindings  A Worker env object, if the caller has one. It is NEVER read
 *                  as a key source; if it carries the key we throw.
 */
export async function loadGatewaySigner(
  bindings?: SecretBindings,
  options?: LoadSignerOptions,
): Promise<GatewaySigner> {
  if (!isNodeRuntime()) {
    throw new GatewayKeyUnavailableError(
      `${GATEWAY_KEY_SECRET} is resolvable only in a Node runtime (/run/secrets or process.env). ` +
        "The Cloudflare Worker deliberately cannot sign.",
    );
  }

  if (bindings && nonEmptyString((bindings as Record<string, unknown>)[GATEWAY_KEY_SECRET])) {
    throw new GatewayKeyMisplacedError(
      `${GATEWAY_KEY_SECRET} was found on an env/binding object. It must live only in the ` +
        "sops/age vault and reach this process via /run/secrets. Remove the binding.",
    );
  }

  // `undefined` for the second argument is load-bearing: it is what skips the
  // env-binding source inside resolveSecret.
  const key = await resolveSecret(GATEWAY_KEY_SECRET, undefined);
  if (!key) {
    throw new GatewayKeyUnavailableError(
      `${GATEWAY_KEY_SECRET} is not available from /run/secrets or process.env.`,
    );
  }

  return signerFromPrivateKey(key as Hex, options);
}
