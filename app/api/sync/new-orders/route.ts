import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { matchShopifyToStockX, NormalizedStockXOrder } from "@/app/utils/matching";

/**
 * POST /api/sync/new-orders
 * 
 * Improved auto-sync worker:
 * 1. Fetches ALL StockX orders (with pricing)
 * 2. Fetches ALL Shopify orders
 * 3. Matches them using existing algorithm
 * 4. For each match:
 *    - Check if exists in DB
 *    - If exists: Update if status changed
 *    - If new: Create DB entry + set metafields (if HIGH confidence)
 * 
 * This endpoint should be called by a cron job every 5-10 minutes.
 */
export async function POST(req: Request) {
  try {
    const { stockxToken } = await req.json();

    if (!stockxToken) {
      return NextResponse.json(
        { error: "Missing stockxToken in request body" },
        { status: 400 }
      );
    }

    console.log("[SYNC] Starting smart sync...");

    // 1. Fetch Shopify orders
    const shopifyRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/shopify/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sinceDays: 30 }),
    });

    if (!shopifyRes.ok) {
      throw new Error(`Shopify API failed: ${shopifyRes.status}`);
    }

    const shopifyData = await shopifyRes.json();
    const shopifyItems = shopifyData.lineItems || [];

    console.log(`[SYNC] Found ${shopifyItems.length} Shopify line items`);

    // 2. Fetch StockX orders (reuse frontend GraphQL query)
    const stockxRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/stockx`, {
      method: "POST",
      headers: { 
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: stockxToken,
        operationName: "Buying",
        query: `query Buying(
          $first: Int
          $after: String
          $currencyCode: CurrencyCode
          $state: BuyingGeneralState
          $sort: BuyingSortInput
          $order: AscDescOrderInput
        ) {
          viewer {
            buying(
              currencyCode: $currencyCode
              first: $first
              after: $after
              state: $state
              sort: $sort
              order: $order
            ) {
              edges {
                node {
                  chainId
                  orderId
                  orderNumber
                  amount
                  currencyCode
                  purchaseDate
                  creationDate
                  estimatedDeliveryDateRange {
                    estimatedDeliveryDate
                    latestEstimatedDeliveryDate
                  }
                  state {
                    statusKey
                    statusTitle
                  }
                  localizedSizeTitle
                  localizedSizeType
                  productVariant {
                    id
                    traits {
                      size
                      sizeDescriptor
                    }
                    sizeChart {
                      baseType
                      baseSize
                      displayOptions {
                        size
                        type
                      }
                    }
                    product {
                      id
                      name
                      title
                      model
                      styleId
                      primaryCategory
                      productCategory
                      contentGroup
                      media {
                        thumbUrl
                      }
                    }
                  }
                }
              }
              pageInfo {
                endCursor
                hasNextPage
                totalCount
              }
            }
          }
        }`,
        variables: {
          first: 100,
          after: "",
          currencyCode: "CHF",
          state: null,
          sort: "MATCHED_AT",
          order: "DESC",
        },
      }),
    });

    if (!stockxRes.ok) {
      throw new Error(`StockX API failed: ${stockxRes.status}`);
    }

    const stockxData = await stockxRes.json();
    const stockxEdges = stockxData?.data?.viewer?.buying?.edges || [];

    console.log(`[SYNC] Found ${stockxEdges.length} StockX orders`);

    // Normalize StockX orders (same as frontend)
    const stockxOrders: NormalizedStockXOrder[] = stockxEdges.map((edge: any) => {
      const node = edge.node;
      
      // Extract EU size (priority: displayOptions > localizedSizeTitle > baseSize)
      const displayOptions = node.productVariant?.sizeChart?.displayOptions ?? [];
      const euOption = displayOptions.find((opt: any) => opt.type === "eu");
      
      let size: string | null = null;
      if (euOption?.size) {
        size = euOption.size;
      } else if (node.localizedSizeTitle) {
        size = node.localizedSizeTitle;
      } else {
        const baseSize = node.productVariant?.sizeChart?.baseSize;
        const baseType = node.productVariant?.sizeChart?.baseType;
        size = baseSize ? `${baseType?.toUpperCase() || ""} ${baseSize}`.trim() : null;
      }
      
      return {
        stockxOrderNumber: node.orderNumber || "",
        purchaseDate: node.purchaseDate || "",
        offerAmount: node.amount || 0,
        totalTTC: null, // Will be fetched separately if needed
        currencyCode: node.currencyCode || "CHF",
        productTitle: node.productVariant?.product?.title || node.productVariant?.product?.name || "",
        productName: node.productVariant?.product?.name || "",
        skuKey: node.productVariant?.product?.styleId || node.productVariant?.product?.model || node.productVariant?.product?.id || "",
        sizeEU: size,
        statusKey: node.state?.statusKey || "",
        statusTitle: node.state?.statusTitle || "",
        estimatedDeliveryDate: node.estimatedDeliveryDateRange?.estimatedDeliveryDate || null,
        productVariantId: node.productVariant?.id || "",
      };
    });

    console.log(`[SYNC] Fetched ${stockxOrders.length} StockX orders`);

    // 🔒 CRITICAL: Get already-matched StockX orders to prevent duplicates
    const alreadyMatchedStockX = await prisma.orderMatch.findMany({
      select: {
        stockxOrderNumber: true,
      },
    });
    const usedStockXOrderNumbers = new Set(
      alreadyMatchedStockX.map((m) => m.stockxOrderNumber)
    );
    console.log(`[SYNC] 🔒 Found ${usedStockXOrderNumbers.size} already-matched StockX orders (will exclude from matching)`);

    // Filter out already-used StockX orders
    const availableStockXOrders = stockxOrders.filter(
      (order) => !usedStockXOrderNumbers.has(order.stockxOrderNumber)
    );
    console.log(`[SYNC] ✅ ${availableStockXOrders.length} available StockX orders (${stockxOrders.length - availableStockXOrders.length} already matched)`);

    // 3. Match ALL Shopify items with AVAILABLE StockX orders only
    console.log(`[SYNC] Matching ${shopifyItems.length} Shopify items with ${availableStockXOrders.length} available StockX orders...`);
    
    const results = [];
    let newMatchCount = 0;
    let updatedCount = 0;
    let autoSetCount = 0;
    let skippedCount = 0;

    for (const shopifyItem of shopifyItems) {
      console.log(`[SYNC] Processing: ${shopifyItem.orderName} - ${shopifyItem.title}`);

      // Run matching algorithm (only with AVAILABLE StockX orders)
      console.log(`[SYNC] 🔍 Matching: ${shopifyItem.orderName} - ${shopifyItem.title} (Size: ${shopifyItem.sizeEU || shopifyItem.variantTitle || 'N/A'})`);
      const matchResult = matchShopifyToStockX(shopifyItem, availableStockXOrders);

      if (!matchResult || !matchResult.bestMatch) {
        console.log(`[SYNC] ⏭️ No match found for ${shopifyItem.orderName} - ${shopifyItem.title} (skipping, not saving to DB)`);
        skippedCount++;
        continue; // Don't save to DB if no match
      }

      const bestMatch = matchResult.bestMatch;
      const stockxOrder = bestMatch.stockxOrder;
      const confidence = bestMatch.confidence;
      
      console.log(`[SYNC] ✅ Match found: ${shopifyItem.orderName} → ${stockxOrder.stockxOrderNumber} (${confidence.toUpperCase()}, score: ${bestMatch.score})`);

      // 🔒 ONLY process HIGH confidence matches in auto-sync
      if (confidence !== "high") {
        console.log(`[SYNC] ⏭️ Skipping ${confidence.toUpperCase()} confidence match (only HIGH auto-synced)`);
        skippedCount++;
        continue;
      }

      console.log(`[SYNC] 🚀 HIGH confidence - will auto-process (set metafields + save to DB)`);

      // Calculate financials
      const shopifyRevenue = parseFloat(shopifyItem.totalPrice) || 0;
      const supplierCost = stockxOrder.offerAmount || 0;
      const marginAmount = shopifyRevenue - supplierCost;
      const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;

      // 4. Check if match exists in DB
      const existingMatch = await prisma.orderMatch.findUnique({
        where: { shopifyLineItemId: shopifyItem.lineItemId },
      });

      if (existingMatch) {
        // Match exists in DB
        console.log(`[SYNC] 📋 Match exists in DB: ${shopifyItem.orderName} → ${stockxOrder.stockxOrderNumber} (synced: ${existingMatch.shopifyMetafieldsSynced})`);
        
        const statusChanged = existingMatch.stockxStatus !== stockxOrder.statusKey;
        const deliveryChanged = existingMatch.stockxEstimatedDelivery !== stockxOrder.estimatedDeliveryDate;
        const needsSync = !existingMatch.shopifyMetafieldsSynced;

        // 🚀 AUTO-SET METAFIELDS if not yet synced (even if no status change)
        if (needsSync) {
          console.log(`[SYNC] 🆕 Metafields not yet synced - auto-setting now...`);
          
          try {
            const setRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/shopify/set-metafields`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                shopifyOrderId: shopifyItem.shopifyOrderId,
                stockxOrderNumber: stockxOrder.stockxOrderNumber,
                estimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
                stockxStatus: stockxOrder.statusKey || "UNKNOWN",
                supplierCost: supplierCost.toFixed(2),
                marginAmount: marginAmount.toFixed(2),
                marginPercent: marginPercent.toFixed(2),
              }),
            });

            if (setRes.ok) {
              // Update DB to mark as synced
              await prisma.orderMatch.update({
                where: { shopifyLineItemId: shopifyItem.lineItemId },
                data: {
                  shopifyMetafieldsSynced: true,
                  shopifyMetafieldsSetAt: new Date(),
                  stockxStatus: stockxOrder.statusKey || "",
                  stockxEstimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
                  lastStatusCheck: new Date(),
                  updatedAt: new Date(),
                },
              });

              // 🚀 AUTO-SYNC TO DASHBOARD: Create/Update OrderMetric
              try {
                await prisma.orderMetric.upsert({
                  where: { shopifyOrderId: shopifyItem.shopifyOrderId },
                  update: {
                    grossSales: shopifyRevenue,
                    marginChf: marginAmount,
                    marginPct: marginPercent,
                    updatedAt: new Date(),
                  },
                  create: {
                    shopifyOrderId: shopifyItem.shopifyOrderId,
                    createdAt: new Date(shopifyItem.createdAt),
                    grossSales: shopifyRevenue,
                    marginChf: marginAmount,
                    marginPct: marginPercent,
                    currency: shopifyItem.currencyCode || "CHF",
                  },
                });
                console.log(`[SYNC] 📊 Auto-synced to dashboard: ${shopifyItem.orderName}`);
              } catch (metricError) {
                console.error(`[SYNC] ❌ Failed to sync to dashboard:`, metricError);
              }
              
              autoSetCount++;
              console.log(`[SYNC] ✅ Metafields auto-set for existing match: ${shopifyItem.orderName}`);
            } else {
              const errorData = await setRes.json().catch(() => ({}));
              console.error(`[SYNC] ❌ Failed to set metafields (${setRes.status}):`, errorData);
            }
          } catch (error) {
            console.error(`[SYNC] ❌ Exception setting metafields:`, error);
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
        } else if (statusChanged || deliveryChanged) {
          // Status/delivery changed - update both DB and Shopify
          console.log(`[SYNC] 🔄 Status changed: ${existingMatch.stockxStatus} → ${stockxOrder.statusKey}`);

          // Update DB
          await prisma.orderMatch.update({
            where: { shopifyLineItemId: shopifyItem.lineItemId },
            data: {
              stockxStatus: stockxOrder.statusKey || "",
              stockxEstimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
              lastStatusCheck: new Date(),
              updatedAt: new Date(),
            },
          });

          // Update Shopify metafields
          try {
            await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/shopify/set-metafields`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                shopifyOrderId: shopifyItem.shopifyOrderId,
                stockxOrderNumber: stockxOrder.stockxOrderNumber,
                estimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
                stockxStatus: stockxOrder.statusKey || "UNKNOWN",
                supplierCost: supplierCost.toFixed(2),
                marginAmount: marginAmount.toFixed(2),
                marginPercent: marginPercent.toFixed(2),
              }),
            });
            console.log(`[SYNC] ✅ Updated metafields for ${shopifyItem.orderName}`);
          } catch (error) {
            console.error(`[SYNC] ❌ Failed to update metafields:`, error);
          }

          updatedCount++;
          results.push({
            shopifyOrderName: shopifyItem.orderName,
            stockxOrderNumber: stockxOrder.stockxOrderNumber,
            action: "updated",
            confidence,
          });
        } else {
          console.log(`[SYNC] ✅ Already synced, no changes: ${shopifyItem.orderName}`);
          // Update lastStatusCheck
          await prisma.orderMatch.update({
            where: { shopifyLineItemId: shopifyItem.lineItemId },
            data: { lastStatusCheck: new Date() },
          });
        }
      } else {
        // New match - create in DB
        console.log(`[SYNC] 🆕 NEW HIGH confidence match: ${shopifyItem.orderName} → ${stockxOrder.stockxOrderNumber}`);

        let metafieldsSynced = false;

        // 🚀 ALWAYS auto-set metafields for HIGH confidence matches
        try {
          console.log(`[SYNC] 📤 Auto-setting Shopify metafields...`);
          const setRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/shopify/set-metafields`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              shopifyOrderId: shopifyItem.shopifyOrderId,
              stockxOrderNumber: stockxOrder.stockxOrderNumber,
              estimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
              stockxStatus: stockxOrder.statusKey || "UNKNOWN",
              supplierCost: supplierCost.toFixed(2),
              marginAmount: marginAmount.toFixed(2),
              marginPercent: marginPercent.toFixed(2),
            }),
          });

          if (setRes.ok) {
            metafieldsSynced = true;
            autoSetCount++;
            console.log(`[SYNC] ✅ Metafields auto-set successfully for ${shopifyItem.orderName}`);
          } else {
            const errorData = await setRes.json().catch(() => ({}));
            console.error(`[SYNC] ❌ Failed to set metafields (${setRes.status}):`, errorData);
          }
        } catch (error) {
          console.error(`[SYNC] ❌ Exception setting metafields:`, error);
        }

        // Rate limit between requests
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Save to DB
        await prisma.orderMatch.create({
          data: {
            shopifyOrderId: shopifyItem.shopifyOrderId,
            shopifyOrderName: shopifyItem.orderName,
            shopifyLineItemId: shopifyItem.lineItemId,
            shopifyProductTitle: shopifyItem.title,
            shopifySku: shopifyItem.sku || null,
            shopifySizeEU: shopifyItem.sizeEU || null,
            shopifyTotalPrice: shopifyRevenue,
            shopifyCurrencyCode: shopifyItem.currencyCode || "CHF",
            stockxOrderNumber: stockxOrder.stockxOrderNumber,
            stockxProductName: stockxOrder.productName || stockxOrder.productTitle,
            stockxSizeEU: stockxOrder.sizeEU || null,
            stockxSkuKey: stockxOrder.skuKey || null,
            matchConfidence: confidence,
            matchScore: bestMatch.score,
            matchType: "auto",
            matchReasons: JSON.stringify(bestMatch.reasons),
            timeDiffHours: bestMatch.timeDiffHours,
            stockxStatus: stockxOrder.statusKey || "",
            stockxEstimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
            supplierCost: supplierCost,
            marginAmount: marginAmount,
            marginPercent: marginPercent,
            shopifyMetafieldsSynced: metafieldsSynced,
            shopifyMetafieldsSetAt: metafieldsSynced ? new Date() : null,
          },
        });

        // 🚀 AUTO-SYNC TO DASHBOARD: Create OrderMetric for new matches
        try {
          await prisma.orderMetric.create({
            data: {
              shopifyOrderId: shopifyItem.shopifyOrderId,
              createdAt: new Date(shopifyItem.createdAt),
              grossSales: shopifyRevenue,
              marginChf: marginAmount,
              marginPct: marginPercent,
              currency: shopifyItem.currencyCode || "CHF",
            },
          });
          console.log(`[SYNC] 📊 Auto-synced to dashboard: ${shopifyItem.orderName} (new)`);
        } catch (metricError) {
          console.error(`[SYNC] ❌ Failed to sync to dashboard:`, metricError);
        }

        newMatchCount++;
        results.push({
          shopifyOrderName: shopifyItem.orderName,
          stockxOrderNumber: stockxOrder.stockxOrderNumber,
          action: "created",
          confidence,
          autoSet: metafieldsSynced,
        });
      }
    }

    console.log(`[SYNC] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[SYNC] ✅ SYNC COMPLETE`);
    console.log(`[SYNC] 📊 Results:`);
    console.log(`[SYNC]   - Total Shopify items: ${shopifyItems.length}`);
    console.log(`[SYNC]   - Total StockX orders: ${stockxOrders.length}`);
    console.log(`[SYNC]   - New matches: ${newMatchCount}`);
    console.log(`[SYNC]   - Updated: ${updatedCount}`);
    console.log(`[SYNC]   - Auto-set metafields: ${autoSetCount}`);
    console.log(`[SYNC]   - Skipped: ${skippedCount}`);
    console.log(`[SYNC] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    if (skippedCount === shopifyItems.length) {
      console.warn(`[SYNC] ⚠️ ALL orders skipped! Check logs above for reasons (no matches found or all MEDIUM/LOW confidence)`);
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${shopifyItems.length} orders: ${newMatchCount} new matches, ${updatedCount} updates, ${autoSetCount} auto-set`,
      newMatches: newMatchCount,
      updatedMatches: updatedCount,
      autoSetCount,
      skippedCount,
      results,
    });
  } catch (error: any) {
    console.error("[SYNC] Error in new-orders sync:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error.message },
      { status: 500 }
    );
  }
}

