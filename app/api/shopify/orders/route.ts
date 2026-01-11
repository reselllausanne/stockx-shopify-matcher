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
              title
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
    
    // Build query for start of year in UTC (up to 60 orders)
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0)); // Jan 1st, 00:00:00 UTC
    const isoYearStart = yearStart.toISOString();
    
    // Fetch orders from start of year (we'll filter fulfilled later)
    const search = `created_at:>=${isoYearStart}`;
    console.log(`[SHOPIFY] Fetching up to 60 orders since ${isoYearStart.split('T')[0]} (start of year UTC)...`);

    const { data, errors } = await shopifyGraphQL<{
      orders: { edges: { node: any }[] };
    }>(QUERY, { first: 60, query: search });

    if (errors?.length) {
      console.error("[SHOPIFY] GraphQL errors:", errors);
      return NextResponse.json(
        { error: "Shopify GraphQL errors", details: errors },
        { status: 500 }
      );
    }

    const edges = data?.orders?.edges ?? [];
    const lineItems: ShopifyLineItem[] = [];
    let skippedFulfilled = 0;
    let skippedBeforeJan1 = 0;

    for (const e of edges) {
      const o = e.node;
      const orderId = o.id;
      const orderName = o.name;
      const createdAt = o.createdAt;
      const displayFinancialStatus = o.displayFinancialStatus ?? null;
      const displayFulfillmentStatus = o.displayFulfillmentStatus ?? null;
      const customerName = o.customer?.displayName ?? null;

      // CRITICAL: Skip fulfilled orders (they can't be matched)
      if (displayFulfillmentStatus === "FULFILLED" || displayFulfillmentStatus === "SHIPPED") {
        skippedFulfilled++;
        continue;
      }

      // CRITICAL: Skip orders before Jan 1st (double-check)
      const orderDate = new Date(createdAt);
      if (orderDate < yearStart) {
        skippedBeforeJan1++;
        continue;
      }

      // CRITICAL: Use ORDER-level currentTotalPriceSet (what customer actually pays)
      const orderTotal = o.currentTotalPriceSet?.shopMoney;
      const orderTotalAmount = orderTotal?.amount ? parseFloat(orderTotal.amount) : 0;
      const orderCurrency = orderTotal?.currencyCode || "CHF";

      const liEdges = o.lineItems?.edges ?? [];
      const lineItemCount = liEdges.length;

      // Calculate line item sum for proportional allocation
      let lineItemTotalSum = 0;
      if (lineItemCount > 1) {
        for (const liE of liEdges) {
          const liTotal = liE.node.discountedTotalSet?.shopMoney?.amount;
          lineItemTotalSum += liTotal ? parseFloat(liTotal) : 0;
        }
      }

      for (const liE of liEdges) {
        const li = liE.node;

        const discounted = li.discountedTotalSet?.shopMoney;
        const qty = Number(li.quantity ?? 0);

        // Calculate REAL line total (proportional share of order total)
        let realLineTotal: number;
        if (lineItemCount === 1) {
          // Single item: use full order total
          realLineTotal = orderTotalAmount;
        } else {
          // Multiple items: proportional allocation
          const lineDiscounted = discounted?.amount ? parseFloat(discounted.amount) : 0;
          const proportion = lineItemTotalSum > 0 ? lineDiscounted / lineItemTotalSum : 0;
          realLineTotal = orderTotalAmount * proportion;
        }

        const totalAmount = realLineTotal.toFixed(2);
        const unitAmount = qty > 0 ? (realLineTotal / qty).toFixed(2) : totalAmount;

        const variantTitle = li.variantTitle ?? null;
        const productName = li.name ?? li.title ?? "Unknown Product";
        const sizeEU =
          extractEUSize(variantTitle) ?? extractEUSize(productName) ?? null;

        // Debug missing name
        if (!li.name && !li.title) {
          console.warn(`[SHOPIFY] Line item ${li.id} missing name/title`, {
            sku: li.sku,
            variantTitle: li.variantTitle,
          });
        }

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
          price: unitAmount,      // From ORDER total (all discounts)
          totalPrice: totalAmount, // From ORDER total (all discounts)
          currencyCode: orderCurrency,
        });
      }
    }

    console.log(`[SHOPIFY] Fetched ${lineItems.length} line items from ${edges.length} orders (${skippedFulfilled} fulfilled skipped, ${skippedBeforeJan1} before Jan 1 skipped)`);
    return NextResponse.json({ 
      lineItems,
      metadata: {
        totalOrders: edges.length,
        skippedFulfilled,
        skippedBeforeJan1,
        lineItemsCount: lineItems.length,
      }
    });
  } catch (err: any) {
    console.error("[/api/shopify/orders] error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}