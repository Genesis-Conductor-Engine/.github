/**
 * Routing policy. PURE unit tests: zero mocks, zero imports of anything with
 * I/O, zero network. If these ever need a mock, policy.ts has stopped being pure.
 */

import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  chooseTransport,
  fundingHintFromResponse,
  initialRouterState,
  NoTransportAvailableError,
  shouldFailover,
  STICKINESS_MS,
  UNFUNDED_COOLDOWN_MS,
  type RouteInput,
  type RouterState,
} from "./policy";
import type { Outcome, PaymentFailureReason } from "./types";

const NOW = 1_800_000_000_000;

function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    preference: "auto",
    x402Available: true,
    mppAvailable: true,
    state: initialRouterState(),
    now: NOW,
    ...overrides,
  };
}

function state(overrides: Partial<RouterState> = {}): RouterState {
  return { ...initialRouterState(), ...overrides };
}

describe("chooseTransport", () => {
  it("routes auto + unknown funding to x402, the cheap rail", () => {
    expect(chooseTransport(input())).toEqual({ transport: "x402", reason: "x402_default_cheapest" });
  });

  it("routes to MPP while the x402 unfunded cooldown is live", () => {
    const decision = chooseTransport(
      input({ state: state({ x402Funding: "unfunded", unfundedUntil: NOW + 1000 }) }),
    );
    expect(decision).toEqual({ transport: "mpp", reason: "x402_unfunded_cooldown" });
  });

  it("re-probes x402 once the cooldown lapses", () => {
    const decision = chooseTransport(
      input({ state: state({ x402Funding: "unfunded", unfundedUntil: NOW - 1 }) }),
    );
    expect(decision).toEqual({ transport: "x402", reason: "x402_reprobe_after_cooldown" });
  });

  it("never strands the caller: unfunded + no MPP still routes x402", () => {
    const decision = chooseTransport(
      input({ mppAvailable: false, state: state({ x402Funding: "unfunded", unfundedUntil: NOW + 1000 }) }),
    );
    expect(decision.transport).toBe("x402");
  });

  it("lets a settlement pin beat the configured order", () => {
    const decision = chooseTransport(
      input({ preference: "x402", state: state({ pinned: { transport: "mpp", until: NOW + 1000 } }) }),
    );
    expect(decision).toEqual({ transport: "mpp", reason: "pinned_after_settlement" });
  });

  it("releases the pin once it expires", () => {
    const decision = chooseTransport(
      input({ preference: "x402", state: state({ pinned: { transport: "mpp", until: NOW } }) }),
    );
    expect(decision).toEqual({ transport: "x402", reason: "explicit_preference" });
  });

  it("degrades rather than dying when the preferred transport is unavailable", () => {
    expect(chooseTransport(input({ preference: "mpp", mppAvailable: false }))).toEqual({
      transport: "x402",
      reason: "mpp_unavailable_fallback",
    });
    expect(chooseTransport(input({ preference: "x402", x402Available: false }))).toEqual({
      transport: "mpp",
      reason: "x402_unavailable",
    });
  });

  it("lets req.transport win over preference and pin alike", () => {
    const decision = chooseTransport(
      input({
        requested: "mpp",
        preference: "x402",
        state: state({ pinned: { transport: "x402", until: NOW + 1000 } }),
      }),
    );
    expect(decision).toEqual({ transport: "mpp", reason: "explicit_request" });
  });

  it("throws with a detail naming the failed precondition when nothing is available", () => {
    try {
      chooseTransport(input({ x402Available: false, mppAvailable: false }));
      throw new Error("expected NoTransportAvailableError");
    } catch (err) {
      expect(err).toBeInstanceOf(NoTransportAvailableError);
      expect((err as NoTransportAvailableError).detail).toContain("x402 has no signer");
      expect((err as NoTransportAvailableError).detail).toContain("SPT provider");
    }
  });
});

