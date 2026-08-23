/**
 * Shopify Admin API client + revenue/attribution computation.
 *
 * Reads its credentials through the runtime-agnostic resolver (Worker `env`
 * binding, else /run/secrets/<name>, else process.env):
 *   - SHOPIFY_ADMIN_TOKEN   Admin API access token (X-Shopify-Access-Token)
 *   - SHOPIFY_SHOP_DOMAIN   e.g. "my-store.myshopify.com"
 *
 * Integrity rule (same as the Stripe side): recurring MRR and one-time order
 * revenue are kept strictly separate. Standard Shopify orders are one-time
 * e-commerce sales (GMV) and are NEVER reported as MRR. Only active
 * subscription contracts contribute to MRR, normalized to a monthly figure.
 * All money is handled in integer minor units (cents) to avoid float drift.
 */

import { resolveSecret, type SecretBindings } from "../lib/secrets";

const DEFAULT_API_VERSION = "2024-10";

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export interface ShopifyClientConfig {
  shop: string;
  token: string;
  apiVersion?: string;
  fetchImpl?: FetchImpl;
}

export interface NormalizedOrder {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  amountCents: number;
  currency: string;
  attribution: { source: string | null; medium: string | null; campaign: string | null };
}

export interface RecurringInterval {
  interval: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
}

