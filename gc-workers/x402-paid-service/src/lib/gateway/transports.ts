/**
 * Both protocol adapters, deliberately in ONE file: they are ~80% identical and
 * splitting them hides that. Everything here is pure — canned Response objects
 * in, Outcome out. No network, no key, no SDK.
 *
 * The load-bearing asymmetries, and the reason this file exists:
 *
 *   x402   challenge header  PAYMENT-REQUIRED   (ALL CAPS, already base64)
 *          credential header Payment-Signature  (Mixed-Case)
 *          receipt header    PAYMENT-RESPONSE
 *          Authorization is UNCHANGED between the two attempts.
 *
 *   MPP    challenge header  WWW-Authenticate
 *          credential rides on Authorization as a second RFC 9110 scheme:
 *              Authorization: SIWE <token>, Payment <credential>
 *          receipt header    Payment-Receipt
 *
 * We never hand our headers to a vendor SDK, so mppx's documented #1 trap —
 * clobbering Authorization with the payment credential on retry — is
 * structurally impossible, and we never need the `x-token` workaround. Tests
 * assert `x-token` is ABSENT precisely because its presence would mean someone
 * reintroduced an SDK fetch wrapper.
 */

import { GATEWAY_DOMAIN, GATEWAY_ORIGIN, type SiweToken } from "./siwe";
import type { Outcome, PaymentFailureReason, PaymentRail, Transport } from "./types";

export interface Eligibility {
  eligible: boolean;
  reason: string;
  /** true = this transport needs a funded USDC wallet before it can pay. */
  requiresFunds: boolean;
}

export interface EligibilityContext {
  hasSigner: boolean;
  hasSptProvider: boolean;
}

export interface ProtocolAdapter {
  readonly name: Transport;
  readonly origin: string;
  readonly siweDomain: string;
  readonly rails: readonly PaymentRail[];
  eligibility(ctx: EligibilityContext): Eligibility;
  buildHeaders(token: SiweToken, credential?: string): Record<string, string>;
  classify(res: Response, body: unknown): Outcome;
  /** Case-insensitive read, returned BYTE-IDENTICAL. Never re-encoded. */
  extractChallenge(res: Response): string | null;
  extractReceipt(res: Response): string | null;
}

const KNOWN_REASONS: readonly string[] = [
  "insufficient_balance",
  "verify_failed",
  "settle_failed",
  "settle_timeout",
  "card_declined",
  "invalid_spt",
  "method_unavailable",
  "over_spend_cap",
];

function normalizeReason(...candidates: unknown[]): PaymentFailureReason {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && KNOWN_REASONS.includes(candidate)) {
      return candidate as PaymentFailureReason;
    }
  }
  return "unknown";
}

/** 401 handling is identical on both gateways, down to the error-code names. */
function classifyAuthFailure(body: unknown): Outcome {
  const b = body as { code?: unknown; message?: unknown } | null;
  const code = typeof b?.code === "string" ? b.code : "UNKNOWN";
  if (code === "MESSAGE_EXPIRED") return { kind: "auth_expired" };
  const message = typeof b?.message === "string" ? b.message : "";
  return { kind: "auth_broken", code, message };
}

// ───────────────────────────────────────────────────────────────── x402 ──────

export const X402_ADAPTER: ProtocolAdapter = {
  name: "x402",
  origin: GATEWAY_ORIGIN.x402,
  siweDomain: GATEWAY_DOMAIN.x402,
  rails: ["usdc-base"],

  eligibility(ctx): Eligibility {
    if (!ctx.hasSigner) {
      return { eligible: false, reason: "no gateway signer is loaded", requiresFunds: true };
    }
    return { eligible: true, reason: "signer present; pays USDC on Base", requiresFunds: true };
  },

  buildHeaders(token, credential): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `SIWE ${token.token}` };
    // Authorization is UNCHANGED on the paid retry; the credential gets its own
    // Mixed-Case header.
    if (credential) headers["Payment-Signature"] = credential;
    return headers;
  },

  classify(res, body): Outcome {
    if (res.status >= 200 && res.status < 300) return { kind: "ok", status: res.status };
    if (res.status === 401) return classifyAuthFailure(body);
    if (res.status === 402) {
      const b = body as {
        accepts?: unknown;
        extensions?: { paymentError?: { info?: { type?: unknown; reason?: unknown; payer?: unknown } } };
      } | null;
      const info = b?.extensions?.paymentError?.info;
      if (info) {
        return {
          kind: "payment_failed",
          reason: normalizeReason(info.reason, info.type),
          payer: typeof info.payer === "string" ? info.payer : null,
        };
      }
      if (Array.isArray(b?.accepts)) {
        return {
          kind: "payment_required",
          challenge: X402_ADAPTER.extractChallenge(res) ?? "",
          rails: ["usdc-base"],
        };
      }
      return { kind: "payment_failed", reason: "unknown", payer: null };
    }
    return { kind: "upstream_error", status: res.status };
  },

  extractChallenge(res): string | null {
    return res.headers.get("PAYMENT-REQUIRED");
  },

  extractReceipt(res): string | null {
    return res.headers.get("PAYMENT-RESPONSE");
  },
};

// ────────────────────────────────────────────────────────────────── MPP ──────

