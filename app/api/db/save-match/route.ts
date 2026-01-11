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
      stockxChainId,
      stockxOrderId,
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
      stockxPurchaseDate,
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
      supplierSource, // NEW: STOCKX | MANUAL | OTHER
      supplierPurchaseDate, // NEW: Alias for stockxPurchaseDate
      supplierOrderRef, // NEW: Manual supplier reference (friend, local, etc.)
      estimatedDeliveryDate, // NEW: ETA for manual suppliers
      stockxAwb, // NEW: Air Waybill / tracking number (extracted from trackingUrl)
      stockxTrackingUrl, // NEW: Full tracking URL from shipping.shipment
    } = body;
    
    // 🔍 DEBUG: Log received chainId/orderId
    if (stockxOrderNumber) {
      console.log(`[SAVE-MATCH] Received for ${stockxOrderNumber}:`, {
        chainId: stockxChainId,
        orderId: stockxOrderId,
        hasChainId: !!stockxChainId,
        hasOrderId: !!stockxOrderId
      });
    }

    // Validation
    if (!shopifyLineItemId) {
      return NextResponse.json(
        { error: "Missing required field: shopifyLineItemId" },
        { status: 400 }
      );
    }

    // Determine supplier source
    const finalSupplierSource = supplierSource || (stockxOrderNumber ? "STOCKX" : "MANUAL");
    const isManualSupplier = finalSupplierSource === "MANUAL" || finalSupplierSource === "OTHER";
    
    // Manual suppliers don't need StockX order number
    const isManualCostEntry = matchType === "MANUAL_COST" || (!stockxOrderNumber && manualCostOverride);
    
    if (!isManualCostEntry && !isManualSupplier && !stockxOrderNumber) {
      return NextResponse.json(
        { error: "Missing required field: stockxOrderNumber (unless manual supplier)" },
        { status: 400 }
      );
    }

    console.log(`[DB] Upserting match: ${shopifyOrderName} → ${stockxOrderNumber || supplierOrderRef || "MANUAL"} [Source: ${finalSupplierSource}]`);

    // Determine final values based on supplier source
    const finalStockxOrderNumber = stockxOrderNumber || supplierOrderRef || `MANUAL-${shopifyLineItemId.slice(-8)}`;
    const finalStockxProductName = stockxProductName || shopifyProductTitle;
    const finalStockxStatus = stockxStatus || (isManualSupplier ? "MANUAL_SUPPLIER" : "MANUAL_COST_ONLY");
    const finalMatchType = isManualCostEntry ? "MANUAL_COST" : matchType;
    const finalPurchaseDate = supplierPurchaseDate || stockxPurchaseDate;
    const finalEstimatedDelivery = estimatedDeliveryDate || stockxEstimatedDelivery;

    // Upsert (create or update)
    const match = await prisma.orderMatch.upsert({
      where: { shopifyLineItemId },
      update: {
        supplierSource: finalSupplierSource,
        stockxOrderNumber: finalStockxOrderNumber,
        stockxChainId: stockxChainId || undefined, // Preserve if not provided
        stockxOrderId: stockxOrderId || undefined, // Preserve if not provided
        stockxProductName: finalStockxProductName,
        stockxSizeEU,
        stockxSkuKey,
        stockxPurchaseDate: finalPurchaseDate ? new Date(finalPurchaseDate) : undefined,
        matchConfidence,
        matchScore,
        matchType: finalMatchType,
        matchReasons: JSON.stringify(matchReasons || []),
        timeDiffHours,
        stockxStatus: finalStockxStatus,
        stockxAwb: stockxAwb || undefined, // Preserve if not provided
        stockxTrackingUrl: stockxTrackingUrl || undefined, // Preserve if not provided
        stockxEstimatedDelivery: finalEstimatedDelivery,
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
        supplierSource: finalSupplierSource,
        stockxChainId: stockxChainId || null,
        stockxOrderNumber: finalStockxOrderNumber,
        stockxOrderId: stockxOrderId || null,
        stockxProductName: finalStockxProductName,
        stockxSizeEU: stockxSizeEU || null,
        stockxSkuKey: stockxSkuKey || null,
        stockxPurchaseDate: finalPurchaseDate ? new Date(finalPurchaseDate) : null,
        matchConfidence: matchConfidence ?? (isManualSupplier ? "HIGH" : "MEDIUM"),
        matchScore: matchScore ?? (isManualSupplier ? 1.0 : 0.0),
        matchType: finalMatchType || "MANUAL",
        matchReasons: JSON.stringify(matchReasons || []),
        timeDiffHours: timeDiffHours ?? null,
        stockxStatus: finalStockxStatus,
        stockxAwb: stockxAwb || null,
        stockxTrackingUrl: stockxTrackingUrl || null,
        stockxEstimatedDelivery: finalEstimatedDelivery || null,
        supplierCost: supplierCost ?? 0,
        marginAmount: marginAmount ?? 0,
        marginPercent: marginPercent ?? 0,
        manualCostOverride: manualCostOverride || null,
        shopifyMetafieldsSynced: shopifyMetafieldsSynced || false,
        shopifyMetafieldsSetAt: shopifyMetafieldsSynced ? new Date() : null,
        lastStatusCheck: new Date(),
      },
    });

    console.log(`[DB] Match saved: ${match.id}`);
    
    // 🔍 VALIDATION: Verify chainId/orderId were persisted
    if (stockxOrderNumber && (stockxChainId || stockxOrderId)) {
      console.log(`[DB] ✅ Verification - chainId/orderId persisted:`, {
        stockxChainId: match.stockxChainId,
        stockxOrderId: match.stockxOrderId,
        stockxOrderNumber: match.stockxOrderNumber
      });
      
      if (!match.stockxChainId && stockxChainId) {
        console.error(`[DB] ❌ WARNING: chainId was sent but not persisted!`, {
          sent: stockxChainId,
          persisted: match.stockxChainId
        });
      }
      if (!match.stockxOrderId && stockxOrderId) {
        console.error(`[DB] ❌ WARNING: orderId was sent but not persisted!`, {
          sent: stockxOrderId,
          persisted: match.stockxOrderId
        });
      }
    }

    // Auto-set Shopify metafields for the match (namespace: "supplier")
    try {
      console.log(`[DB] 📤 Auto-setting Shopify metafields for ${shopifyOrderName}...`);
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
      const setRes = await fetch(`${baseUrl}/api/shopify/set-metafields`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId,
          stockxOrderNumber: finalStockxOrderNumber,
          estimatedDelivery: finalEstimatedDelivery || null,
          stockxStatus: finalStockxStatus,
          supplierCost: String(supplierCost || 0),
          marginAmount: String(marginAmount || 0),
          marginPercent: String(marginPercent || 0),
          trackingNumber: stockxAwb || null, // ✅ Pass AWB to metafields
          stockxChainId: stockxChainId || null,
          stockxOrderId: stockxOrderId || null,
        }),
      });

      if (setRes.ok) {
        // Update shopifyMetafieldsSynced in DB
        await prisma.orderMatch.update({
          where: { id: match.id },
          data: {
            shopifyMetafieldsSynced: true,
            shopifyMetafieldsSetAt: new Date(),
          },
        });
        console.log(`[DB] ✅ Metafields auto-set successfully`);
      } else {
        const errorData = await setRes.json().catch(() => ({}));
        console.error(`[DB] ⚠️ Failed to set metafields (${setRes.status}):`, errorData);
      }
    } catch (error) {
      console.error(`[DB] ⚠️ Exception setting metafields (non-blocking):`, error);
      // Don't fail the whole save if metafield setting fails
    }

    return NextResponse.json({ success: true, match }, { status: 200 });
  } catch (error: any) {
    console.error("[DB] Error saving match:", error);
    return NextResponse.json(
      { error: "Failed to save match", details: error.message },
      { status: 500 }
    );
  }
}


