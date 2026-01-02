import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

/**
 * POST /api/db/save-match
 * 
 * Saves or updates a Shopify-StockX order match in the database.
 * If a match for this lineItemId already exists, it will be updated (upsert).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      shopifyOrderId,
      shopifyOrderName,
      shopifyLineItemId,
      shopifyProductTitle,
      shopifySku,
      shopifySizeEU,
      shopifyTotalPrice,
      shopifyCurrencyCode,
      stockxOrderNumber,
      stockxProductName,
      stockxSizeEU,
      stockxSkuKey,
      matchConfidence,
      matchScore,
      matchType,
      matchReasons,
      timeDiffHours,
      stockxStatus,
      stockxEstimatedDelivery,
      supplierCost,
      marginAmount,
      marginPercent,
      manualCostOverride,
      shopifyMetafieldsSynced,
    } = body;

    // Validation
    if (!shopifyLineItemId || !stockxOrderNumber) {
      return NextResponse.json(
        { error: "Missing required fields: shopifyLineItemId, stockxOrderNumber" },
        { status: 400 }
      );
    }

    console.log(`[DB] Upserting match: ${shopifyOrderName} → ${stockxOrderNumber}`);

    // Upsert (create or update)
    const match = await prisma.orderMatch.upsert({
      where: { shopifyLineItemId },
      update: {
        stockxOrderNumber,
        stockxProductName,
        stockxSizeEU,
        stockxSkuKey,
        matchConfidence,
        matchScore,
        matchType,
        matchReasons: JSON.stringify(matchReasons || []),
        timeDiffHours,
        stockxStatus,
        stockxEstimatedDelivery,
        supplierCost,
        marginAmount,
        marginPercent,
        manualCostOverride,
        shopifyMetafieldsSynced: shopifyMetafieldsSynced || false,
        shopifyMetafieldsSetAt: shopifyMetafieldsSynced ? new Date() : null,
        lastStatusCheck: new Date(),
        updatedAt: new Date(),
      },
      create: {
        shopifyOrderId,
        shopifyOrderName,
        shopifyLineItemId,
        shopifyProductTitle,
        shopifySku: shopifySku || null,
        shopifySizeEU: shopifySizeEU || null,
        shopifyTotalPrice,
        shopifyCurrencyCode: shopifyCurrencyCode || "CHF",
        stockxOrderNumber,
        stockxProductName,
        stockxSizeEU: stockxSizeEU || null,
        stockxSkuKey: stockxSkuKey || null,
        matchConfidence,
        matchScore,
        matchType,
        matchReasons: JSON.stringify(matchReasons || []),
        timeDiffHours,
        stockxStatus,
        stockxEstimatedDelivery: stockxEstimatedDelivery || null,
        supplierCost,
        marginAmount,
        marginPercent,
        manualCostOverride: manualCostOverride || null,
        shopifyMetafieldsSynced: shopifyMetafieldsSynced || false,
        shopifyMetafieldsSetAt: shopifyMetafieldsSynced ? new Date() : null,
        lastStatusCheck: new Date(),
      },
    });

    console.log(`[DB] Match saved: ${match.id}`);

    return NextResponse.json({ success: true, match }, { status: 200 });
  } catch (error: any) {
    console.error("[DB] Error saving match:", error);
    return NextResponse.json(
      { error: "Failed to save match", details: error.message },
      { status: 500 }
    );
  }
}


