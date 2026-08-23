/**
 * The ONLY file that knows vendor SDK shapes.
 *
 * Both SDKs are reached through a LAZY dynamic import with a computed specifier,
 * behind the same Node-runtime guard `readSecretFile` uses in src/lib/secrets.ts.
 * Consequences, all deliberate:
 *   - nothing under src/ statically imports "@alchemy/x402" or "mppx", so they
 *     never enter the Worker bundle and `wrangler deploy` cannot break on them
 *     (custody-invariants.test.ts asserts this);
 *   - the SDKs are OPTIONAL runtime dependencies, installed only on the Node
 *     host that actually holds the key;
 *   - no test imports them, so the suite stays fully offline.
 *
 * We never hand our headers to a vendor fetch wrapper. `wrapFetchWithPayment` is
 * documented to corrupt POST bodies on REST endpoints (our Portfolio/Prices
 * calls are REST POSTs) and `Mppx.create` clobbers Authorization on retry. We
 * use the SDKs for credential CREATION only.
 *
 * API shapes verified against @alchemy/x402@0.6.6 and mppx@0.8.17:
 *   @alchemy/x402  createPayment({ privateKey, paymentRequiredHeader }) -> string
 *   mppx           Challenge.fromHeaders / fromHeadersList, Credential.serialize
 *   mppx/client    tempo.charge({ account }) -> { createCredential({ challenge }) }
 *                  stripe({ createToken }) -> Method[] (an ARRAY), each with
 *                  createCredential({ challenge })
 * Note the contracts' curl example (`Credential.from(challenge, { privateKey })`)
 * does NOT exist in mppx 0.8.17 — `from` takes a single parameters object. Both
 * documented call shapes are feature-probed below rather than assumed.
 */

import { privateKeyToAccount } from "viem/accounts";
import { GatewayKeyUnavailableError, type GatewaySigner } from "./signer";
import type { FetchImpl, PaymentRail, Transport } from "./types";

export interface CredentialRequest {
  transport: Transport;
  /** PAYMENT-REQUIRED or WWW-Authenticate, VERBATIM. Never re-encoded. */
  challenge: string;
  rail: PaymentRail;
  /** Hard ceiling in USDC 6-decimal atomic units. Informational to the SDK. */
  maxAmountAtomic: bigint;
  /** Charge size, normalized to USDC 6-decimals, when the 402 disclosed it. */
  amountAtomic?: bigint;
}

export interface CredentialFactory {
  /** Returns the BARE credential token; the transport adapter places it. */
  create(req: CredentialRequest, signer: GatewaySigner): Promise<string>;
  supports(rail: PaymentRail): boolean;
}

export interface SptParams {
  paymentMethod?: string;
  amount: string;
  currency: string;
  expiresAt: number;
  networkId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Mints a Stripe Shared Payment Token. Injected, because the contracts describe
 * two incompatible architectures for this (the gateway's own /mpp/spt endpoint
 * vs. your own server proxying Stripe), and only one of them is real. Injecting
 * it means either drops in without a code change.
 */
export type SptProvider = (params: SptParams) => Promise<string>;

export class GatewayPaymentTooLargeError extends Error {
  readonly requested: string;
  readonly cap: string;
  readonly transport: Transport;
  constructor(requested: string, cap: string, transport: Transport) {
    super(
      `Refusing to sign a ${transport} payment of ${requested} atomic USDC units; ` +
        `the configured cap is ${cap}. The key is not touched for an over-cap charge.`,
    );
    this.name = "GatewayPaymentTooLargeError";
    this.requested = requested;
    this.cap = cap;
    this.transport = transport;
  }
}

/** A rail the installed SDKs cannot serve from a headless Node process. */
export class GatewayRailUnsupportedError extends Error {
  readonly rail: PaymentRail;
  constructor(rail: PaymentRail, detail: string) {
    super(`Payment rail "${rail}" is unavailable: ${detail}`);
    this.name = "GatewayRailUnsupportedError";
    this.rail = rail;
  }
}

function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof proc?.versions?.node === "string" && proc.versions.node.length > 0;
}

/**
 * Lazy import with a NON-LITERAL specifier so neither TypeScript nor a bundler
 * resolves it statically. Guarded so a Worker fails fast and legibly instead of
 * bundle-faulting.
 */
async function importVendor(specifier: string): Promise<Record<string, unknown>> {
  if (!isNodeRuntime()) {
    throw new GatewayKeyUnavailableError(
      `Cannot load "${specifier}": payment credential creation runs only in a Node runtime.`,
    );
  }
  const spec = specifier;
  return (await import(spec)) as Record<string, unknown>;
}

/** Both protocols place the scheme themselves, so store the bare token. */
function stripScheme(value: string): string {
  const trimmed = value.trim();
  return /^payment\s+/i.test(trimmed) ? trimmed.replace(/^payment\s+/i, "") : trimmed;
}

interface MppxMethod {
  name: string;
  createCredential(args: { challenge: unknown }): Promise<unknown>;
}

async function serializeCredential(mppx: Record<string, unknown>, credential: unknown): Promise<string> {
  if (typeof credential === "string") return stripScheme(credential);
  const Credential = mppx.Credential as { serialize?: (c: unknown) => string } | undefined;
  if (typeof Credential?.serialize !== "function") {
    throw new GatewayRailUnsupportedError(
      "usdc-tempo",
      "the installed mppx exposes neither a string credential nor Credential.serialize()",
    );
  }
  return stripScheme(Credential.serialize(credential));
}

