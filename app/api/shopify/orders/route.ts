// app/api/shopify/orders/route.ts
import { NextResponse } from "next/server";
import { shopifyGraphQL, extractEUSize } from "@/lib/shopifyAdmin";
import { formatInTimeZone } from "date-fns-tz";

export const runtime = "nodejs";

const SHOP_TIMEZONE = "Europe/Zurich";

type ShopifyLineItem = {
  shopifyOrderId: string;
  orderId: string;
  orderName: string;
  createdAt: string; // Zurich-local ISO string (preserves exact time, adjusted to shop timezone)
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

/**
 * Convert UTC timestamp to shop timezone (Europe/Zurich)
 * Returns an ISO string that carries the +01:00/+02:00 offset so clients
 * can interpret it without applying additional offsets.
 */
function convertToShopTimezone(utcTimestamp: string): string {
  const utcDate = new Date(utcTimestamp);
  return formatInTimeZone(utcDate, SHOP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * Calculate proportional line item pricing from order total
 * Ensures line items sum to exact order total (accounting for discounts)
 */
function calculateLineItemPricing(
  orderTotalAmount: number,
  lineItemCount: number,
  lineDiscountedAmount: number,
  lineItemTotalSum: number,
  quantity: number
): { unitPrice: string; totalPrice: string } {
  let realLineTotal: number;
  
  if (lineItemCount === 1) {
    // Single item: use full order total
    realLineTotal = orderTotalAmount;
  } else {
    // Multiple items: proportional allocation
    const proportion = lineItemTotalSum > 0 ? lineDiscountedAmount / lineItemTotalSum : 0;
    realLineTotal = orderTotalAmount * proportion;
  }
  
  const totalPrice = realLineTotal.toFixed(2);
  const unitPrice = quantity > 0 ? (realLineTotal / quantity).toFixed(2) : totalPrice;
  
  return { unitPrice, totalPrice };
}

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
    const first = Number(body?.first) > 0 ? Number(body.first) : 124;
    
    // Build query for start of current year (UTC)
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    const search = `created_at:>=${yearStart.toISOString()}`;
    
    console.log(`[SHOPIFY] Fetching up to ${first} orders from ${now.getUTCFullYear()}...`);

    const { data, errors } = await shopifyGraphQL<{
      orders: { edges: { node: any }[] };
    }>(QUERY, { first, query: search });

    if (errors?.length) {
      console.error("[SHOPIFY] GraphQL errors:", errors);
      return NextResponse.json(
        { error: "Shopify GraphQL errors", details: errors },
        { status: 500 }
      );
    }

    const edges = data?.orders?.edges ?? [];
    const lineItems: ShopifyLineItem[] = [];
    let skippedBeforeJan1 = 0;

    for (const e of edges) {
      const o = e.node;
      
      // Skip orders before Jan 1st (using UTC for consistent filtering)
      const orderDateUtc = new Date(o.createdAt);
      if (orderDateUtc < yearStart) {
        skippedBeforeJan1++;
        continue;
      }

      // Extract order-level data
      const orderId = o.id;
      const orderName = o.name;
      const createdAt = convertToShopTimezone(o.createdAt);
      const displayFinancialStatus = o.displayFinancialStatus ?? null;
      const displayFulfillmentStatus = o.displayFulfillmentStatus ?? null;
      const customerName = o.customer?.displayName ?? null;

      // Extract order total (what customer actually pays)
      const orderTotal = o.currentTotalPriceSet?.shopMoney;
      const orderTotalAmount = orderTotal?.amount ? parseFloat(orderTotal.amount) : 0;
      const orderCurrency = orderTotal?.currencyCode || "CHF";

      const liEdges = o.lineItems?.edges ?? [];
      const lineItemCount = liEdges.length;

      // Calculate line item sum for proportional allocation (multi-item orders only)
      let lineItemTotalSum = 0;
      if (lineItemCount > 1) {
        for (const liE of liEdges) {
          const liTotal = liE.node.discountedTotalSet?.shopMoney?.amount;
          lineItemTotalSum += liTotal ? parseFloat(liTotal) : 0;
        }
      }

      // Process each line item
      for (const liE of liEdges) {
        const li = liE.node;
        const qty = Number(li.quantity ?? 0);
        const lineDiscountedAmount = li.discountedTotalSet?.shopMoney?.amount 
          ? parseFloat(li.discountedTotalSet.shopMoney.amount) 
          : 0;

        // Calculate pricing (proportional allocation for multi-item orders)
        const { unitPrice, totalPrice } = calculateLineItemPricing(
          orderTotalAmount,
          lineItemCount,
          lineDiscountedAmount,
          lineItemTotalSum,
          qty
        );

        // Extract product info
        const variantTitle = li.variantTitle ?? null;
        const productName = li.name ?? li.title ?? "Unknown Product";
        const sizeEU = extractEUSize(variantTitle) ?? extractEUSize(productName) ?? null;

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
          price: unitPrice,
          totalPrice,
          currencyCode: orderCurrency,
        });
      }
    }

    console.log(
      `[SHOPIFY] Fetched ${lineItems.length} line items from ${edges.length} orders ` +
      `(${skippedBeforeJan1} skipped before Jan 1)`
    );
    
    return NextResponse.json({ 
      lineItems,
      metadata: {
        totalOrders: edges.length,
        lineItemsCount: lineItems.length,
        skippedBeforeJan1,
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