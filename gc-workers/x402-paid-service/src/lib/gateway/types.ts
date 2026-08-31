/**
 * Shared vocabulary for the dual-transport Alchemy gateway client.
 *
 * Zero runtime imports, zero I/O. Everything here is erased at compile time, so
 * importing this module can never pull a vendor SDK, a signing key, or a network
 * dependency into any bundle.
 */

export type Hex = `0x${string}`;

/** The two gateway protocols this client speaks. */
export type Transport = "x402" | "mpp";

/** Operator preference: "auto" lets the router decide. */
export type TransportPreference = "auto" | Transport;

/**
 * Payment rails, one per (transport, funding source) pair.
 *  - usdc-base   x402, USDC on Base. Needs a funded wallet.
 *  - usdc-tempo  MPP tempo method. ALSO needs a funded wallet — tempo is NOT a
 *                bootstrap path, despite "MPP works without funding" being true
 *                of the Stripe method only.
 *  - stripe-card MPP stripe method. Needs an SPT provider, not a funded wallet.
 */
export type PaymentRail = "usdc-base" | "usdc-tempo" | "stripe-card";

/** What we have learned about the signer's USDC balance from 402 bodies. */
export type FundingHint = "unknown" | "funded" | "unfunded";

/** Same shape as src/shopify/admin-client.ts's injected fetch — reused deliberately. */
export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export type PaymentFailureReason =
  | "insufficient_balance"
  | "verify_failed"
  | "settle_failed"
  | "settle_timeout"
  | "card_declined"
  | "invalid_spt"
  | "method_unavailable"
  | "over_spend_cap"
  | "unknown";

/** Normalized view of one gateway response. Both protocols collapse into this. */
export type Outcome =
  | { kind: "ok"; status: number }
  | { kind: "payment_required"; challenge: string; rails: readonly PaymentRail[] }
  | { kind: "payment_failed"; reason: PaymentFailureReason; payer: string | null }
  | { kind: "auth_expired" }
  | { kind: "auth_broken"; code: string; message: string }
  | { kind: "upstream_error"; status: number };

export interface TransportAttempt {
  transport: Transport;
  status: number | null;
  outcome: Outcome["kind"];
  reason?: PaymentFailureReason;
  paid: boolean;
  durationMs: number;
}

export interface GatewayRequest {
  /** Gateway-relative path, e.g. "/eth-mainnet/v2" or "/prices/v1/tokens/by-symbol". */
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
  /** Hard pin — skips chooseTransport AND disables failover for this call. */
  transport?: Transport;
  signal?: AbortSignal;
}

export interface GatewayResult<T = unknown> {
  status: number;
  data: T;
  transport: Transport;
  paid: boolean;
  /** Raw PAYMENT-RESPONSE (x402) or Payment-Receipt (MPP) header, UNPARSED. */
  receipt: string | null;
  /** Raw X-Protocol-Version header: "x402/2.0" | "mpp/1.0". */
  protocolVersion: string | null;
  attempts: readonly TransportAttempt[];
}
