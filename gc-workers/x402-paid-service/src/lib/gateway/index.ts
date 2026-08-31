/**
 * Barrel + factory for the Alchemy gateway client.
 *
 * PHASE 1 IS LIBRARY-ONLY: src/index.ts (the Cloudflare Worker) does not import
 * this module, and custody-invariants.test.ts fails if it ever does. That keeps
 * viem / @alchemy/x402 / mppx out of the Worker bundle and removes the pressure
 * to `wrangler secret put` a signing key.
 */

export * from "./types";
export * from "./policy";
export * from "./store";
export * from "./siwe";
export * from "./signer";
export * from "./transports";
export * from "./credentials";
export * from "./client";

import { AlchemyGateway, type GatewayOptions } from "./client";
import { resolveSecret, type SecretBindings } from "../secrets";

export const GATEWAY_ENABLED_VAR = "GATEWAY_ENABLED";
export const GATEWAY_TRANSPORT_VAR = "GATEWAY_TRANSPORT";
export const GATEWAY_MAX_PAYMENT_VAR = "GATEWAY_MAX_PAYMENT_USD6";

/**
 * The kill switch. Returns null unless GATEWAY_ENABLED === "true", so the whole
 * paid path is off by default and turning it on is a deliberate, visible act.
 */
export async function createGatewayClient(
  bindings?: SecretBindings,
  overrides?: GatewayOptions,
): Promise<AlchemyGateway | null> {
  const enabled = await resolveSecret(GATEWAY_ENABLED_VAR, bindings);
  if (enabled !== "true") return null;

  const rawPreference = await resolveSecret(GATEWAY_TRANSPORT_VAR, bindings);
  const preference =
    rawPreference === "x402" || rawPreference === "mpp" || rawPreference === "auto" ? rawPreference : "auto";

  const rawCap = await resolveSecret(GATEWAY_MAX_PAYMENT_VAR, bindings);
  const maxPaymentAtomic = rawCap && /^[0-9]+$/.test(rawCap) ? rawCap : undefined;

  return await AlchemyGateway.fromSecrets(bindings, {
    preference,
    ...(maxPaymentAtomic ? { maxPaymentAtomic } : {}),
    ...overrides,
  });
}