describe("shouldFailover", () => {
  const failoverReasons: PaymentFailureReason[] = [
    "insufficient_balance",
    "verify_failed",
    "settle_failed",
    "settle_timeout",
    "card_declined",
    "invalid_spt",
    "method_unavailable",
  ];

  it.each(failoverReasons)("fails over on payment_failed/%s", (reason) => {
    expect(shouldFailover({ kind: "payment_failed", reason, payer: null }, false, false)).toBe(true);
  });

  // The double-pay regression guard: the same 400/404/500 would come back from
  // the other gateway, and getting there costs a second real payment.
  it.each([400, 404, 500, 429])("never fails over on upstream_error %i", (status) => {
    expect(shouldFailover({ kind: "upstream_error", status }, false, false)).toBe(false);
  });

  it("never fails over on auth_broken (a config bug, not a rail problem)", () => {
    expect(
      shouldFailover({ kind: "auth_broken", code: "INVALID_DOMAIN", message: "" }, false, false),
    ).toBe(false);
  });

  it("never fails over on auth_expired (that is a remint on the same rail)", () => {
    expect(shouldFailover({ kind: "auth_expired" }, false, false)).toBe(false);
  });

  it.each(failoverReasons)("latches OFF once alreadyPaid, even for %s", (reason) => {
    expect(shouldFailover({ kind: "payment_failed", reason, payer: null }, true, false)).toBe(false);
  });

  it.each(failoverReasons)("latches OFF for an explicit transport, even for %s", (reason) => {
    expect(shouldFailover({ kind: "payment_failed", reason, payer: null }, false, true)).toBe(false);
  });
});

describe("applyOutcome", () => {
  const insufficient: Outcome = { kind: "payment_failed", reason: "insufficient_balance", payer: "0xabc" };

  it("arms the cooldown and flips the memo on insufficient_balance", () => {
    const next = applyOutcome(initialRouterState(), "x402", insufficient, false, NOW);
    expect(next.x402Funding).toBe("unfunded");
    expect(next.unfundedUntil).toBe(NOW + UNFUNDED_COOLDOWN_MS);
  });

  it("does NOT flip the memo on a transient settle_timeout", () => {
    const next = applyOutcome(
      initialRouterState(),
      "x402",
      { kind: "payment_failed", reason: "settle_timeout", payer: null },
      false,
      NOW,
    );
    expect(next.x402Funding).toBe("unknown");
    expect(next.unfundedUntil).toBe(0);
  });

  it("pins the transport for the token lifetime after a settlement", () => {
    const next = applyOutcome(initialRouterState(), "mpp", { kind: "ok", status: 200 }, true, NOW);
    expect(next.pinned).toEqual({ transport: "mpp", until: NOW + STICKINESS_MS });
  });

  it("clears the cooldown when x402 succeeds", () => {
    const armed = state({ x402Funding: "unfunded", unfundedUntil: NOW + 1000 });
    const next = applyOutcome(armed, "x402", { kind: "ok", status: 200 }, true, NOW);
    expect(next.x402Funding).toBe("funded");
    expect(next.unfundedUntil).toBe(0);
  });

  it("never lets an MPP outcome touch the x402 funding memo", () => {
    const armed = state({ x402Funding: "unfunded", unfundedUntil: NOW + 1000 });
    const next = applyOutcome(armed, "mpp", { kind: "ok", status: 200 }, true, NOW);
    expect(next.x402Funding).toBe("unfunded");
    expect(next.unfundedUntil).toBe(NOW + 1000);
  });

  it("never mutates the input state", () => {
    const frozen = Object.freeze(state({ pinned: Object.freeze({ transport: "x402", until: NOW }) }));
    const next = applyOutcome(frozen, "x402", insufficient, true, NOW);
    expect(frozen.x402Funding).toBe("unknown");
    expect(frozen.unfundedUntil).toBe(0);
    expect(frozen.pinned).toEqual({ transport: "x402", until: NOW });
    expect(next).not.toBe(frozen);
  });
});

describe("fundingHintFromResponse", () => {
  it("reads insufficient_balance out of an x402 payment-error body", () => {
    const body = { extensions: { paymentError: { info: { type: "verify_failed", reason: "insufficient_balance" } } } };
    expect(fundingHintFromResponse(402, body)).toBe("unfunded");
  });

  it("returns null for a transient 402 rather than flipping the memo", () => {
    const body = { extensions: { paymentError: { info: { type: "settle_timeout", reason: "settle_timeout" } } } };
    expect(fundingHintFromResponse(402, body)).toBeNull();
  });

  it("reads a 200 as funded and says nothing about other statuses", () => {
    expect(fundingHintFromResponse(200, {})).toBe("funded");
    expect(fundingHintFromResponse(500, {})).toBeNull();
  });
});
