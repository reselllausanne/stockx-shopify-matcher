// app/api/shopify/orders/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphQL, extractEUSize } from "@/lib/shopifyAdmin";

export const runtime = "nodejs";

type ShopifyLineItem = {
  shopifyOrderId: string;
  orderId: string;
  orderName: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  customerName: string | null;
  lineItemId: string;
  title: string;
  sku: string | null;
  variantTitle: string | null;
  sizeEU: string | null;
  quantity: number;
  price: string; // unit price
  totalPrice: string; // line total
  currencyCode: string;
};

const QUERY = /* GraphQL */ `
query OrdersForMatching($first: Int!, $query: String!) {
  orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        customer { displayName }
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              sku
              quantity
              variantTitle
              originalUnitPriceSet { shopMoney { amount currencyCode } }
              discountedTotalSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }
  }
}
`;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sinceDays = Number(body?.sinceDays ?? 30);
    const days = Number.isFinite(sinceDays) ? sinceDays : 30;

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const iso = sinceDate.toISOString();

    // Search for paid orders (not filtering by fulfillment to get all)
    const search = `created_at:>${iso} financial_status:paid`;

    console.log(`[SHOPIFY] Fetching orders with query: ${search}`);

    const { data, errors } = await shopifyGraphQL<{
      orders: { edges: { node: any }[] };
    }>(QUERY, { first: 100, query: search });

    if (errors?.length) {
      console.error("[SHOPIFY] GraphQL errors:", errors);
      return NextResponse.json({ error: "Shopify GraphQL errors", details: errors }, { status: 500 });
    }

    const edges = data?.orders?.edges ?? [];
    const lineItems: ShopifyLineItem[] = [];

    for (const e of edges) {
      const o = e.node;
      const orderId = o.id;
      const orderName = o.name;
      const createdAt = o.createdAt;
      const displayFinancialStatus = o.displayFinancialStatus ?? null;
      const displayFulfillmentStatus = o.displayFulfillmentStatus ?? null;
      const customerName = o.customer?.displayName ?? null;

      const liEdges = o.lineItems?.edges ?? [];
      for (const liE of liEdges) {
        const li = liE.node;
        const unit = li.originalUnitPriceSet?.shopMoney;
        const total = li.discountedTotalSet?.shopMoney;
        const currencyCode = total?.currencyCode || unit?.currencyCode || "CHF";
        const totalAmount = total?.amount ?? "0";
        const qty = Number(li.quantity ?? 0);
        const unitAmount =
          unit?.amount ??
          (qty > 0 ? String(Number(totalAmount) / qty) : "0");

        const variantTitle = li.variantTitle ?? null;
        const sizeEU = extractEUSize(variantTitle) ?? extractEUSize(li.title);

        lineItems.push({
          shopifyOrderId: orderId,
          orderId,
          orderName,
          createdAt,
          displayFinancialStatus,
          displayFulfillmentStatus,
          customerName,
          lineItemId: li.id,
          title: li.title ?? "—",
          sku: li.sku ?? null,
          variantTitle,
          sizeEU,
          quantity: qty,
          price: String(unitAmount),
          totalPrice: String(totalAmount),
          currencyCode,
        });
      }
    }

    console.log(`[SHOPIFY] Fetched ${lineItems.length} line items from ${edges.length} orders`);

    return NextResponse.json({ lineItems });
  } catch (err: any) {
    console.error("[/api/shopify/orders] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
