import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/metrics/monthly?year=2026&export=csv
 * 
 * Returns monthly aggregated financial data
 * Optionally exports as CSV
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get("year");
    const exportFormat = searchParams.get("export"); // "csv" or null
    
    const currentYear = new Date().getFullYear();
    const year = yearParam ? parseInt(yearParam) : currentYear;
    
    if (isNaN(year) || year < 2020 || year > 2100) {
      return NextResponse.json(
        { error: "Invalid year parameter" },
        { status: 400 }
      );
    }
    
    // Get all months of the year
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    
    const monthlyData = await Promise.all(months.map(async (month) => {
      const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      
      // Fetch order matches for the month (using sell date)
      const matches = await prisma.orderMatch.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          shopifyTotalPrice: true,
          supplierCost: true,
          marginAmount: true,
          manualRevenueAdjustment: true,
        },
      });
      
      // Calculate sales and margin
      let salesChf = 0;
      let marginChf = 0;
      
      for (const match of matches) {
        const revenue = toNumberSafe(match.shopifyTotalPrice, 0);
        const adjustment = toNumberSafe(match.manualRevenueAdjustment, 0);
        const cost = toNumberSafe(match.supplierCost, 0);
        const effectiveRevenue = revenue + adjustment;
        
        if (effectiveRevenue > 0) {
          salesChf += effectiveRevenue;
          marginChf += (effectiveRevenue - cost);
        }
      }
      
      // Fetch ads spend for the month
      const adsSpendRecords = await prisma.dailyAdSpend.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
      });
      
      const adsSpendChf = adsSpendRecords.reduce(
        (sum, r) => sum + toNumberSafe(r.amountChf, 0),
        0
      );
      
      // Fetch variable costs for the month
      const variableCosts = await prisma.monthlyVariableCosts.findUnique({
        where: { monthKey },
      });
      
      const postageShippingCostChf = variableCosts 
        ? toNumberSafe(variableCosts.postageShippingCostChf, 0)
        : 0;
      
      const fulfillmentCostChf = variableCosts
        ? toNumberSafe(variableCosts.fulfillmentCostChf, 0)
        : 0;
      
      // Calculate net after variable costs
      const netAfterVariableCostsChf = marginChf - adsSpendChf - postageShippingCostChf - fulfillmentCostChf;
      
      return {
        month: monthKey,
        monthNum: month,
        salesChf: Number(salesChf.toFixed(2)),
        grossMarginChf: Number(marginChf.toFixed(2)),
        adsSpendChf: Number(adsSpendChf.toFixed(2)),
        postageShippingCostChf: Number(postageShippingCostChf.toFixed(2)),
        fulfillmentCostChf: Number(fulfillmentCostChf.toFixed(2)),
        netAfterVariableCostsChf: Number(netAfterVariableCostsChf.toFixed(2)),
        marginPct: salesChf > 0 ? Number(((marginChf / salesChf) * 100).toFixed(2)) : 0,
        notes: variableCosts?.notes || "",
      };
    }));
    
    // Filter out months with no data (optional: keep all months for completeness)
    const monthsWithData = monthlyData.filter(m => m.salesChf > 0 || m.adsSpendChf > 0 || m.postageShippingCostChf > 0);
    
    // If CSV export requested
    if (exportFormat === "csv") {
      const csv = generateCSV(monthsWithData);
      
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="monthly_financials_${year}.csv"`,
        },
      });
    }
    
    // Calculate year totals
    const yearTotals = {
      salesChf: monthsWithData.reduce((sum, m) => sum + m.salesChf, 0),
      grossMarginChf: monthsWithData.reduce((sum, m) => sum + m.grossMarginChf, 0),
      adsSpendChf: monthsWithData.reduce((sum, m) => sum + m.adsSpendChf, 0),
      postageShippingCostChf: monthsWithData.reduce((sum, m) => sum + m.postageShippingCostChf, 0),
      fulfillmentCostChf: monthsWithData.reduce((sum, m) => sum + m.fulfillmentCostChf, 0),
      netAfterVariableCostsChf: monthsWithData.reduce((sum, m) => sum + m.netAfterVariableCostsChf, 0),
    };
    
    return NextResponse.json({
      success: true,
      year,
      months: monthsWithData,
      yearTotals: {
        ...yearTotals,
        marginPct: yearTotals.salesChf > 0 
          ? Number(((yearTotals.grossMarginChf / yearTotals.salesChf) * 100).toFixed(2))
          : 0,
      },
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[METRICS/MONTHLY] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch monthly metrics", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Generate CSV from monthly data
 * Accounting-friendly column names
 */
function generateCSV(data: any[]): string {
  const headers = [
    "month",
    "sales_chf",
    "gross_margin_chf",
    "margin_pct",
    "ads_spend_chf",
    "postage_shipping_cost_chf",
    "fulfillment_cost_chf",
    "net_after_variable_costs_chf",
    "notes",
  ];
  
  const rows = data.map(row => [
    row.month,
    row.salesChf,
    row.grossMarginChf,
    row.marginPct,
    row.adsSpendChf,
    row.postageShippingCostChf,
    row.fulfillmentCostChf,
    row.netAfterVariableCostsChf,
    `"${(row.notes || "").replace(/"/g, '""')}"`, // Escape quotes
  ]);
  
  const csvLines = [
    headers.join(","),
    ...rows.map(row => row.join(",")),
  ];
  
  return csvLines.join("\n");
}