/** Parse the MPP challenge into the SDK's Challenge object, probing both shapes. */
function parseMppChallenge(mppx: Record<string, unknown>, header: string, method: string): unknown {
  const Challenge = mppx.Challenge as
    | {
        fromHeadersList?: (h: Headers) => Array<{ method?: string }>;
        fromHeaders?: (h: Headers) => { method?: string } | Array<{ method?: string }>;
      }
    | undefined;
  const headers = new Headers({ "WWW-Authenticate": header });

  let parsed: unknown;
  if (typeof Challenge?.fromHeadersList === "function") parsed = Challenge.fromHeadersList(headers);
  else if (typeof Challenge?.fromHeaders === "function") parsed = Challenge.fromHeaders(headers);
  else {
    throw new GatewayRailUnsupportedError(
      method === "stripe" ? "stripe-card" : "usdc-tempo",
      "the installed mppx exposes neither Challenge.fromHeadersList nor Challenge.fromHeaders",
    );
  }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  const match = list.find((c) => (c as { method?: string })?.method === method);
  if (!match) {
    throw new GatewayRailUnsupportedError(
      method === "stripe" ? "stripe-card" : "usdc-tempo",
      `the 402 challenge does not offer the "${method}" method`,
    );
  }
  return match;
}

export interface SdkCredentialFactoryOptions {
  sptProvider?: SptProvider;
  fetchImpl?: FetchImpl;
  /** SPT lifetime, seconds. */
  sptTtlSeconds?: number;
  /** Stripe payment method id, when the SPT provider expects one. */
  stripePaymentMethod?: string;
}

export function sdkCredentialFactory(options: SdkCredentialFactoryOptions = {}): CredentialFactory {
  const { sptProvider } = options;

  return {
    supports(rail: PaymentRail): boolean {
      if (rail === "stripe-card") return typeof sptProvider === "function";
      return rail === "usdc-base" || rail === "usdc-tempo";
    },

    async create(req: CredentialRequest, signer: GatewaySigner): Promise<string> {
      // Belt and braces: the client checks the cap before we are ever called, so
      // the key is not touched for an over-cap charge. This re-check catches a
      // caller that wires the factory up directly.
      if (req.amountAtomic !== undefined && req.amountAtomic > req.maxAmountAtomic) {
        throw new GatewayPaymentTooLargeError(
          req.amountAtomic.toString(),
          req.maxAmountAtomic.toString(),
          req.transport,
        );
      }

      if (req.transport === "x402") {
        const mod = await importVendor("@alchemy/x402");
        const createPayment = mod.createPayment as
          | ((args: { privateKey: string; paymentRequiredHeader: string }) => Promise<string>)
          | undefined;
        if (typeof createPayment !== "function") {
          throw new GatewayRailUnsupportedError(
            "usdc-base",
            "the installed @alchemy/x402 does not export createPayment()",
          );
        }
        return await signer.withPrivateKey(async (privateKey) => {
          // The PAYMENT-REQUIRED header is ALREADY base64. Passed through
          // verbatim — re-encoding it is the documented #1 x402 footgun.
          const signature = await createPayment({ privateKey, paymentRequiredHeader: req.challenge });
          return stripScheme(signature);
        });
      }

      const mppx = await importVendor("mppx");
      const client = await importVendor("mppx/client");

      if (req.rail === "stripe-card") {
        if (typeof sptProvider !== "function") {
          throw new GatewayRailUnsupportedError(
            "stripe-card",
            "no SPT provider is configured; MPP-Stripe is the only unfunded bootstrap rail and it needs one",
          );
        }
        const stripe = client.stripe as
          | ((args: Record<string, unknown>) => MppxMethod | MppxMethod[])
          | undefined;
        if (typeof stripe !== "function") {
          throw new GatewayRailUnsupportedError("stripe-card", "mppx/client does not export stripe()");
        }
        const built = stripe({
          createToken: async (params: SptParams) => await sptProvider(params),
          ...(options.stripePaymentMethod ? { paymentMethod: options.stripePaymentMethod } : {}),
        });
        const method = (Array.isArray(built) ? built[0] : built) as MppxMethod | undefined;
        if (!method || typeof method.createCredential !== "function") {
          throw new GatewayRailUnsupportedError(
            "stripe-card",
            "mppx/client stripe() did not yield a method exposing createCredential()",
          );
        }
        const challenge = parseMppChallenge(mppx, req.challenge, "stripe");
        return await serializeCredential(mppx, await method.createCredential({ challenge }));
      }

      // usdc-tempo: an on-chain TIP-20 transfer, so it needs the raw key.
      const tempo = client.tempo as { charge?: (args: { account: unknown }) => MppxMethod } | undefined;
      if (typeof tempo?.charge !== "function") {
        throw new GatewayRailUnsupportedError("usdc-tempo", "mppx/client does not export tempo.charge()");
      }
      return await signer.withPrivateKey(async (privateKey) => {
        const account = privateKeyToAccount(privateKey);
        const method = tempo.charge!({ account });
        if (typeof method?.createCredential !== "function") {
          throw new GatewayRailUnsupportedError(
            "usdc-tempo",
            "mppx/client tempo.charge() did not yield a method exposing createCredential()",
          );
        }
        const challenge = parseMppChallenge(mppx, req.challenge, "tempo");
        return await serializeCredential(mppx, await method.createCredential({ challenge }));
      });
    },
  };
}
