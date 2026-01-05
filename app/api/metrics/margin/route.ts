import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function median(values: number[]) {
  if (!values.length) return 0;
  const arr = [...values].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

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

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    // Fetch metrics directly from OrderMatch
    // Note: We fetch ALL matches (including closed/returned) to show refunds as negative impact
    const matches = await prisma.orderMatch.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        marginAmount: { gt: 0 },
        // Include closed cases for loss tracking (they show as negative when adjusted)
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        createdAt: true,
        shopifyTotalPrice: true,
        supplierCost: true,
        marginAmount: true,
        marginPercent: true,
        shopifyCurrencyCode: true,
        stockxOrderNumber: true,
        manualRevenueAdjustment: true,
        manualCaseStatus: true,
      },
    });

    console.log(`[METRICS] Found ${matches.length} matches in date range`);

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

    const dailyMetrics = new Map<string, {
      sales: number;
      marginChf: number;
      margins: number[];
      count: number;
    }>();

    let totalSales = 0;
    let totalMargin = 0;

    for (const match of matches) {
      // 💰 POC: Calculate effective revenue (adjusted for refunds/returns)
      // Convert Prisma Decimals to numbers for calculations
      const revenue = Number(match.shopifyTotalPrice);
      const revenueAdjustment = match.manualRevenueAdjustment ? Number(match.manualRevenueAdjustment) : 0;
      const cost = Number(match.supplierCost);
      const effectiveRevenue = revenue + revenueAdjustment;
      
      // Skip if fully refunded (effectiveRevenue <= 0)
      if (effectiveRevenue <= 0) {
        console.log(`[METRICS] Skipping fully refunded order ${match.shopifyOrderName} (adjustment: ${revenueAdjustment})`);
        continue;
      }
      
      // Recalculate margin with adjusted revenue
      const adjustedMarginAmount = effectiveRevenue - cost;
      const adjustedMarginPercent = effectiveRevenue > 0 
        ? (adjustedMarginAmount / effectiveRevenue) * 100 
        : 0;
      
      const dateKey = match.createdAt.toISOString().split("T")[0];

      if (!dailyMetrics.has(dateKey)) {
        dailyMetrics.set(dateKey, {
          sales: 0,
          marginChf: 0,
          margins: [],
          count: 0,
        });
      }

      const day = dailyMetrics.get(dateKey)!;
      day.sales += effectiveRevenue;
      day.marginChf += adjustedMarginAmount;
      day.margins.push(adjustedMarginPercent);
      day.count += 1;

      totalSales += effectiveRevenue;
      totalMargin += adjustedMarginAmount;
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
          sales: Number(day.sales.toFixed(2)),
          marginChf: Number(day.marginChf.toFixed(2)),
          marginPct: day.sales > 0 ? Number((day.marginChf / day.sales * 100).toFixed(2)) : 0,
          medianMarginPct: Number(medianMarginPct.toFixed(2)),
          orderCount: day.count,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const overallMarginPct = totalSales > 0
      ? Number((totalMargin / totalSales * 100).toFixed(2))
      : 0;

    return NextResponse.json({
      data,
      totals: {
        totalSales: Number(totalSales.toFixed(2)),
        totalMargin: Number(totalMargin.toFixed(2)),
        overallMarginPct,
      },
      period: {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        days,
      },
    });

  } catch (error: any) {
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
