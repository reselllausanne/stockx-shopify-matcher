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
  price: string;      // unit price AFTER discounts
  totalPrice: string; // line total AFTER discounts
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

        currentSubtotalPriceSet {
          shopMoney { amount currencyCode }
        }
        currentTotalDiscountsSet {
          shopMoney { amount currencyCode }
        }
        currentTotalPriceSet {
          shopMoney { amount currencyCode }
        }

        lineItems(first: 50) {
          edges {
            node {
              id
              name
              sku
              quantity
              variantTitle
              discountedTotalSet {
                shopMoney { amount currencyCode }
              }
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

    const search = `created_at:>${iso} financial_status:paid`;
    console.log(`[SHOPIFY] Fetching orders with query: ${search}`);

    const { data, errors } = await shopifyGraphQL<{
      orders: { edges: { node: any }[] };
    }>(QUERY, { first: 100, query: search });

    if (errors?.length) {
      console.error("[SHOPIFY] GraphQL errors:", errors);
      return NextResponse.json(
        { error: "Shopify GraphQL errors", details: errors },
        { status: 500 }
      );
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

      // Get order-level total (AFTER all discounts including order-level codes)
      const orderTotal = o.currentTotalPriceSet?.shopMoney;
      const orderSubtotal = o.currentSubtotalPriceSet?.shopMoney;
      
      const liEdges = o.lineItems?.edges ?? [];
      
      // Calculate order-level discount ratio
      const orderTotalAmount = orderTotal?.amount ? parseFloat(orderTotal.amount) : 0;
      const orderSubtotalAmount = orderSubtotal?.amount ? parseFloat(orderSubtotal.amount) : 0;
      const orderDiscountRatio = orderSubtotalAmount > 0 
        ? orderTotalAmount / orderSubtotalAmount 
        : 1;

      for (const liE of liEdges) {
        const li = liE.node;

        // Start with line-item discounted total
        const discounted = li.discountedTotalSet?.shopMoney;
        const currencyCode = discounted?.currencyCode || orderTotal?.currencyCode || "CHF";
        const lineDiscountedAmount = discounted?.amount ? parseFloat(discounted.amount) : 0;
        
        // Apply order-level discount ratio to get FINAL price
        const finalAmount = lineDiscountedAmount * orderDiscountRatio;
        const totalAmount = finalAmount.toFixed(2);

        const qty = Number(li.quantity ?? 0);
        const unitAmount =
          qty > 0 ? (finalAmount / qty).toFixed(2) : totalAmount;

        const variantTitle = li.variantTitle ?? null;
        const productName = li.name ?? "—";
        const sizeEU =
          extractEUSize(variantTitle) ?? extractEUSize(productName) ?? null;

        lineItems.push({
          shopifyOrderId: orderId,
          orderId,
          orderName,
          createdAt,
          displayFinancialStatus,
          displayFulfillmentStatus,
          customerName,
          lineItemId: li.id,
          title: productName,
          sku: li.sku ?? null,
          variantTitle,
          sizeEU,
          quantity: qty,
          price: unitAmount,      // AFTER all discounts (line + order level)
          totalPrice: totalAmount, // AFTER all discounts (line + order level)
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