/**
 * Offline tests for the Shopify Admin client + revenue/attribution math.
 * The network boundary (fetchImpl) is stubbed with canned Admin GraphQL
 * responses, so no shop, token, or network is required.
 * Run: `node --test src/shopify/admin-client.test.ts` (Node 23.6+ strips TS).
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import {
  ShopifyAdminClient,
  moneyToCents,
  normalizeToMonthlyCents,
  normalizeOrder,
  summarizeOrders,
  type FetchImpl,
} from "./admin-client";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("moneyToCents parses decimal strings and guards bad input", () => {
  assert.equal(moneyToCents("129.95"), 12995);
  assert.equal(moneyToCents(10), 1000);
  assert.equal(moneyToCents(null), 0);
  assert.equal(moneyToCents("not-a-number"), 0);
});

test("normalizeToMonthlyCents matches the Stripe-side normalization", () => {
  assert.equal(normalizeToMonthlyCents(12000, { interval: "YEAR", intervalCount: 1 }), 1000); // $120/yr -> $10/mo
  assert.equal(normalizeToMonthlyCents(3000, { interval: "MONTH", intervalCount: 3 }), 1000); // $30/qtr -> $10/mo
  assert.equal(normalizeToMonthlyCents(5000, { interval: "MONTH", intervalCount: 1 }), 5000);
});

test("normalizeOrder flattens the GraphQL node and derives attribution", () => {
  const o = normalizeOrder({
    id: "gid://shopify/Order/1",
    name: "#1001",
    createdAt: "2026-07-29T00:00:00Z",
    displayFinancialStatus: "PAID",
    currentTotalPriceSet: { shopMoney: { amount: "49.99", currencyCode: "USD" } },
    sourceName: "web",
    customerJourneySummary: { firstVisit: { source: "google", utmParameters: { source: "google", medium: "cpc", campaign: "summer" } } },
  });
  assert.equal(o.amountCents, 4999);
  assert.equal(o.financialStatus, "PAID");
  assert.equal(o.attribution.source, "google");
  assert.equal(o.attribution.medium, "cpc");
  assert.equal(o.attribution.campaign, "summer");
});

test("summarizeOrders counts only PAID orders and attributes by source", () => {
  const orders = [
    normalizeOrder({ id: "1", name: "#1", createdAt: "", displayFinancialStatus: "PAID", currentTotalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } }, sourceName: "web" }),
    normalizeOrder({ id: "2", name: "#2", createdAt: "", displayFinancialStatus: "PAID", currentTotalPriceSet: { shopMoney: { amount: "50.00", currencyCode: "USD" } }, customerJourneySummary: { firstVisit: { utmParameters: { source: "google" } } } }),
    normalizeOrder({ id: "3", name: "#3", createdAt: "", displayFinancialStatus: "PENDING", currentTotalPriceSet: { shopMoney: { amount: "999.00", currencyCode: "USD" } } }),
  ];
  const s = summarizeOrders(orders);
  assert.equal(s.paidOrderCount, 2);
  assert.equal(s.oneTimeRevenueCents, 15000); // pending $999 excluded
  assert.equal(s.bySource["web"], 10000);
  assert.equal(s.bySource["google"], 5000);
});

test("client.fetchPaidOrders normalizes a canned Admin response", async () => {
  const fetchImpl: FetchImpl = async () =>
    jsonResponse({
      data: {
        orders: {
          edges: [
            { node: { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-07-29T00:00:00Z", displayFinancialStatus: "PAID", currentTotalPriceSet: { shopMoney: { amount: "20.00", currencyCode: "USD" } }, sourceName: "pos" } },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
  const client = new ShopifyAdminClient({ shop: "test.myshopify.com", token: "shpat_test", fetchImpl });
  const orders = await client.fetchPaidOrders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].amountCents, 2000);
  assert.equal(orders[0].attribution.source, "pos");
});

test("client.revenueSummary keeps one-time GMV and recurring MRR separate", async () => {
  const fetchImpl: FetchImpl = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { query: string };
    if (body.query.includes("subscriptionContracts")) {
      return jsonResponse({
        data: {
          subscriptionContracts: {
            edges: [
              { node: { status: "ACTIVE", billingPolicy: { interval: "MONTH", intervalCount: 1 }, lines: { edges: [{ node: { currentPrice: { amount: "30.00" }, quantity: 1 } }] } } },
              { node: { status: "CANCELLED", billingPolicy: { interval: "MONTH", intervalCount: 1 }, lines: { edges: [{ node: { currentPrice: { amount: "99.00" }, quantity: 1 } }] } } },
            ],
          },
        },
      });
    }
    return jsonResponse({
      data: {
        orders: {
          edges: [
            { node: { id: "1", name: "#1", createdAt: "", displayFinancialStatus: "PAID", currentTotalPriceSet: { shopMoney: { amount: "75.00", currencyCode: "USD" } }, sourceName: "web" } },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
  };
  const client = new ShopifyAdminClient({ shop: "test.myshopify.com", token: "shpat_test", fetchImpl });
  const summary = await client.revenueSummary();
  assert.equal(summary.oneTimeRevenueCents, 7500); // the $75 paid order
  assert.equal(summary.recurringMrrCents, 3000);    // only the ACTIVE $30/mo contract; cancelled excluded
  assert.equal(summary.paidOrderCount, 1);
});

test("client surfaces a non-2xx Admin API response as an error", async () => {
  const fetchImpl: FetchImpl = async () => new Response("nope", { status: 401 });
  const client = new ShopifyAdminClient({ shop: "test.myshopify.com", token: "bad", fetchImpl });
  await assert.rejects(() => client.fetchPaidOrders(), /HTTP 401/);
});
