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

    // Fetch ALL matched orders from DB (we'll filter by Shopify date later)
    const matches = await prisma.orderMatch.findMany({
      where: {
        marginAmount: { gt: 0 },
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        createdAt: true,
        shopifyTotalPrice: true,
        marginAmount: true,
        marginPercent: true,
        shopifyCurrencyCode: true,
      },
    });

    console.log(`[METRICS] Found ${matches.length} matched orders in DB`);

    if (matches.length === 0) {
      return NextResponse.json({
        data: [],
        totals: {
          totalSales: 0,
          totalMargin: 0,
          overallMarginPct: 0,
        },
        period: {
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
          days,
        },
      });
    }

    // Now we need to get REAL Shopify order dates from Shopify
    // Build map: shopifyOrderId -> match data
    const matchMap = new Map();
    for (const match of matches) {
      matchMap.set(match.shopifyOrderId, match);
    }

    // Fetch Shopify orders to get real creation dates
    const shopifyAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const shopifyShopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || "2024-10";

    if (!shopifyAccessToken || !shopifyShopDomain) {
      // Fallback: use match createdAt if Shopify not configured
      console.warn("[METRICS] Shopify not configured, using match dates");
      return buildMetricsFromMatches(matches, startDate, endDate, days);
    }

    // Fetch Shopify orders
    const shopifyQuery = `
      query getOrders($first: Int!) {
        orders(first: 250, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              cancelled
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

    // Build map: orderId -> shopify order
    const shopifyMap = new Map();
    for (const edge of shopifyOrders) {
      shopifyMap.set(edge.node.id, edge.node);
    }

    // Group by day using SHOPIFY creation date
    const dailyMetrics = new Map<string, {
      sales: number;
      marginChf: number;
      margins: number[];
      count: number;
    }>();

    let totalSales = 0;
    let totalMargin = 0;

    for (const match of matches) {
      const shopifyOrder = shopifyMap.get(match.shopifyOrderId);
      
      if (!shopifyOrder) {
        // Order not found in Shopify (maybe deleted), skip
        continue;
      }

      // Skip cancelled orders
      if (shopifyOrder.cancelled) {
        continue;
      }

      const orderDate = new Date(shopifyOrder.createdAt);
      
      // Filter by date range
      if (orderDate < startDate || orderDate > endDate) {
        continue;
      }

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
      day.sales += match.shopifyTotalPrice;
      day.marginChf += match.marginAmount;
      day.margins.push(match.marginPercent);
      day.count += 1;

      totalSales += match.shopifyTotalPrice;
      totalMargin += match.marginAmount;
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

// Fallback: use match dates if Shopify not available
function buildMetricsFromMatches(
  matches: any[],
  startDate: Date,
  endDate: Date,
  days: number
) {
  const dailyMetrics = new Map<string, {
    sales: number;
    marginChf: number;
    margins: number[];
    count: number;
  }>();

  let totalSales = 0;
  let totalMargin = 0;

  for (const match of matches) {
    const dateKey = match.createdAt.toISOString().split("T")[0];
    const matchDate = new Date(match.createdAt);

    if (matchDate < startDate || matchDate > endDate) {
      continue;
    }

    if (!dailyMetrics.has(dateKey)) {
      dailyMetrics.set(dateKey, {
        sales: 0,
        marginChf: 0,
        margins: [],
        count: 0,
      });
    }

    const day = dailyMetrics.get(dateKey)!;
    day.sales += match.shopifyTotalPrice;
    day.marginChf += match.marginAmount;
    day.margins.push(match.marginPercent);
    day.count += 1;

    totalSales += match.shopifyTotalPrice;
    totalMargin += match.marginAmount;
  }

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
}
