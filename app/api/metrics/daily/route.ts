import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { startOfDay, endOfDay, subDays, format } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEZONE = "Europe/Zurich";

type DateMode = "locked" | "booked";

/**
 * GET /api/metrics/daily?range=7&dateMode=locked|booked
 * 
 * Returns daily financial KPIs with LOCKED MARGIN focus:
 * - Locked Sales/Margin (when supplier cost is known)
 * - Booked Sales (all Shopify sales)
 * - Coverage % (reliability indicator)
 * - Uncovered Exposure (sales without known costs)
 * - Ads Spend integration
 * 
 * Date modes:
 * - "locked" (DEFAULT): Group by stockxPurchaseDate (when cost locked/margin calculable)
 * - "booked": Group by Shopify createdAt (marketing/sell date view)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const range = parseInt(searchParams.get("range") || "30");
    const dateMode = (searchParams.get("dateMode") || "locked") as DateMode; // DEFAULT: locked
    
    if (isNaN(range) || range < 1 || range > 365) {
      return NextResponse.json(
        { error: "Invalid range parameter. Must be between 1 and 365." },
        { status: 400 }
      );
    }
    
    if (dateMode !== "locked" && dateMode !== "booked") {
      return NextResponse.json(
        { error: "Invalid dateMode. Must be 'locked' or 'booked'." },
        { status: 400 }
      );
    }
    
    // 🌍 TIMEZONE FIX: Use Europe/Zurich for all date operations
    const nowZurich = toZonedTime(new Date(), TIMEZONE);
    
    // Calculate date range correctly:
    // - "Today" (range=1): startOfDay(now) to endOfDay(now)
    // - "Last 7" (range=7): startOfDay(now - 6 days) to endOfDay(now)
    const daysToSubtract = range - 1; // For range=1 (today), subtract 0 days
    const startDateZurich = startOfDay(subDays(nowZurich, daysToSubtract));
    const endDateZurich = endOfDay(nowZurich);
    
    // Convert to UTC for database queries
    const startDate = fromZonedTime(startDateZurich, TIMEZONE);
    const endDate = fromZonedTime(endDateZurich, TIMEZONE);
    
    // Safety: Never show orders before Jan 1st of current year
    const yearStart = new Date(Date.UTC(nowZurich.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    const effectiveStartDate = startDate < yearStart ? yearStart : startDate;
    
    // 📊 LOGGING: Verify date range calculation
    console.log(`[METRICS] Date Range Calculation:`);
    console.log(`  - Now (Zurich): ${format(nowZurich, 'yyyy-MM-dd HH:mm:ss')}`);
    console.log(`  - Range: ${range} days`);
    console.log(`  - Start (Zurich): ${format(startDateZurich, 'yyyy-MM-dd HH:mm:ss')}`);
    console.log(`  - End (Zurich): ${format(endDateZurich, 'yyyy-MM-dd HH:mm:ss')}`);
    console.log(`  - Start (UTC): ${startDate.toISOString()}`);
    console.log(`  - End (UTC): ${endDate.toISOString()}`);
    console.log(`  - Effective Start: ${effectiveStartDate.toISOString()}`);
    
    // === BOOKED SALES: Query ShopifyOrder table (ALL orders, matched or not) ===
    const shopifyOrders = await prisma.shopifyOrder.findMany({
      where: {
        createdAt: {
          gte: effectiveStartDate,
          lte: endDate,
        },
      },
      select: {
        shopifyOrderId: true,
        orderName: true,
        createdAt: true,
        totalSalesChf: true,
        netSalesChf: true,
        refundedAmountChf: true,
        financialStatus: true,
        cancelledAt: true,
        currencyCode: true,
      },
    });
    
    // === LOCKED SALES: Query OrderMatch (only matched orders with known cost) ===
    // Build mode-specific where filter (NOT OR - prevents mixing date bases)
    const shopifyOrderIds = shopifyOrders.map((o: any) => o.shopifyOrderId);
    
    let orderMatchWhere: any;
    if (dateMode === "locked") {
      // LOCKED MODE: Filter by supplier purchase date range
      // CRITICAL: stockxPurchaseDate must NOT be null
      orderMatchWhere = {
        stockxPurchaseDate: {
          not: null,
          gte: startDate,
          lte: endDate,
        },
        OR: [
          { supplierCost: { gt: 0 } },
          { manualCostOverride: { gt: 0 } },
        ],
      };
    } else {
      // BOOKED MODE: Filter by Shopify order IDs (matches can be created later)
      // This ensures we get all matches for orders sold in this period
      orderMatchWhere = {
        shopifyOrderId: {
          in: shopifyOrderIds,
        },
        OR: [
          { supplierCost: { gt: 0 } },
          { manualCostOverride: { gt: 0 } },
        ],
      };
    }
    
    console.log(`[METRICS] Querying OrderMatch with mode=${dateMode}, where=`, JSON.stringify(orderMatchWhere, null, 2));
    
    const orderMatches = await prisma.orderMatch.findMany({
      where: orderMatchWhere,
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderName: true,
        createdAt: true,
        stockxPurchaseDate: true, // Supplier purchase date
        shopifyTotalPrice: true,
        supplierCost: true,
        manualCostOverride: true, // ADDED: For manual matches
        manualRevenueAdjustment: true,
        supplierSource: true,
      },
    });
    
    // Fetch ads spend for the period
    const adsSpendRecords = await prisma.dailyAdSpend.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
    
    // ===================================================================
    // AGGREGATION LOGIC - Two-pass approach
    // ===================================================================
    
    type DailyData = {
      date: string;
      bookedSalesChf: number;
      lockedSalesChf: number;
      lockedMarginChf: number;
      adsSpendChf: number;
      bookedOrderCount: number;
      lockedOrderCount: number;
      matchedShopifyIds: Set<string>;
    };
    
    const dailyMap = new Map<string, DailyData>();
    
    // Helper: Initialize a day
    const initDay = (dateKey: string): DailyData => ({
      date: dateKey,
      bookedSalesChf: 0,
      lockedSalesChf: 0,
      lockedMarginChf: 0,
      adsSpendChf: 0,
      bookedOrderCount: 0,
      lockedOrderCount: 0,
      matchedShopifyIds: new Set(),
    });
    
    // 🔧 COVERAGE FIX: Build map of shopifyOrderId → sellDate for BOOKED mode
    const shopifyOrderDateMap = new Map<string, string>();
    // 🔧 REFUND FIX: Build map of shopifyOrderId → refund adjustment factor
    const refundAdjustmentMap = new Map<string, number>();
    
    for (const order of shopifyOrders) {
      const sellDate = order.createdAt.toISOString().split('T')[0];
      shopifyOrderDateMap.set(order.shopifyOrderId, sellDate);
      
      // Calculate refund adjustment factor: netSales / grossSales
      // This will be applied proportionally to each line item
      const grossSales = toNumberSafe(order.totalSalesChf, 0);
      const netSales = order.netSalesChf !== null && order.netSalesChf !== undefined
        ? toNumberSafe(order.netSalesChf, 0)
        : grossSales;
      
      const adjustmentFactor = grossSales > 0 ? netSales / grossSales : 1.0;
      refundAdjustmentMap.set(order.shopifyOrderId, adjustmentFactor);
    }
    
    // PASS 1: Process ALL Shopify orders (booked sales)
    // Group by sell date (createdAt)
    // Use netSalesChf (gross - refunds) for accurate financials
    for (const order of shopifyOrders) {
      const sellDate = order.createdAt.toISOString().split('T')[0];
      
      if (!dailyMap.has(sellDate)) {
        dailyMap.set(sellDate, initDay(sellDate));
      }
      
      const day = dailyMap.get(sellDate)!;
      // Use netSalesChf if available (after migration), fallback to totalSalesChf
      const salesAmount = order.netSalesChf !== null && order.netSalesChf !== undefined
        ? toNumberSafe(order.netSalesChf, 0)
        : toNumberSafe(order.totalSalesChf, 0);
      
      day.bookedSalesChf += salesAmount;
      day.bookedOrderCount += 1;
    }
    
    console.log(`[METRICS] Processed ${shopifyOrders.length} Shopify orders across ${dailyMap.size} days`);
    
    // PASS 2: Process OrderMatch (locked sales + margin)
    // Group by dateMode with CORRECT date alignment
    let missingPurchaseDateCount = 0; // Track matches without supplier purchase date (locked mode only)
    
    for (const match of orderMatches) {
      // Determine the date key based on mode
      let dateKey: string | null = null;
      
      if (dateMode === "locked") {
        // LOCKED MODE: Group by supplier purchase date (when cost was locked)
        // CRITICAL: Do NOT fallback to createdAt - skip if purchase date missing
        if (!match.stockxPurchaseDate) { // FIXED: Was typo "stocPurchaseDate"
          missingPurchaseDateCount++;
          console.log(
            `[METRICS] ⚠️ Skipping match ${match.shopifyOrderName} in locked mode: ` +
            `No supplier purchase date (match created ${match.createdAt.toISOString().split('T')[0]})`
          );
          continue; // Skip this match - no purchase date = can't group in locked mode
        }
        dateKey = match.stockxPurchaseDate.toISOString().split('T')[0];
      } else {
        // BOOKED MODE: Group by Shopify order's SELL DATE (not match creation date!)
        // This ensures locked sales align with booked sales for correct coverage
        dateKey = shopifyOrderDateMap.get(match.shopifyOrderId) || null;
        
        if (!dateKey) {
          // Match has shopifyOrderId not in our queried range - skip it
          continue;
        }
      }
      
      if (!dateKey) continue;
      
      // Ensure day exists
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, initDay(dateKey));
      }
      
      const day = dailyMap.get(dateKey)!;
      
      // Calculate locked sales and margin
      const revenue = toNumberSafe(match.shopifyTotalPrice, 0);
      const adjustment = toNumberSafe(match.manualRevenueAdjustment, 0);
      
      // effectiveCost: Use manualCostOverride if set, otherwise supplierCost
      const effectiveCost = toNumberSafe(match.manualCostOverride, 0) || toNumberSafe(match.supplierCost, 0);
      
      // Apply refund adjustment if order was partially/fully refunded
      const refundFactor = refundAdjustmentMap.get(match.shopifyOrderId) ?? 1.0;
      const effectiveRevenue = (revenue + adjustment) * refundFactor;
      
      // Skip refunded/zero revenue or zero cost
      if (effectiveRevenue <= 0 || effectiveCost <= 0) continue;
      
      const margin = effectiveRevenue - effectiveCost;
      
      // Add to locked metrics
      day.lockedSalesChf += effectiveRevenue;
      day.lockedMarginChf += margin;
      day.lockedOrderCount += 1;
      
      // Track which Shopify orders are matched (for uncovered calc)
      if (match.shopifyOrderId) {
        day.matchedShopifyIds.add(match.shopifyOrderId);
      }
    }
    
    // PASS 3: Add ads spend to each day
    for (const adsRecord of adsSpendRecords) {
      const dateKey = adsRecord.date.toISOString().split('T')[0];
      
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, initDay(dateKey));
      }
      
      const day = dailyMap.get(dateKey)!;
      day.adsSpendChf = toNumberSafe(adsRecord.amountChf, 0);
    }
    
    // ===================================================================
    // BUILD OUTPUT
    // ===================================================================
    
    let totalBookedSales = 0;
    let totalLockedSales = 0;
    let totalLockedMargin = 0;
    let totalAdsSpend = 0;
    let totalBookedOrders = 0;
    let totalLockedOrders = 0;
    
    // Build daily rows
    const rows = Array.from(dailyMap.values())
      .map(day => {
        // Calculate uncovered for this day
        // Uncovered = booked orders that don't have a match with cost
        const uncoveredSalesChf = Math.max(0, day.bookedSalesChf - day.lockedSalesChf);
        const uncoveredCount = day.bookedOrderCount - day.matchedShopifyIds.size;
        
        // Coverage percentage
        const coveragePct = day.bookedSalesChf > 0
          ? (day.lockedSalesChf / day.bookedSalesChf) * 100
          : 100; // 100% if no sales (no exposure)
        
        // Margin percentage
        const lockedMarginPct = day.lockedSalesChf > 0
          ? (day.lockedMarginChf / day.lockedSalesChf) * 100
          : 0;
        
        // Net after ads
        const netAfterAdsChf = day.lockedMarginChf - day.adsSpendChf;
        
        // Update totals
        totalBookedSales += day.bookedSalesChf;
        totalLockedSales += day.lockedSalesChf;
        totalLockedMargin += day.lockedMarginChf;
        totalAdsSpend += day.adsSpendChf;
        totalBookedOrders += day.bookedOrderCount;
        totalLockedOrders += day.lockedOrderCount;
        
        return {
          date: day.date,
          bookedSalesChf: Number(day.bookedSalesChf.toFixed(2)),
          lockedSalesChf: Number(day.lockedSalesChf.toFixed(2)),
          lockedMarginChf: Number(day.lockedMarginChf.toFixed(2)),
          lockedMarginPct: Number(lockedMarginPct.toFixed(2)),
          adsSpendChf: Number(day.adsSpendChf.toFixed(2)),
          netAfterAdsChf: Number(netAfterAdsChf.toFixed(2)),
          coveragePct: Number(coveragePct.toFixed(1)),
          uncoveredSalesChf: Number(uncoveredSalesChf.toFixed(2)),
          uncoveredCount: Math.max(0, uncoveredCount),
          bookedOrderCount: day.bookedOrderCount,
          lockedOrderCount: day.lockedOrderCount,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate overall metrics
    const totalNetAfterAds = totalLockedMargin - totalAdsSpend;
    const overallLockedMarginPct = totalLockedSales > 0
      ? (totalLockedMargin / totalLockedSales) * 100
      : 0;
    const overallCoveragePct = totalBookedSales > 0
      ? (totalLockedSales / totalBookedSales) * 100
      : 100;
    const totalUncoveredSales = Math.max(0, totalBookedSales - totalLockedSales);
    
    // 📊 COMPREHENSIVE LOGGING: Verify calculations
    console.log(`[METRICS] Final Results:`);
    console.log(`  - Date Mode: ${dateMode}`);
    console.log(`  - Days Returned: ${rows.length}`);
    console.log(`  - Total Booked Sales: CHF ${totalBookedSales.toFixed(2)} (${totalBookedOrders} orders)`);
    console.log(`  - Total Locked Sales: CHF ${totalLockedSales.toFixed(2)} (${totalLockedOrders} orders)`);
    console.log(`  - Total Locked Margin: CHF ${totalLockedMargin.toFixed(2)} (${overallLockedMarginPct.toFixed(1)}%)`);
    console.log(`  - Total Ads Spend: CHF ${totalAdsSpend.toFixed(2)}`);
    console.log(`  - Net After Ads: CHF ${totalNetAfterAds.toFixed(2)}`);
    console.log(`  - Coverage: ${overallCoveragePct.toFixed(1)}%`);
    console.log(`  - Uncovered Sales: CHF ${totalUncoveredSales.toFixed(2)}`);
    
    // ⚠️ VALIDATION: Coverage should NEVER exceed 100% in BOOKED mode
    if (dateMode === "booked" && overallCoveragePct > 100) {
      console.error(`[METRICS] ⚠️ WARNING: Coverage is ${overallCoveragePct.toFixed(1)}% > 100% in BOOKED mode!`);
      console.error(`  This indicates a bug in the aggregation logic. Please investigate.`);
    }
    
    return NextResponse.json({
      success: true,
      rows,
      totals: {
        bookedSalesChf: Number(totalBookedSales.toFixed(2)),
        lockedSalesChf: Number(totalLockedSales.toFixed(2)),
        lockedMarginChf: Number(totalLockedMargin.toFixed(2)),
        lockedMarginPct: Number(overallLockedMarginPct.toFixed(2)),
        adsSpendChf: Number(totalAdsSpend.toFixed(2)),
        netAfterAdsChf: Number(totalNetAfterAds.toFixed(2)),
        coveragePct: Number(overallCoveragePct.toFixed(1)),
        uncoveredSalesChf: Number(totalUncoveredSales.toFixed(2)),
        bookedOrderCount: totalBookedOrders,
        lockedOrderCount: totalLockedOrders,
      },
      metadata: {
        dateMode,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        range,
        shopifyOrdersCount: shopifyOrders.length,
        orderMatchesCount: orderMatches.length,
        missingPurchaseDateCount: dateMode === "locked" ? missingPurchaseDateCount : undefined,
      },
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[METRICS/DAILY] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch daily metrics", details: error.message },
      { status: 500 }
    );
  }
}

