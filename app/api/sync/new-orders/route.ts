import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { matchShopifyToSupplier, NormalizedSupplierOrder, EXCLUDED_SKUS } from "@/app/utils/matching";

const toNumber = (value: any): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  if (value && typeof value === "object" && typeof (value as any).toNumber === "function") {
    return (value as any).toNumber();
  }
  return 0;
};

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
    const { supplierToken } = await req.json();

    if (!supplierToken) {
      return NextResponse.json(
        { error: "Missing supplierToken in request body" },
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
        token: supplierToken,
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
    const stockxOrders: NormalizedSupplierOrder[] = stockxEdges.map((edge: any) => {
      const node = edge.node;
      
      // 🔧 IMPROVED SIZE EXTRACTION: Handle both sneakers (EU) and apparel (ASIA/US)
      // Priority:
      // 1. EU displayOption (for sneakers)
      // 2. traits.size (for apparel like "L", "XL")
      // 3. localizedSizeTitle
      // 4. baseSize (fallback)
      const displayOptions = node.productVariant?.sizeChart?.displayOptions ?? [];
      const euOption = displayOptions.find((opt: any) => opt.type === "eu");
      const traitsSize = node.productVariant?.traits?.size;
      const baseSize = node.productVariant?.sizeChart?.baseSize;
      const baseType = node.productVariant?.sizeChart?.baseType?.toLowerCase();
      
      let size: string | null = null;
      
      if (euOption?.size) {
        // Sneakers: Use EU size
        size = euOption.size;
      } else if (traitsSize) {
        // Apparel: Use traits.size directly (e.g., "L", "XL")
        // This handles ASIA, US, and other letter sizing
        size = traitsSize;
      } else if (node.localizedSizeTitle) {
        size = node.localizedSizeTitle;
      } else if (baseSize) {
        // Fallback: build from baseType + baseSize, but normalize
        // For apparel: "ASIA L" → "L" (remove region prefix)
        if (baseType === "asia" || baseType === "us" || baseType === "uk") {
          // Apparel sizing: just use the size letter/number
          size = baseSize;
      } else {
          // Other: keep the prefix
          size = `${baseType?.toUpperCase() || ""} ${baseSize}`.trim();
        }
      }
      
      return {
        chainId: node.chainId || "",
        orderId: node.orderId || node.orderNumber || "",
        supplierOrderNumber: node.orderNumber || "",
        purchaseDate: node.purchaseDate || node.creationDate || "", // Fallback to creationDate
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

    console.log(`[SYNC] Fetched ${stockxOrders.length} Supplier orders`);
    
    // Debug: Show sample IDs (first order only, no PII)
    if (stockxOrders.length > 0) {
      const sample = stockxOrders[0];
      console.log(`[SUPPLIER-PRO] Sample node IDs: orderNumber=${sample.supplierOrderNumber}, chainId=${sample.chainId?.substring(0, 10)}..., orderId=${sample.orderId}`);
    }

    // 🔒 CRITICAL: Get already-matched Supplier orders to prevent duplicates
    const alreadyMatchedSupplier = await prisma.orderMatch.findMany({
      select: {
        stockxOrderNumber: true,
      },
    });
    const usedSupplierOrderNumbers = new Set(
      alreadyMatchedSupplier.map((m) => m.stockxOrderNumber)
    );
    console.log(`[SYNC] 🔒 Found ${usedSupplierOrderNumbers.size} already-matched Supplier orders (will exclude from matching)`);

    // Filter out already-used Supplier orders
    const availableSupplierOrders = stockxOrders.filter(
      (order) => !usedSupplierOrderNumbers.has(order.supplierOrderNumber)
    );
    console.log(`[SYNC] ✅ ${availableSupplierOrders.length} available Supplier orders (${stockxOrders.length - availableSupplierOrders.length} already matched)`);

    // 3. Match ALL Shopify items with AVAILABLE Supplier orders only
    console.log(`[SYNC] Matching ${shopifyItems.length} Shopify items with ${availableSupplierOrders.length} available Supplier orders...`);
    
    // Track suppliers matched in THIS run (for 1:1 enforcement within batch)
    const dynamicUsedSuppliers = new Set<string>(usedSupplierOrderNumbers);
    
    const results = [];
    let newMatchCount = 0;
    let updatedCount = 0;
    let autoSetCount = 0;
    let skippedCount = 0;

    for (const shopifyItem of shopifyItems) {
      console.log(`[SYNC] Processing: ${shopifyItem.orderName} - ${shopifyItem.title} (SKU: ${shopifyItem.sku || "N/A"})`);

      // 🔍 FIRST: Check if this Shopify item is already in DB
      const existingInDb = await prisma.orderMatch.findUnique({
        where: { shopifyLineItemId: shopifyItem.lineItemId },
      });

      if (existingInDb) {
        console.log(`[SYNC] ✓ Already in DB (skipping Essential Hoodie check)`);
      }

      // 🎯 AUTO-ADD: Essential Hoodies with 42 CHF cost (only if SKU is in EXCLUDED_SKUS)
      if (!existingInDb && shopifyItem.sku) {
        // ✅ SIMPLE: If SKU is in EXCLUDED_SKUS → auto-match with 42 CHF
        // Otherwise → ignore (let normal StockX matching happen)
        const isExcludedSku = EXCLUDED_SKUS.includes(shopifyItem.sku);
        
        console.log(`[SYNC] 🔍 Essential Hoodie check: SKU="${shopifyItem.sku}", In EXCLUDED_SKUS=${isExcludedSku}`);

        if (isExcludedSku) {
          const supplierCost = 42;
          const revenue = parseFloat(shopifyItem.totalPrice) || 0;
          const marginAmount = revenue - supplierCost;
          const marginPercent = revenue > 0 ? (marginAmount / revenue) * 100 : 0;

          console.log(`[SYNC] 👕 Essential Hoodie detected: ${shopifyItem.title} (SKU: ${shopifyItem.sku})`);
          console.log(`[SYNC] 💰 Auto-creating with 42 CHF cost (Revenue: ${revenue.toFixed(2)}, Margin: ${marginAmount.toFixed(2)} / ${marginPercent.toFixed(1)}%)`);

          await prisma.orderMatch.create({
            data: {
              stockxChainId: null, // Manual Essential Hoodie - no real StockX order
              stockxOrderId: null, // Manual Essential Hoodie - no real StockX order
              shopifyOrderId: shopifyItem.shopifyOrderId,
              shopifyOrderName: shopifyItem.orderName,
              shopifyLineItemId: shopifyItem.lineItemId,
              shopifyProductTitle: shopifyItem.title,
              shopifySku: shopifyItem.sku || null,
              shopifySizeEU: shopifyItem.sizeEU || null,
              shopifyTotalPrice: revenue,
              shopifyCurrencyCode: shopifyItem.currencyCode || "CHF",
              stockxOrderNumber: `MANUAL-ESS-${shopifyItem.lineItemId.slice(-8)}`,
              stockxProductName: shopifyItem.title,
              stockxSizeEU: shopifyItem.sizeEU || null,
              stockxSkuKey: shopifyItem.sku || null,
              stockxPurchaseDate: shopifyItem.createdAt ? new Date(shopifyItem.createdAt) : new Date(), // Use Shopify order date for manual matches
              matchConfidence: "manual",
              matchScore: 100,
              matchType: "MANUAL_COST",
              matchReasons: JSON.stringify(["Essential Hoodie (auto 42 CHF)"]),
              timeDiffHours: 0,
              stockxStatus: "MANUAL_COST_ONLY",
              stockxEstimatedDelivery: null,
              supplierCost,
              marginAmount,
              marginPercent,
              manualCostOverride: supplierCost,
              shopifyMetafieldsSynced: false,
              supplierSource: "MANUAL",
            },
          });

          console.log(`[SYNC] ✅ Essential Hoodie added to DB`);
          newMatchCount++;
          
          // Track this as used (for 1:1 enforcement)
          const manualRef = `MANUAL-ESS-${shopifyItem.lineItemId.slice(-8)}`;
          dynamicUsedSuppliers.add(manualRef);
          
          continue; // Skip matching algorithm
        }
      }

      if (existingInDb) {
        // ✅ Already matched in DB - update price if changed
        console.log(`[SYNC] 📋 Already matched in DB: ${shopifyItem.orderName} → ${existingInDb.stockxOrderNumber}`);
        
        const newShopifyPrice = parseFloat(shopifyItem.totalPrice) || 0;
        const oldShopifyPrice = toNumber(existingInDb.shopifyTotalPrice);
        const priceChanged = Math.abs(newShopifyPrice - oldShopifyPrice) > 0.01;

        if (priceChanged) {
          // 🔒 POC: Protect manual overrides from auto-sync
          if (existingInDb.manualCaseStatus || existingInDb.manualRevenueAdjustment) {
            console.log(`[SYNC] ⚠️ Manual override detected for ${shopifyItem.orderName} - skipping price update to preserve manual adjustments`);
            skippedCount++;
            continue;
          }
          
          // Recalculate margin with new price
          const supplierCost = toNumber(existingInDb.supplierCost) || 0;
          const newMarginAmount = newShopifyPrice - supplierCost;
          const newMarginPercent = newShopifyPrice > 0 ? (newMarginAmount / newShopifyPrice) * 100 : 0;

          console.log(`[SYNC] 💰 Price changed: CHF ${oldShopifyPrice.toFixed(2)} → CHF ${newShopifyPrice.toFixed(2)} (updating DB)`);
          console.log(`[SYNC] 📊 New margin: CHF ${newMarginAmount.toFixed(2)} (${newMarginPercent.toFixed(2)}%)`);

          await prisma.orderMatch.update({
            where: { id: existingInDb.id },
            data: {
              shopifyTotalPrice: newShopifyPrice,
              marginAmount: newMarginAmount,
              marginPercent: newMarginPercent,
              updatedAt: new Date(),
              // 🔒 NOTE: We explicitly do NOT touch manual fields here
            },
          });

          // Also update Shopify metafields with new margin
          try {
            await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/shopify/set-metafields`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                shopifyOrderId: shopifyItem.shopifyOrderId,
                stockxOrderNumber: existingInDb.stockxOrderNumber,
                estimatedDelivery: existingInDb.stockxEstimatedDelivery,
                stockxStatus: existingInDb.stockxStatus,
                stockxChainId: existingInDb.stockxChainId,
                stockxOrderId: existingInDb.stockxOrderId,
                supplierCost: supplierCost.toFixed(2),
                marginAmount: newMarginAmount.toFixed(2),
                marginPercent: newMarginPercent.toFixed(2),
              }),
            });
            console.log(`[SYNC] ✅ Updated Shopify metafields with new price`);
          } catch (err) {
            console.error(`[SYNC] ❌ Failed to update Shopify metafields:`, err);
          }

          updatedCount++;
        } else {
          console.log(`[SYNC] ✓ Price unchanged (CHF ${oldShopifyPrice.toFixed(2)}), skipping`);
          skippedCount++;
        }
        
        continue; // Skip matching algorithm for already-matched items
      }

      // Run matching algorithm (with 1:1 enforcement)
      console.log(`[SYNC] 🔍 Matching: ${shopifyItem.orderName} - ${shopifyItem.title} (Size: ${shopifyItem.sizeEU || shopifyItem.variantTitle || 'N/A'})`);
      const matchResult = matchShopifyToSupplier(shopifyItem, availableSupplierOrders, dynamicUsedSuppliers);

      if (!matchResult || !matchResult.bestMatch) {
        console.log(`[SYNC] ⏭️ No match found for ${shopifyItem.orderName} - ${shopifyItem.title} (skipping, not saving to DB)`);
        skippedCount++;
        continue; // Don't save to DB if no match
      }

      const bestMatch = matchResult.bestMatch;
      const supplierOrder = bestMatch.supplierOrder;
      const confidence = bestMatch.confidence;
      
      console.log(`[SYNC] ✅ Match found: ${shopifyItem.orderName} → ${supplierOrder.supplierOrderNumber} (${confidence.toUpperCase()}, score: ${bestMatch.score})`);

      // 🔒 ONLY process HIGH confidence matches in auto-sync
      if (confidence !== "high") {
        console.log(`[SYNC] ⏭️ Skipping ${confidence.toUpperCase()} confidence match (only HIGH auto-synced)`);
        skippedCount++;
        continue;
      }

      console.log(`[SYNC] 🚀 HIGH confidence - will auto-process (set metafields + save to DB)`);

      // Calculate financials
      const shopifyRevenue = parseFloat(shopifyItem.totalPrice) || 0;
      const supplierCost = supplierOrder.offerAmount || 0;
      const marginAmount = shopifyRevenue - supplierCost;
      const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;

      // 4. Check if match exists in DB
      const existingMatch = await prisma.orderMatch.findUnique({
        where: { shopifyLineItemId: shopifyItem.lineItemId },
      });

      if (existingMatch) {
        // Match exists in DB
        console.log(`[SYNC] 📋 Match exists in DB: ${shopifyItem.orderName} → ${supplierOrder.supplierOrderNumber} (synced: ${existingMatch.shopifyMetafieldsSynced})`);
        
        const statusChanged = existingMatch.stockxStatus !== supplierOrder.statusKey;
        const deliveryChanged = existingMatch.stockxEstimatedDelivery !== supplierOrder.estimatedDeliveryDate;
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
                stockxOrderNumber: supplierOrder.supplierOrderNumber,
                estimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
                stockxStatus: supplierOrder.statusKey || "UNKNOWN",
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
                  stockxStatus: supplierOrder.statusKey || "",
                  stockxEstimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
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
          console.log(`[SYNC] 🔄 Status changed: ${existingMatch.stockxStatus} → ${supplierOrder.statusKey}`);

          // Update DB
          await prisma.orderMatch.update({
            where: { shopifyLineItemId: shopifyItem.lineItemId },
            data: {
              stockxStatus: supplierOrder.statusKey || "",
              stockxEstimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
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
                stockxOrderNumber: supplierOrder.supplierOrderNumber,
                estimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
                stockxStatus: supplierOrder.statusKey || "UNKNOWN",
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
            stockxOrderNumber: supplierOrder.supplierOrderNumber,
            action: "updated",
            confidence,
          });
        } else {
          console.log(`[SYNC] ✅ Already synced, no changes: ${shopifyItem.orderName}`);
        }
      } else {
        // New match - create in DB
        console.log(`[SYNC] 🆕 NEW HIGH confidence match: ${shopifyItem.orderName} → ${supplierOrder.supplierOrderNumber}`);

        let metafieldsSynced = false;

        // 🚀 ALWAYS auto-set metafields for HIGH confidence matches
        try {
          console.log(`[SYNC] 📤 Auto-setting Shopify metafields...`);
          const setRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/shopify/set-metafields`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              shopifyOrderId: shopifyItem.shopifyOrderId,
              stockxOrderNumber: supplierOrder.supplierOrderNumber,
              estimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
              stockxStatus: supplierOrder.statusKey || "UNKNOWN",
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
            stockxOrderNumber: supplierOrder.supplierOrderNumber,
            stockxChainId: supplierOrder.chainId || null,
            stockxOrderId: supplierOrder.orderId || null,
            stockxProductName: supplierOrder.productName || supplierOrder.productTitle,
            stockxSizeEU: supplierOrder.sizeEU || null,
            stockxSkuKey: supplierOrder.skuKey || null,
            stockxPurchaseDate: supplierOrder.purchaseDate ? new Date(supplierOrder.purchaseDate) : null,
            matchConfidence: confidence,
            matchScore: bestMatch.score,
            matchType: "auto",
            matchReasons: JSON.stringify(bestMatch.reasons),
            timeDiffHours: bestMatch.timeDiffHours,
            stockxStatus: supplierOrder.statusKey || "",
            stockxEstimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
            supplierCost: supplierCost,
            marginAmount: marginAmount,
            marginPercent: marginPercent,
            shopifyMetafieldsSynced: metafieldsSynced,
            shopifyMetafieldsSetAt: metafieldsSynced ? new Date() : null,
          },
        });

        // RUNTIME VALIDATION: Verify chainId/orderId were persisted
        if (supplierOrder.chainId && !supplierOrder.chainId.startsWith("MANUAL")) {
          const verification = await prisma.orderMatch.findUnique({
            where: { shopifyLineItemId: shopifyItem.lineItemId },
            select: { 
              stockxOrderNumber: true, 
              stockxChainId: true, 
              stockxOrderId: true 
            }
          });
          
          if (verification && !verification.stockxChainId) {
            console.error(
              `[VALIDATION-ERROR] ❌ chainId NOT persisted!\n` +
              `  Expected: chainId=${supplierOrder.chainId}, orderId=${supplierOrder.orderId}\n` +
              `  Got: chainId=${verification.stockxChainId}, orderId=${verification.stockxOrderId}\n` +
              `  OrderNumber: ${verification.stockxOrderNumber}`
            );
          } else if (verification) {
            console.log(`[VALIDATION] ✅ IDs persisted: chainId=${verification.stockxChainId?.substring(0, 10)}..., orderId=${verification.stockxOrderId}`);
          }
        }

        // Track this supplier as used (for 1:1 enforcement in THIS batch)
        dynamicUsedSuppliers.add(supplierOrder.supplierOrderNumber);
        console.log(`[1:1] Marked ${supplierOrder.supplierOrderNumber} as used`);

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
          stockxOrderNumber: supplierOrder.supplierOrderNumber,
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
    console.log(`[SYNC]   - Total Supplier orders: ${stockxOrders.length}`);
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

