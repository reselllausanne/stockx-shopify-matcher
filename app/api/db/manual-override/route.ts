// app/api/db/manual-override/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POC: Manual Override for Refunds/Returns
 * 
 * Updates manual fields without touching auto-sync data
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      matchId, 
      manualCaseStatus, 
      manualRevenueAdjustment, 
      manualNote 
    } = body;

    if (!matchId) {
      return NextResponse.json(
        { error: "matchId is required" },
        { status: 400 }
      );
    }

    // Validate case status
    const validStatuses = [null, "ACTIVE", "CLOSED_CREDIT", "RETURNED", "EXCHANGE_PENDING"];
    if (manualCaseStatus && !validStatuses.includes(manualCaseStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Get current match
    const existingMatch = await prisma.orderMatch.findUnique({
      where: { id: matchId },
    });

    if (!existingMatch) {
      return NextResponse.json(
        { error: "Match not found" },
        { status: 404 }
      );
    }

    console.log(
      `[MANUAL_OVERRIDE] Updating match ${existingMatch.shopifyOrderName} → ${existingMatch.stockxOrderNumber}`
    );
    console.log(`[MANUAL_OVERRIDE] Status: ${manualCaseStatus || "null"}`);
    console.log(`[MANUAL_OVERRIDE] Adjustment: CHF ${manualRevenueAdjustment || 0}`);

    // Update only manual fields
    const updated = await prisma.orderMatch.update({
      where: { id: matchId },
      data: {
        manualCaseStatus: manualCaseStatus || null,
        manualRevenueAdjustment: manualRevenueAdjustment || null,
        manualNote: manualNote || null,
        updatedAt: new Date(),
      },
    });

    // Calculate effective values for response
    const effectiveRevenue = updated.shopifyTotalPrice + (updated.manualRevenueAdjustment || 0);
    const effectiveMargin = effectiveRevenue - updated.supplierCost;
    const effectiveMarginPct = effectiveRevenue > 0 
      ? (effectiveMargin / effectiveRevenue) * 100 
      : 0;

    return NextResponse.json({
      success: true,
      match: {
        id: updated.id,
        shopifyOrderName: updated.shopifyOrderName,
        stockxOrderNumber: updated.stockxOrderNumber,
        originalRevenue: updated.shopifyTotalPrice,
        revenueAdjustment: updated.manualRevenueAdjustment,
        effectiveRevenue,
        supplierCost: updated.supplierCost,
        effectiveMargin,
        effectiveMarginPct,
        manualCaseStatus: updated.manualCaseStatus,
        manualNote: updated.manualNote,
      },
    });

  } catch (error: any) {
    console.error("[MANUAL_OVERRIDE] Error:", error);
    return NextResponse.json(
      { 
        error: "Failed to update manual override",
        details: error.message 
      },
      { status: 500 }
    );
  }
}

