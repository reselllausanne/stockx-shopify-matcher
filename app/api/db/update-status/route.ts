import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

/**
 * PATCH /api/db/update-status
 * 
 * Updates the StockX status of an order match.
 * Used by the status monitoring worker.
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { shopifyLineItemId, stockxStatus, stockxEstimatedDelivery } = body;

    if (!shopifyLineItemId || !stockxStatus) {
      return NextResponse.json(
        { error: "Missing required fields: shopifyLineItemId, stockxStatus" },
        { status: 400 }
      );
    }

    console.log(`[DB] Updating status for line item: ${shopifyLineItemId} → ${stockxStatus}`);

    const match = await prisma.orderMatch.update({
      where: { shopifyLineItemId },
      data: {
        stockxStatus,
        stockxEstimatedDelivery: stockxEstimatedDelivery || null,
        lastStatusCheck: new Date(),
        updatedAt: new Date(),
      },
    });

    console.log(`[DB] Status updated for match: ${match.id}`);

    return NextResponse.json({ success: true, match }, { status: 200 });
  } catch (error: any) {
    console.error("[DB] Error updating status:", error);
    return NextResponse.json(
      { error: "Failed to update status", details: error.message },
      { status: 500 }
    );
  }
}


