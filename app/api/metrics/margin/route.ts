import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs"; // Force Node.js runtime
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

    // Fetch metrics in date range
    const metrics = await prisma.orderMetric.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    if (metrics.length === 0) {
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

    // Group by day and calculate metrics
    const dailyMetrics = new Map<string, {
      sales: number;
      marginChf: number;
      margins: number[];
      count: number;
    }>();

    let totalSales = 0;
    let totalMargin = 0;

    // Process each metric
    for (const metric of metrics) {
      const dateKey = metric.createdAt.toISOString().split("T")[0]; // YYYY-MM-DD

      if (!dailyMetrics.has(dateKey)) {
        dailyMetrics.set(dateKey, {
          sales: 0,
          marginChf: 0,
          margins: [],
          count: 0,
        });
      }

      const day = dailyMetrics.get(dateKey)!;
      day.sales += metric.grossSales;
      day.marginChf += metric.marginChf;
      day.margins.push(metric.marginPct);
      day.count += 1;

      totalSales += metric.grossSales;
      totalMargin += metric.marginChf;
    }

    // Convert to array and calculate medians
    const data = Array.from(dailyMetrics.entries())
      .map(([date, day]) => {
        // Calculate median margin percentage
        const sortedMargins = day.margins.sort((a, b) => a - b);
        const mid = Math.floor(sortedMargins.length / 2);
        const medianMarginPct = sortedMargins.length % 2 === 0
          ? (sortedMargins[mid - 1] + sortedMargins[mid]) / 2
          : sortedMargins[mid];

        return {
          date,
          sales: Math.round(day.sales * 100) / 100, // Round to 2 decimals
          marginChf: Math.round(day.marginChf * 100) / 100,
          marginPct: Math.round((day.marginChf / day.sales) * 100 * 100) / 100, // Percentage with 2 decimals
          medianMarginPct: Math.round(medianMarginPct * 100) / 100,
          orderCount: day.count,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date)); // Sort by date ascending

    // Calculate overall margin percentage
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
    console.error("[METRICS] Error fetching margin metrics:", error);

    // Check if it's a database error
    if (error instanceof Error && error.message.includes("no such table")) {
      return NextResponse.json(
        { error: "DB unavailable - OrderMetric table not found" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch margin metrics" },
      { status: 500 }
    );
  }
}
