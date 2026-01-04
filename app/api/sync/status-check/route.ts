import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

/**
 * POST /api/sync/status-check
 * 
 * Status monitoring worker:
 * 1. Fetches all matched orders from DB
 * 2. For each, fetches current StockX status
 * 3. If status changed → updates Shopify metafields + DB
 * 4. Respects rate limits (2 calls/sec max)
 * 
 * This endpoint should be called by a cron job every 30-60 minutes.
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

    console.log("[STATUS] Starting status check...");

    // 1. Fetch all matched orders from DB that are synced to Shopify
    const matches = await prisma.orderMatch.findMany({
      where: { shopifyMetafieldsSynced: true },
      orderBy: { lastStatusCheck: "asc" }, // Check oldest first
    });

    console.log(`[STATUS] Found ${matches.length} synced matches to check`);

    if (matches.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No synced matches to check",
        updatedCount: 0,
      });
    }

    const updates = [];
    let updatedCount = 0;

    // 2. Check each match (with rate limiting)
    for (const match of matches) {
      console.log(`[STATUS] Checking ${match.stockxOrderNumber}...`);

      try {
        // Fetch current StockX order status
        const stockxRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/stockx`, {
          method: "POST",
          headers: { 
            "content-type": "application/json",
          },
          body: JSON.stringify({
            token: stockxToken,
            operationName: "BuyingStatusCheck",
            query: `
              query BuyingStatusCheck(
                $first: Int
                $query: String
                $currencyCode: CurrencyCode
              ) {
                viewer {
                  buying(
                    first: $first
                    query: $query
                    currencyCode: $currencyCode
                  ) {
                    edges {
                      node {
                        orderNumber
                        state {
                          statusKey
                          statusTitle
                        }
                        estimatedDeliveryDateRange {
                          estimatedDeliveryDate
                        }
                      }
                    }
                  }
                }
              }
            `,
            variables: {
              first: 1,
              query: match.stockxOrderNumber,
              currencyCode: match.shopifyCurrencyCode || "CHF",
            },
          }),
        });

        if (!stockxRes.ok) {
          console.error(`[STATUS] StockX API failed for ${match.stockxOrderNumber}: ${stockxRes.status}`);
          continue;
        }

        const stockxData = await stockxRes.json();
        let node = stockxData?.data?.viewer?.buying?.edges?.[0]?.node;

        // HISTORICAL FALLBACK: If not found in PENDING, try HISTORICAL state
        if (!node) {
          console.log(`[STATUS] Order ${match.stockxOrderNumber} not found in PENDING, checking HISTORICAL...`);
          
          const historicalRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/stockx`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              token: stockxToken,
              operationName: "BuyingHistoricalCheck",
              query: `
                query BuyingHistoricalCheck(
                  $first: Int
                  $query: String
                  $currencyCode: CurrencyCode
                  $state: BuyingGeneralState
                ) {
                  viewer {
                    buying(
                      first: $first
                      query: $query
                      currencyCode: $currencyCode
                      state: $state
                    ) {
                      edges {
                        node {
                          orderNumber
                          state {
                            statusKey
                            statusTitle
                          }
                          estimatedDeliveryDateRange {
                            estimatedDeliveryDate
                          }
                        }
                      }
                    }
                  }
                }
              `,
              variables: {
                first: 1,
                query: match.stockxOrderNumber,
                currencyCode: match.shopifyCurrencyCode || "CHF",
                state: "HISTORICAL",
              },
            }),
          });

          if (historicalRes.ok) {
            const historicalData = await historicalRes.json();
            node = historicalData?.data?.viewer?.buying?.edges?.[0]?.node;
            
            if (node) {
              console.log(`[STATUS] ✅ Found ${match.stockxOrderNumber} in HISTORICAL state`);
            }
          }

          // Rate limit after additional check
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (!node) {
          // Order not found in PENDING or HISTORICAL
          const currentMissingCount = match.stockxMissingCount + 1;
          console.log(`[STATUS] ⚠️ Order ${match.stockxOrderNumber} not found (missing count: ${currentMissingCount}/3)`);
          
          // Update missing count
          await prisma.orderMatch.update({
            where: { id: match.id },
            data: {
              stockxMissingCount: currentMissingCount,
              lastStatusCheck: new Date(),
            },
          });
          
          // Only alert after 3 consecutive misses
          if (currentMissingCount >= 3) {
            console.error(`[STATUS] 🚨 Order ${match.stockxOrderNumber} missing for 3+ checks - may be cancelled/refunded`);
          }
          
          continue;
        }

        // Order found - reset missing count and update lastSeenAt
        const currentStatus = node.state?.statusKey || "";
        const currentEstimatedDelivery = node.estimatedDeliveryDateRange?.estimatedDeliveryDate || null;
        
        // Update tracking fields
        await prisma.orderMatch.update({
          where: { id: match.id },
          data: {
            stockxLastSeenAt: new Date(),
            stockxMissingCount: 0, // Reset counter
            lastStatusCheck: new Date(),
          },
        });

        // 3. Check if status changed
        if (currentStatus !== match.stockxStatus || currentEstimatedDelivery !== match.stockxEstimatedDelivery) {
          console.log(`[STATUS] Status changed for ${match.stockxOrderNumber}: ${match.stockxStatus} → ${currentStatus}`);

          // Update Shopify metafields
          try {
            const setMetafieldsRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/shopify/set-metafields`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                shopifyOrderId: match.shopifyOrderId,
                stockxOrderNumber: match.stockxOrderNumber,
                estimatedDelivery: currentEstimatedDelivery,
                stockxStatus: currentStatus,
                supplierCost: match.supplierCost.toFixed(2),
                marginAmount: match.marginAmount.toFixed(2),
                marginPercent: match.marginPercent.toFixed(2),
              }),
            });

            if (setMetafieldsRes.ok) {
              console.log(`[STATUS] ✅ Updated Shopify metafields for ${match.shopifyOrderName}`);
            } else {
              console.error(`[STATUS] ❌ Failed to update Shopify metafields for ${match.shopifyOrderName}`);
            }
          } catch (error) {
            console.error(`[STATUS] Error updating Shopify metafields:`, error);
          }

          // Update DB
          try {
            const updateRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/db/update-status`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                shopifyLineItemId: match.shopifyLineItemId,
                stockxStatus: currentStatus,
                stockxEstimatedDelivery: currentEstimatedDelivery,
              }),
            });

            if (updateRes.ok) {
              console.log(`[STATUS] ✅ Updated DB for ${match.shopifyOrderName}`);
              updatedCount++;
              updates.push({
                shopifyOrderName: match.shopifyOrderName,
                stockxOrderNumber: match.stockxOrderNumber,
                oldStatus: match.stockxStatus,
                newStatus: currentStatus,
              });
            } else {
              console.error(`[STATUS] ❌ Failed to update DB for ${match.shopifyOrderName}`);
            }
          } catch (error) {
            console.error(`[STATUS] Error updating DB:`, error);
          }
        } else {
          console.log(`[STATUS] No change for ${match.stockxOrderNumber}`);
          
          // Still update lastStatusCheck
          await prisma.orderMatch.update({
            where: { id: match.id },
            data: { lastStatusCheck: new Date() },
          });
        }
      } catch (error) {
        console.error(`[STATUS] Error checking ${match.stockxOrderNumber}:`, error);
      }

      // Rate limit: 500ms delay between checks (2 calls/sec)
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`[STATUS] ✅ Status check complete: ${updatedCount} updates`);

    return NextResponse.json({
      success: true,
      message: `Checked ${matches.length} orders, ${updatedCount} updates`,
      checkedCount: matches.length,
      updatedCount,
      updates,
    });
  } catch (error: any) {
    console.error("[STATUS] Error in status-check:", error);
    return NextResponse.json(
      { error: "Status check failed", details: error.message },
      { status: 500 }
    );
  }
}

