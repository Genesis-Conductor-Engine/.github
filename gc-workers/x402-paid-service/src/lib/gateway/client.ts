/**
 * AlchemyGateway — the dual-transport client.
 *
 * HARD BOUNDS, structural rather than best-effort, because a retry storm here
 * would be a SPEND storm:
 *   - one allowlisted host per transport, checked BEFORE any fetch;
 *   - at most one paid retry per transport, at most two transports;
 *   - EXACTLY ONE settlement per request(): once any transport returns a
 *     receipt, `alreadyPaid` latches and no further paid attempt happens;
 *   - a spend cap enforced before the credential factory is ever called, so the
 *     private key is not touched for an over-cap charge;
 *   - no public-RPC fallback and no alternate host in this file, ever.
 *
 * The request body is serialized ONCE and the exact same string is reused on the
 * paid retry, so the retry is byte-identical to the attempt that was quoted.
 */

import {
  GatewayPaymentTooLargeError,
  sdkCredentialFactory,
  type CredentialFactory,
  type SptProvider,
} from "./credentials";
import {
  applyOutcome,
  chooseTransport,
  initialRouterState,
  shouldFailover,
  STICKINESS_MS,
  UNFUNDED_COOLDOWN_MS,
  type RouteReason,
  type RouterState,
} from "./policy";
import { loadGatewaySigner, type GatewaySigner } from "./signer";
import { SiweTokenCache } from "./siwe";
import type { SecretBindings } from "../secrets";
import type { TokenStore } from "./store";
import {
  ADAPTERS,
  chargeAmountUsd6,
  repeatChallengeFailure,
  type Eligibility,
  type ProtocolAdapter,
} from "./transports";
import type {
  FetchImpl,
  GatewayRequest,
  GatewayResult,
  Hex,
  Outcome,
  Transport,
  TransportAttempt,
  TransportPreference,
} from "./types";

/** $0.05 USDC. Pricing is undocumented on both protocols, so the cap is the only bound. */
export const DEFAULT_MAX_PAYMENT_ATOMIC = "50000";

export interface GatewayOptions {
  preference?: TransportPreference;
  fetchImpl?: FetchImpl;
  credentials?: CredentialFactory;
  /** Omit and mppAvailable is FALSE — tempo needs USDC exactly like x402. */
  sptProvider?: SptProvider;
  store?: TokenStore;
  maxPaymentAtomic?: string;
  cooldownMs?: number;
  stickinessMs?: number;
  now?: () => number;
  /** Observability hook; never receives key material. */
  onSettled?: (event: { transport: Transport; amountAtomic: string | null; receipt: string | null }) => void;
}

export class GatewayHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly transport: Transport;
  readonly body: unknown;
  readonly attempts: readonly TransportAttempt[];
  constructor(
    message: string,
    status: number,
    transport: Transport,
    body: unknown,
    attempts: readonly TransportAttempt[],
    code?: string,
  ) {
    super(message);
    this.name = "GatewayHttpError";
    this.status = status;
    this.transport = transport;
    this.body = body;
    this.attempts = attempts;
    this.code = code;
  }
}

export interface GatewayStatus {
  preference: TransportPreference;
  address: Hex;
  transports: Array<{ name: Transport } & Eligibility>;
  state: RouterState;
  lastTransport: Transport | null;
  lastReason: RouteReason | null;
}

interface AttemptOutcome {
  outcome: Outcome;
  status: number | null;
  body: unknown;
  paid: boolean;
  receipt: string | null;
  protocolVersion: string | null;
  networkError: boolean;
}

export class AlchemyGateway {
  readonly address: Hex;

  private readonly signer: GatewaySigner;
  private readonly preference: TransportPreference;
  private readonly fetchImpl: FetchImpl;
  private readonly credentials: CredentialFactory;
  private readonly hasSptProvider: boolean;
  private readonly siwe: SiweTokenCache;
  private readonly maxPaymentAtomic: bigint;
  private readonly cooldownMs: number;
  private readonly stickinessMs: number;
  private readonly now: () => number;
  private readonly onSettled?: GatewayOptions["onSettled"];

  private state: RouterState = initialRouterState();
  private lastTransport: Transport | null = null;
  private lastReason: RouteReason | null = null;

  static async fromSecrets(bindings?: SecretBindings, options?: GatewayOptions): Promise<AlchemyGateway> {
    const signer = await loadGatewaySigner(bindings);
    return new AlchemyGateway(signer, options);
  }

  constructor(signer: GatewaySigner, options: GatewayOptions = {}) {
    this.signer = signer;
    this.address = signer.address;
    this.preference = options.preference ?? "auto";
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.hasSptProvider = typeof options.sptProvider === "function";
    this.credentials =
      options.credentials ?? sdkCredentialFactory({ sptProvider: options.sptProvider, fetchImpl: options.fetchImpl });
    this.now = options.now ?? Date.now;
    this.siwe = new SiweTokenCache({ signer, store: options.store, now: this.now });
    this.maxPaymentAtomic = BigInt(options.maxPaymentAtomic ?? DEFAULT_MAX_PAYMENT_ATOMIC);
    this.cooldownMs = options.cooldownMs ?? UNFUNDED_COOLDOWN_MS;
    this.stickinessMs = options.stickinessMs ?? STICKINESS_MS;
    this.onSettled = options.onSettled;
  }

