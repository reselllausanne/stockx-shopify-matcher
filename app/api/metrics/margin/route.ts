import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");

    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json(
        { error: "Invalid days parameter. Must be between 1 and 365." },
        { status: 400 }
      );
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    // IMPORTANT: We need to fetch from Shopify to get the ACTUAL order creation dates
    // because OrderMatch.createdAt is when we matched it, not when customer ordered!
    
    // Fetch Shopify orders to get real creation dates
    const shopifyAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const shopifyShopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || "2024-10";

    if (!shopifyAccessToken || !shopifyShopDomain) {
      return NextResponse.json(
        { error: "Shopify credentials not configured" },
        { status: 500 }
      );
    }

    // Fetch Shopify orders with metafields
    const shopifyQuery = `
      query getOrders($first: Int!) {
        orders(first: 250, reverse: true, query: "financial_status:paid OR financial_status:authorized") {
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              cancelled
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
            }
          }
        }
      }
    `;

    const shopifyRes = await fetch(
      `https://${shopifyShopDomain}/admin/api/${shopifyApiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyAccessToken,
        },
        body: JSON.stringify({
          query: shopifyQuery,
          variables: { first: 250 },
        }),
      }
    );

    const shopifyData = await shopifyRes.json();
    const shopifyOrders = shopifyData?.data?.orders?.edges || [];

    // Get all matched orders from DB
    const dbMatches = await prisma.orderMatch.findMany({
      where: {
        marginAmount: { gt: 0 },
      },
      select: {
        shopifyOrderId: true,
        shopifyTotalPrice: true,
        marginAmount: true,
        marginPercent: true,
      },
    });

    // Create a map for quick lookup
    const dbMatchMap = new Map();
    for (const match of dbMatches) {
      if (!dbMatchMap.has(match.shopifyOrderId)) {
        dbMatchMap.set(match.shopifyOrderId, {
          revenue: match.shopifyTotalPrice,
          margin: match.marginAmount,
          marginPct: match.marginPercent,
        });
      }
    }

    // Group by day
    const dailyMetrics = new Map<string, {
      sales: number;
      marginChf: number;
      margins: number[];
      count: number;
    }>();

    let totalSales = 0;
    let totalMargin = 0;

    // Process Shopify orders
    for (const edge of shopifyOrders) {
      const order = edge.node;
      const orderId = order.id;
      const orderDate = new Date(order.createdAt);
      
      // Skip if outside date range
      if (orderDate < startDate || orderDate > endDate) continue;
      
      // Skip cancelled orders
      if (order.cancelled) continue;
      
      // Skip if not matched in DB
      const matchData = dbMatchMap.get(orderId);
      if (!matchData) continue;

      const dateKey = orderDate.toISOString().split("T")[0];

      if (!dailyMetrics.has(dateKey)) {
        dailyMetrics.set(dateKey, {
          sales: 0,
          marginChf: 0,
          margins: [],
          count: 0,
        });
      }

      const day = dailyMetrics.get(dateKey)!;
      day.sales += matchData.revenue;
      day.marginChf += matchData.margin;
      day.margins.push(matchData.marginPct);
      day.count += 1;

      totalSales += matchData.revenue;
      totalMargin += matchData.margin;
    }

    // Convert to array
    const data = Array.from(dailyMetrics.entries())
      .map(([date, day]) => {
        const sortedMargins = day.margins.sort((a, b) => a - b);
        const mid = Math.floor(sortedMargins.length / 2);
        const medianMarginPct = sortedMargins.length % 2 === 0
          ? (sortedMargins[mid - 1] + sortedMargins[mid]) / 2
          : sortedMargins[mid];

        return {
          date,
          sales: Math.round(day.sales * 100) / 100,
          marginChf: Math.round(day.marginChf * 100) / 100,
          marginPct: Math.round((day.marginChf / day.sales) * 100 * 100) / 100,
          medianMarginPct: Math.round(medianMarginPct * 100) / 100,
          orderCount: day.count,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const overallMarginPct = totalSales > 0
      ? Math.round((totalMargin / totalSales) * 100 * 100) / 100
      : 0;

    return NextResponse.json({
      data,
      totals: {
        totalSales: Math.round(totalSales * 100) / 100,
        totalMargin: Math.round(totalMargin * 100) / 100,
        overallMarginPct,
      },
      period: {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        days,
      },
    });

  } catch (error) {
    console.error("[METRICS] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return NextResponse.json(
      { 
        error: "Failed to fetch metrics",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}