const MPP_METHOD_TO_RAIL: Readonly<Record<string, PaymentRail>> = {
  tempo: "usdc-tempo",
  stripe: "stripe-card",
};

export const MPP_ADAPTER: ProtocolAdapter = {
  name: "mpp",
  origin: GATEWAY_ORIGIN.mpp,
  siweDomain: GATEWAY_DOMAIN.mpp,
  rails: ["stripe-card", "usdc-tempo"],

  eligibility(ctx): Eligibility {
    if (!ctx.hasSigner) {
      return { eligible: false, reason: "no gateway signer is loaded", requiresFunds: true };
    }
    if (!ctx.hasSptProvider) {
      // The crux of the bootstrap premise: MPP's tempo method needs USDC exactly
      // like x402. "MPP works unfunded" is true of the Stripe method ONLY.
      return {
        eligible: false,
        reason: "no Stripe SPT provider configured; the tempo method needs USDC just like x402",
        requiresFunds: true,
      };
    }
    return { eligible: true, reason: "signer + Stripe SPT provider present", requiresFunds: false };
  },

  buildHeaders(token, credential): Record<string, string> {
    // One combined multi-scheme header (RFC 9110). NEVER `x-token`: that header
    // exists only to work around the mppx fetch wrapper, which we do not use.
    const value = credential ? `SIWE ${token.token}, Payment ${credential}` : `SIWE ${token.token}`;
    return { Authorization: value };
  },

  classify(res, body): Outcome {
    if (res.status >= 200 && res.status < 300) return { kind: "ok", status: res.status };
    if (res.status === 401) return classifyAuthFailure(body);
    if (res.status === 402) {
      const b = body as { methods?: unknown; extensions?: { paymentError?: unknown } } | null;
      const rails: PaymentRail[] = [];
      if (Array.isArray(b?.methods)) {
        for (const m of b.methods) {
          const rail = typeof m === "string" ? MPP_METHOD_TO_RAIL[m] : undefined;
          if (rail) rails.push(rail);
        }
      }
      return {
        kind: "payment_required",
        challenge: MPP_ADAPTER.extractChallenge(res) ?? "",
        rails: rails.length ? rails : MPP_ADAPTER.rails,
      };
    }
    return { kind: "upstream_error", status: res.status };
  },

  extractChallenge(res): string | null {
    return res.headers.get("WWW-Authenticate");
  },

  extractReceipt(res): string | null {
    return res.headers.get("Payment-Receipt");
  },
};

export const ADAPTERS: Readonly<Record<Transport, ProtocolAdapter>> = {
  x402: X402_ADAPTER,
  mpp: MPP_ADAPTER,
};

/**
 * MPP signals a FAILED payment by returning 402 with the original challenge
 * again — indistinguishable, response-locally, from the first 402. Only the
 * client knows it already sent a credential, so it calls this to collapse a
 * repeat challenge into a failure. The reason is read from the body hint where
 * one is present; the documented causes are insufficient USDC (tempo), a
 * declined card, and an expired/invalid SPT.
 */
export function repeatChallengeFailure(body: unknown): PaymentFailureReason {
  const b = body as { extensions?: { hint?: unknown }; error?: unknown } | null;
  const hint = [b?.extensions?.hint, b?.error]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  if (!hint) return "unknown";
  if (hint.includes("insufficient")) return "insufficient_balance";
  if (hint.includes("declin")) return "card_declined";
  if (hint.includes("spt") || hint.includes("token expired")) return "invalid_spt";
  if (hint.includes("unsupported") || hint.includes("not enabled")) return "method_unavailable";
  return "unknown";
}

/**
 * Read the charge amount off a 402, normalized to USDC 6-decimal atomic units so
 * one spend cap covers both rails. Returns null when the amount cannot be
 * determined — the client treats that as fail-closed, because signing a charge
 * of unknown size is exactly what the cap exists to prevent.
 */
export function chargeAmountUsd6(transport: Transport, challenge: string | null, body: unknown): bigint | null {
  if (transport === "x402") {
    const accepts = (body as { accepts?: Array<{ amount?: unknown }> } | null)?.accepts;
    const amount = Array.isArray(accepts) ? accepts[0]?.amount : undefined;
    return parseAtomic(amount, 6);
  }

  // MPP: the challenge params carry amount + decimals. The grammar is elided in
  // the contracts (`realm="MPP Payment", method="tempo", ...`), so we read
  // defensively and fail closed rather than infer.
  const source = `${challenge ?? ""} ${JSON.stringify(body ?? {})}`;
  const amountMatch = /(?:^|[^a-z])amount"?\s*[:=]\s*"?([0-9]+)/i.exec(source);
  if (!amountMatch) return null;
  const decimalsMatch = /(?:^|[^a-z])decimals"?\s*[:=]\s*"?([0-9]+)/i.exec(source);
  const decimals = decimalsMatch ? Number(decimalsMatch[1]) : 6;
  return parseAtomic(amountMatch[1], decimals);
}

function parseAtomic(raw: unknown, decimals: number): bigint | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw);
  if (!/^[0-9]+$/.test(text)) return null;
  let value = BigInt(text);
  if (decimals < 6) value *= 10n ** BigInt(6 - decimals);
  else if (decimals > 6) value /= 10n ** BigInt(decimals - 6);
  return value;
}