  private eligibility(transport: Transport): Eligibility {
    return ADAPTERS[transport].eligibility({ hasSigner: true, hasSptProvider: this.hasSptProvider });
  }

  status(): GatewayStatus {
    return {
      preference: this.preference,
      address: this.address,
      transports: (["x402", "mpp"] as const).map((name) => ({ name, ...this.eligibility(name) })),
      state: { ...this.state, pinned: this.state.pinned ? { ...this.state.pinned } : null },
      lastTransport: this.lastTransport,
      lastReason: this.lastReason,
    };
  }

  /** Sugar: POST {jsonrpc,id,method,params} to /:chainSlug/v2. */
  async rpc<T = unknown>(chainSlug: string, method: string, params: readonly unknown[] = []): Promise<T> {
    const res = await this.request<{ result?: T; error?: { code: number; message: string } }>({
      path: `/${chainSlug}/v2`,
      method: "POST",
      body: { id: 1, jsonrpc: "2.0", method, params },
    });
    const payload = res.data;
    if (payload && typeof payload === "object" && payload.error) {
      throw new GatewayHttpError(
        `JSON-RPC error ${payload.error.code}: ${payload.error.message}`,
        res.status,
        res.transport,
        payload,
        res.attempts,
      );
    }
    return payload?.result as T;
  }

  /** REST sugar for /nft/v3/*, /data/v1/*, /prices/v1/* — no wrapper, no body corruption. */
  async rest<T = unknown>(
    path: string,
    init: { method?: "GET" | "POST"; query?: Record<string, string | string[]>; body?: unknown } = {},
  ): Promise<T> {
    const res = await this.request<T>({
      path,
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      query: init.query,
      body: init.body,
    });
    return res.data;
  }

  async request<T = unknown>(req: GatewayRequest): Promise<GatewayResult<T>> {
    const attempts: TransportAttempt[] = [];
    const isExplicit = Boolean(req.transport);

    const decision = chooseTransport({
      preference: this.preference,
      requested: req.transport,
      x402Available: this.eligibility("x402").eligible,
      mppAvailable: this.eligibility("mpp").eligible,
      state: this.state,
      now: this.now(),
    });
    this.lastTransport = decision.transport;
    this.lastReason = decision.reason;

    const order: Transport[] = [decision.transport];
    if (!isExplicit) order.push(decision.transport === "x402" ? "mpp" : "x402");

    // Host allowlist, checked for EVERY candidate transport before any network
    // call, so a bad path can never leak a request to an unexpected origin.
    const urls = new Map<Transport, string>();
    for (const transport of order) urls.set(transport, this.resolveUrl(ADAPTERS[transport], req));

    const bodyText = req.body === undefined ? undefined : JSON.stringify(req.body);

    let alreadyPaid = false;
    let last: AttemptOutcome | null = null;
    let lastTransport: Transport = order[0];

    for (const transport of order) {
      if (!this.eligibility(transport).eligible) continue;

      const result = await this.runTransport(transport, urls.get(transport)!, req, bodyText, attempts, alreadyPaid);
      last = result;
      lastTransport = transport;

      // Pin only on a clean settlement. Latch the double-pay interlock slightly
      // wider: a receipt means money moved even if the upstream then failed.
      const settledOk = result.paid && result.outcome.kind === "ok";
      this.state = applyOutcome(
        this.state,
        transport,
        result.outcome,
        settledOk,
        this.now(),
        this.cooldownMs,
        this.stickinessMs,
      );
      if (settledOk || (result.paid && result.receipt !== null)) {
        alreadyPaid = true;
        this.onSettled?.({ transport, amountAtomic: null, receipt: result.receipt });
      }

      if (result.outcome.kind === "ok") {
        return {
          status: result.status ?? 200,
          data: result.body as T,
          transport,
          paid: result.paid,
          receipt: result.receipt,
          protocolVersion: result.protocolVersion,
          attempts,
        };
      }

      const failoverAllowed = result.networkError
        ? !alreadyPaid && !isExplicit
        : shouldFailover(result.outcome, alreadyPaid, isExplicit);
      if (!failoverAllowed) break;
    }

    throw this.toError(lastTransport, last, attempts);
  }

  private toError(
    transport: Transport,
    last: AttemptOutcome | null,
    attempts: readonly TransportAttempt[],
  ): GatewayHttpError {
    if (!last) {
      return new GatewayHttpError("Gateway request made no attempts", 0, transport, null, attempts);
    }
    const outcome = last.outcome;
    const code =
      outcome.kind === "auth_broken" ? outcome.code : outcome.kind === "auth_expired" ? "MESSAGE_EXPIRED" : undefined;
    const detail =
      outcome.kind === "payment_failed"
        ? `payment failed (${outcome.reason})`
        : outcome.kind === "auth_broken"
          ? `auth failed (${outcome.code}): ${outcome.message}`
          : outcome.kind === "auth_expired"
            ? "auth token expired and reminting did not recover"
            : outcome.kind === "payment_required"
              ? "payment still required after the paid retry"
              : `upstream error ${last.status ?? "network"}`;
    return new GatewayHttpError(
      `Alchemy ${transport} gateway: ${detail}`,
      last.status ?? 0,
      transport,
      last.body,
      attempts,
      code,
    );
  }