/** Parse a Shopify decimal money string ("129.95") into integer cents. */
export function moneyToCents(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const DAYS_PER_MONTH = 365 / 12;
const WEEKS_PER_MONTH = 52 / 12;

/** Monthly-normalized cents for a recurring price at a given billing interval. */
export function normalizeToMonthlyCents(priceCents: number, billing: RecurringInterval): number {
  const n = billing.intervalCount > 0 ? billing.intervalCount : 1;
  switch (billing.interval) {
    case "MONTH":
      return Math.round(priceCents / n);
    case "YEAR":
      return Math.round(priceCents / (12 * n));
    case "WEEK":
      return Math.round((priceCents * WEEKS_PER_MONTH) / n);
    case "DAY":
      return Math.round((priceCents * DAYS_PER_MONTH) / n);
    default:
      return 0;
  }
}

interface RawOrderNode {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus?: string;
  currentTotalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  sourceName?: string;
  customerJourneySummary?: {
    firstVisit?: {
      source?: string | null;
      utmParameters?: { source?: string | null; medium?: string | null; campaign?: string | null } | null;
    } | null;
  } | null;
}

/** Normalize a raw Admin GraphQL order node into our flat shape. */
export function normalizeOrder(node: RawOrderNode): NormalizedOrder {
  const utm = node.customerJourneySummary?.firstVisit?.utmParameters ?? null;
  const firstVisitSource = node.customerJourneySummary?.firstVisit?.source ?? null;
  return {
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    financialStatus: node.displayFinancialStatus ?? "UNKNOWN",
    amountCents: moneyToCents(node.currentTotalPriceSet?.shopMoney?.amount),
    currency: node.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD",
    attribution: {
      source: utm?.source ?? firstVisitSource ?? node.sourceName ?? null,
      medium: utm?.medium ?? null,
      campaign: utm?.campaign ?? null,
    },
  };
}

export interface RevenueSummary {
  /** One-time e-commerce revenue from PAID orders (GMV). NOT MRR. */
  oneTimeRevenueCents: number;
  /** Recurring MRR from active subscription contracts, monthly-normalized. */
  recurringMrrCents: number;
  paidOrderCount: number;
  bySource: Record<string, number>;
}

/** Sum PAID order revenue and attribute it by source. One-time only. */
export function summarizeOrders(orders: NormalizedOrder[]): Omit<RevenueSummary, "recurringMrrCents"> {
  const paid = orders.filter((o) => o.financialStatus === "PAID");
  const bySource: Record<string, number> = {};
  let oneTimeRevenueCents = 0;
  for (const o of paid) {
    oneTimeRevenueCents += o.amountCents;
    const key = o.attribution.source ?? "unattributed";
    bySource[key] = (bySource[key] ?? 0) + o.amountCents;
  }
  return { oneTimeRevenueCents, paidOrderCount: paid.length, bySource };
}

/**
 * Validated against the live Admin schema (2024-10). Requires the token to hold
 * `write_orders` + `read_orders`; without them this fails at the API, not here.
 */
const ORDER_CREATE_MUTATION = `
  mutation CreatePaidOrder($order: OrderCreateOrderInput!) {
    orderCreate(order: $order) {
      order {
        id
        name
        statusPageUrl
      }
      userErrors {
        field
        message
      }
    }
  }`;

export interface CreatePaidOrderInput {
  /** Product variant GID, e.g. "gid://shopify/ProductVariant/123". */
  variantId: string;
  quantity?: number;
  email?: string;
  note?: string;
  /** Surfaced on the order in the Shopify admin — used here for the audit trail. */
  customAttributes?: { key: string; value: string }[];
  tags?: string[];
}

export interface CreatedOrder {
  id: string;
  name: string;
  statusPageUrl: string | null;
}

const ORDERS_QUERY = `
  query PaidOrders($first: Int!, $query: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          sourceName
          customerJourneySummary {
            firstVisit { source utmParameters { source medium campaign } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const SUBSCRIPTION_CONTRACTS_QUERY = `
  query ActiveSubscriptions($first: Int!) {
    subscriptionContracts(first: $first) {
      edges {
        node {
          id
          status
          billingPolicy { interval intervalCount }
          lines(first: 50) {
            edges { node { currentPrice { amount } quantity } }
          }
        }
      }
    }
  }`;

export class ShopifyAdminClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly fetchImpl: FetchImpl;

  constructor(config: ShopifyClientConfig) {
    const version = config.apiVersion ?? DEFAULT_API_VERSION;
    this.endpoint = `https://${config.shop}/admin/api/${version}/graphql.json`;
    this.token = config.token;
    this.fetchImpl = config.fetchImpl ?? ((i, init) => fetch(i, init));
  }

  /** Build a client by resolving credentials through the secret resolver. */
  static async fromSecrets(env?: SecretBindings, fetchImpl?: FetchImpl): Promise<ShopifyAdminClient> {
    const shop = await resolveSecret("SHOPIFY_SHOP_DOMAIN", env);
    const token = await resolveSecret("SHOPIFY_ADMIN_TOKEN", env);
    if (!shop) throw new Error("SHOPIFY_SHOP_DOMAIN is not available from any secret source");
    if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN is not available from any secret source");
    return new ShopifyAdminClient({ shop, token, fetchImpl });
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.token,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Shopify Admin API HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors) {
      throw new Error(`Shopify Admin API returned errors: ${JSON.stringify(json.errors)}`);
    }
    if (!json.data) throw new Error("Shopify Admin API returned no data");
    return json.data;
  }

  /**
   * Create an order already marked PAID.
   *
   * Called only after on-chain settlement is confirmed, so the money exists
   * before the order does — `financialStatus: PAID` records that fact rather
   * than asserting it optimistically.
   *
   * The charged amount is recorded in `customAttributes`, not `priceSet`: the
   * variant's own price is authoritative for the order total, and the on-chain
   * figure is what we need for reconciliation if the two ever drift.
   *
   * Throws on transport failure, GraphQL errors, or userErrors — the caller is
   * responsible for degrading gracefully, since the buyer has already paid.
   */
  async createPaidOrder(input: CreatePaidOrderInput): Promise<CreatedOrder> {
    const data = await this.graphql<{
      orderCreate: {
        order: CreatedOrder | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(ORDER_CREATE_MUTATION, {
      order: {
        financialStatus: "PAID",
        lineItems: [{ variantId: input.variantId, quantity: input.quantity ?? 1 }],
        ...(input.email ? { email: input.email } : {}),
        ...(input.note ? { note: input.note } : {}),
        ...(input.customAttributes?.length ? { customAttributes: input.customAttributes } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
      },
    });

    const { order, userErrors } = data.orderCreate;
    if (userErrors?.length) {
      throw new Error(
        `Shopify orderCreate rejected: ${userErrors.map((e) => e.message).join("; ")}`
      );
    }
    if (!order) throw new Error("Shopify orderCreate returned no order");
    return order;
  }

  /** Fetch recent paid orders (one page). `query` is a Shopify search filter. */
  async fetchPaidOrders(first = 50, query = "financial_status:paid"): Promise<NormalizedOrder[]> {
    const data = await this.graphql<{ orders: { edges: { node: RawOrderNode }[] } }>(ORDERS_QUERY, {
      first,
      query,
    });
    return data.orders.edges.map((e) => normalizeOrder(e.node));
  }

  /** Compute MRR from ACTIVE subscription contracts only (recurring). */
  async fetchSubscriptionMrrCents(first = 100): Promise<number> {
    interface SubNode {
      status: string;
      billingPolicy: { interval: RecurringInterval["interval"]; intervalCount: number };
      lines: { edges: { node: { currentPrice: { amount: string }; quantity: number } }[] };
    }
    const data = await this.graphql<{ subscriptionContracts: { edges: { node: SubNode }[] } }>(
      SUBSCRIPTION_CONTRACTS_QUERY,
      { first }
    );
    let mrr = 0;
    for (const { node } of data.subscriptionContracts.edges) {
      if (node.status !== "ACTIVE") continue;
      const lineTotalCents = node.lines.edges.reduce(
        (sum, l) => sum + moneyToCents(l.node.currentPrice.amount) * (l.node.quantity ?? 1),
        0
      );
      mrr += normalizeToMonthlyCents(lineTotalCents, {
        interval: node.billingPolicy.interval,
        intervalCount: node.billingPolicy.intervalCount,
      });
    }
    return mrr;
  }

  /** Full revenue picture: one-time GMV + attribution, and recurring MRR, kept separate. */
  async revenueSummary(): Promise<RevenueSummary> {
    const orders = await this.fetchPaidOrders();
    const orderPart = summarizeOrders(orders);
    let recurringMrrCents = 0;
    try {
      recurringMrrCents = await this.fetchSubscriptionMrrCents();
    } catch {
      // Store may not use subscription contracts / lack the scope. MRR stays 0
      // rather than being faked from one-time GMV.
      recurringMrrCents = 0;
    }
    return { ...orderPart, recurringMrrCents };
  }
}
