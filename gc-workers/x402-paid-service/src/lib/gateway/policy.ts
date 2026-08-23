/**
 * Routing policy. PURE: no runtime imports, no I/O, no async, no clock of its
 * own — `now` is always an argument. This is the smallest testable seam in the
 * design and policy.test.ts exercises it with zero mocks.
 *
 * Nothing here performs a balance RPC to decide anything. The 402 IS the balance
 * oracle: pre-checking USDC would need an RPC call, which is the very thing we
 * are paying the gateway for.
 */

import type { FundingHint, Outcome, PaymentFailureReason, Transport, TransportPreference } from "./types";

/** How long an "unfunded" memo suppresses x402 before we re-probe. */
export const UNFUNDED_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Matched to the SIWE token TTL. Payment is charged per AUTH TOKEN, not per
 * request, so flapping rails mid-hour buys a second settlement for nothing.
 */
export const STICKINESS_MS = 60 * 60 * 1000;

export interface RouterState {
  x402Funding: FundingHint;
  /** epoch ms; 0 = no cooldown active */
  unfundedUntil: number;
  /** set after a successful settlement; beats configured order until it lapses */
  pinned: { transport: Transport; until: number } | null;
}

export interface RouteInput {
  preference: TransportPreference;
  /** req.transport — a hard pin that also disables failover. */
  requested?: Transport;
  /** A signer exists. */
  x402Available: boolean;
  /**
   * A signer exists AND an SPT provider is configured. MPP's *tempo* method
   * needs USDC exactly like x402, so "MPP works unfunded" is true of the Stripe
   * method only. Without Stripe wired up, MPP is just as unfunded-blocked.
   */
  mppAvailable: boolean;
  state: RouterState;
  now: number;
}

export type RouteReason =
  | "explicit_request"
  | "explicit_preference"
  | "pinned_after_settlement"
  | "x402_default_cheapest"
  | "x402_unfunded_cooldown"
  | "x402_reprobe_after_cooldown"
  | "x402_unavailable"
  | "mpp_unavailable_fallback";

export interface RouteDecision {
  transport: Transport;
  reason: RouteReason;
}

export class NoTransportAvailableError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`No gateway transport is available: ${detail}`);
    this.name = "NoTransportAvailableError";
    this.detail = detail;
  }
}

export function initialRouterState(): RouterState {
  return { x402Funding: "unknown", unfundedUntil: 0, pinned: null };
}

function available(transport: Transport, input: RouteInput): boolean {
  return transport === "x402" ? input.x402Available : input.mppAvailable;
}

export function chooseTransport(input: RouteInput): RouteDecision {
  // 1. Explicit per-request pin wins over everything.
  if (input.requested) {
    return { transport: input.requested, reason: "explicit_request" };
  }

  // 2. Stickiness after a settlement beats configured order — the paid token
  //    should be used to exhaustion rather than abandoned.
  const pin = input.state.pinned;
  if (pin && input.now < pin.until && available(pin.transport, input)) {
    return { transport: pin.transport, reason: "pinned_after_settlement" };
  }

  // 3/4. Operator preference, degrading rather than dying.
  if (input.preference !== "auto") {
    if (available(input.preference, input)) {
      return { transport: input.preference, reason: "explicit_preference" };
    }
    const other: Transport = input.preference === "x402" ? "mpp" : "x402";
    if (available(other, input)) {
      return {
        transport: other,
        reason: input.preference === "x402" ? "x402_unavailable" : "mpp_unavailable_fallback",
      };
    }
    throw new NoTransportAvailableError(describeUnavailable(input));
  }

  // 5/6. auto + a live "unfunded" memo for x402.
  if (input.state.x402Funding === "unfunded") {
    if (input.now < input.state.unfundedUntil && input.mppAvailable) {
      return { transport: "mpp", reason: "x402_unfunded_cooldown" };
    }
    if (input.now >= input.state.unfundedUntil && input.x402Available) {
      return { transport: "x402", reason: "x402_reprobe_after_cooldown" };
    }
  }

  // 7. Cheap steady state.
  if (input.x402Available) {
    return { transport: "x402", reason: "x402_default_cheapest" };
  }
  // 8. Only MPP left.
  if (input.mppAvailable) {
    return { transport: "mpp", reason: "x402_unavailable" };
  }
  // 9.
  throw new NoTransportAvailableError(describeUnavailable(input));
}

function describeUnavailable(input: RouteInput): string {
  const parts: string[] = [];
  if (!input.x402Available) parts.push("x402 has no signer");
  if (!input.mppAvailable) parts.push("mpp has no signer or no SPT provider");
  return parts.join("; ") || "no transport matched";
}

/** Reasons where the OTHER gateway might plausibly succeed where this one did not. */
const FAILOVER_REASONS: readonly PaymentFailureReason[] = [
  "insufficient_balance",
  "verify_failed",
  "settle_failed",
  "settle_timeout",
  "card_declined",
  "invalid_spt",
  "method_unavailable",
];

/**
 * Deliberately narrow.
 *  - upstream_error is ALWAYS false: a 400 from a malformed eth_call, a 404 from
 *    a bad chain slug, a 500 from Alchemy — the same failure on both gateways.
 *    Retrying buys a second payment for a second identical error.
 *  - auth_broken is a configuration bug. Fix the code; do not spend money on it.
 *  - auth_expired is not failover at all — remint on the SAME transport.
 *  - alreadyPaid latches false: switching rails after a receipt would settle a
 *    SECOND real payment for one logical call.
 */
export function shouldFailover(
  outcome: Outcome,
  alreadyPaid: boolean,
  isExplicitTransport: boolean,
): boolean {
  if (alreadyPaid) return false;
  if (isExplicitTransport) return false;
  if (outcome.kind !== "payment_failed") return false;
  return FAILOVER_REASONS.includes(outcome.reason);
}

/**
 * Fold one response into the router state. Returns a NEW state object; the input
 * is never mutated (policy.test.ts deep-freezes it to prove that).
 *
 * MPP outcomes never touch the x402 funding memo — MPP-Stripe cannot tell us
 * anything about a USDC balance.
 */
export function applyOutcome(
  state: RouterState,
  transport: Transport,
  outcome: Outcome,
  settled: boolean,
  now: number,
  cooldownMs: number = UNFUNDED_COOLDOWN_MS,
  stickinessMs: number = STICKINESS_MS,
): RouterState {
  let x402Funding = state.x402Funding;
  let unfundedUntil = state.unfundedUntil;

  if (transport === "x402") {
    if (outcome.kind === "payment_failed" && outcome.reason === "insufficient_balance") {
      x402Funding = "unfunded";
      unfundedUntil = now + cooldownMs;
    } else if (outcome.kind === "ok") {
      x402Funding = "funded";
      unfundedUntil = 0;
    }
    // Everything else — settle_timeout in particular — is transient and must NOT
    // flip the memo.
  }

  const pinned = settled ? { transport, until: now + stickinessMs } : state.pinned;

  return { x402Funding, unfundedUntil, pinned };
}

/**
 * Read a response for a funding signal. Returns null when the response says
 * nothing about balance — a transient settle_timeout must not be read as
 * "unfunded".
 */
export function fundingHintFromResponse(status: number, body: unknown): FundingHint | null {
  if (status >= 200 && status < 300) return "funded";
  if (status !== 402) return null;
  const info = (body as { extensions?: { paymentError?: { info?: { reason?: unknown } } } })
    ?.extensions?.paymentError?.info;
  if (info && info.reason === "insufficient_balance") return "unfunded";
  return null;
}