  private resolveUrl(adapter: ProtocolAdapter, req: GatewayRequest): string {
    if (!req.path.startsWith("/") || req.path.startsWith("//")) {
      throw new GatewayHttpError(
        `Gateway path must be an absolute path on the gateway host, got "${req.path}"`,
        0,
        adapter.name,
        null,
        [],
      );
    }
    const url = new URL(req.path, adapter.origin);
    if (url.origin !== adapter.origin) {
      throw new GatewayHttpError(
        `Refusing to call ${url.origin}: the only allowlisted host for ${adapter.name} is ${adapter.origin}`,
        0,
        adapter.name,
        null,
        [],
      );
    }
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
      }
    }
    return url.toString();
  }

  private async runTransport(
    transport: Transport,
    url: string,
    req: GatewayRequest,
    bodyText: string | undefined,
    attempts: TransportAttempt[],
    alreadyPaid: boolean,
  ): Promise<AttemptOutcome> {
    const adapter = ADAPTERS[transport];
    const method = req.method ?? (bodyText === undefined ? "GET" : "POST");

    let token = await this.siwe.get(transport);
    let credential: string | undefined;
    let authReminted = false;
    let paid = false;
    let last: AttemptOutcome = {
      outcome: { kind: "upstream_error", status: 0 },
      status: null,
      body: null,
      paid: false,
      receipt: null,
      protocolVersion: null,
      networkError: true,
    };

    // Bounded: the initial send, at most one auth remint, at most one paid retry.
    for (let send = 0; send < 3; send += 1) {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(bodyText === undefined ? {} : { "Content-Type": "application/json" }),
        ...(req.headers ?? {}),
        ...adapter.buildHeaders(token, credential),
      };

      const started = this.now();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          ...(bodyText === undefined ? {} : { body: bodyText }),
          ...(req.signal ? { signal: req.signal } : {}),
        });
      } catch (err) {
        attempts.push({
          transport,
          status: null,
          outcome: "upstream_error",
          paid,
          durationMs: this.now() - started,
        });
        last = {
          outcome: { kind: "upstream_error", status: 0 },
          status: null,
          body: { error: err instanceof Error ? err.message : String(err) },
          paid,
          receipt: null,
          protocolVersion: null,
          networkError: true,
        };
        return last;
      }

      const body = await readBody(res);
      let outcome = adapter.classify(res, body);

      // MPP signals a failed payment by repeating the challenge. Only we know we
      // already sent a credential, so collapse it here.
      if (outcome.kind === "payment_required" && credential) {
        outcome = { kind: "payment_failed", reason: repeatChallengeFailure(body), payer: null };
      }

      attempts.push({
        transport,
        status: res.status,
        outcome: outcome.kind,
        ...(outcome.kind === "payment_failed" ? { reason: outcome.reason } : {}),
        paid,
        durationMs: this.now() - started,
      });

      const receipt = adapter.extractReceipt(res);
      last = {
        outcome,
        status: res.status,
        body,
        paid,
        receipt,
        protocolVersion: res.headers.get("X-Protocol-Version"),
        networkError: false,
      };

      if (outcome.kind === "ok") return last;

      // MESSAGE_EXPIRED is a remint, not a rail switch and not a re-payment.
      if (outcome.kind === "auth_expired" && !authReminted) {
        authReminted = true;
        await this.siwe.invalidate(transport);
        token = await this.siwe.get(transport);
        continue;
      }

      if (outcome.kind === "payment_required" && !credential) {
        const challenged = outcome;
        // Double-pay interlock: another transport already settled for this
        // logical request. Do not buy a second one.
        if (alreadyPaid) return last;

        const amount = chargeAmountUsd6(transport, challenged.challenge, body);
        if (amount === null || amount > this.maxPaymentAtomic) {
          throw new GatewayPaymentTooLargeError(
            amount === null ? "unknown" : amount.toString(),
            this.maxPaymentAtomic.toString(),
            transport,
          );
        }

        // adapter.rails is OUR preference order; challenged.rails is what the
        // gateway offered. Intersect, cheapest-first.
        const rail = adapter.rails.find(
          (r) => challenged.rails.includes(r) && this.credentials.supports(r),
        );
        if (!rail) return last;

        credential = await this.credentials.create(
          {
            transport,
            challenge: challenged.challenge,
            rail,
            maxAmountAtomic: this.maxPaymentAtomic,
            amountAtomic: amount,
          },
          this.signer,
        );
        paid = true;
        continue;
      }

      return last;
    }

    return last;
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
