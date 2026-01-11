import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30");

    // Get DB data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const dbMatches = await prisma.orderMatch.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        // Include ALL matches: synced metafields OR manual cost entries
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        stockxOrderNumber: true,
        shopifyTotalPrice: true,
        supplierCost: true,
        marginAmount: true,
        marginPercent: true,
        stockxStatus: true,
        shopifyCurrencyCode: true,
        createdAt: true,
        matchType: true, // Include matchType to identify manual entries
        manualCostOverride: true, // Include manual cost info
        shopifyMetafieldsSynced: true, // Include sync status
      },
    });

    // Get Shopify data with metafields
    const shopifyAccessToken = process.env.ACCESS_TOKEN_SHOPIFY;
    const shopifyShopDomain = process.env.SHOP_NAME_SHOPIFY;
    const shopifyApiVersion = process.env.API_VERSION_SHOPIFY || "2024-10";

    if (!shopifyAccessToken || !shopifyShopDomain) {
      return NextResponse.json(
        { error: "Shopify credentials not configured" },
        { status: 500 }
      );
    }

    const ordersQuery = `
      query getOrders($first: Int!, $namespace: String!) {
        orders(first: $first, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              stockxOrderNumber: metafield(namespace: $namespace, key: "order_number") {
                value
              }
              status: metafield(namespace: $namespace, key: "status") {
                value
              }
              supplierCost: metafield(namespace: $namespace, key: "total_cost") {
                value
              }
              marginAmount: metafield(namespace: $namespace, key: "margin_amount") {
                value
              }
              marginPercent: metafield(namespace: $namespace, key: "margin_percent") {
                value
              }
            }
          }
        }
      }
    `;

    const shopifyRes = await fetch(
      `https://${shopifyShopDomain}/admin/api/${shopifyApiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyAccessToken,
        },
        body: JSON.stringify({
          query: ordersQuery,
          variables: { first: 50, namespace: "supplier" },
        }),
      }
    );

    const shopifyData = await shopifyRes.json();
    const shopifyOrders = shopifyData?.data?.orders?.edges || [];

    // Build comparison
    const comparison = [];
    
    for (const edge of shopifyOrders) {
      const order = edge.node;
      const orderId = order.id;
      
      // Extract metafield values directly
      const stockxOrderNumber = order.stockxOrderNumber?.value || null;
      const status = order.status?.value || null;
      const supplierCost = order.supplierCost?.value ? parseFloat(order.supplierCost.value) : null;
      const marginAmount = order.marginAmount?.value ? parseFloat(order.marginAmount.value) : null;
      const marginPercent = order.marginPercent?.value ? parseFloat(order.marginPercent.value) : null;

      // Find DB match
      const dbMatch = dbMatches.find((m) => m.shopifyOrderId === orderId);

      // Get Shopify sale price (current price after discounts)
      const shopifySalePrice = order.currentTotalPriceSet?.shopMoney?.amount 
        ? parseFloat(order.currentTotalPriceSet.shopMoney.amount) 
        : null;

      // Only include orders that have metafields OR DB match
      if (dbMatch || stockxOrderNumber) {
        const isManualCost = dbMatch?.matchType === "MANUAL_COST";
        const matchStatus = !dbMatch 
          ? "metafields_only" 
          : isManualCost 
          ? "manual_cost" 
          : dbMatch.shopifyMetafieldsSynced 
          ? "synced" 
          : "db_only";

        comparison.push({
          orderId,
          orderName: order.name,
          createdAt: order.createdAt,
          shopifySalePrice, // Add sale price
          currency: order.currentTotalPriceSet?.shopMoney?.currencyCode || dbMatch?.shopifyCurrencyCode || "CHF",
          shopify: {
            stockxOrderNumber,
            status,
            supplierCost,
            marginAmount,
            marginPercent,
          },
          db: dbMatch
            ? {
                salePrice: dbMatch.shopifyTotalPrice, // Add DB sale price for comparison
                stockxOrderNumber: dbMatch.stockxOrderNumber,
                status: dbMatch.stockxStatus,
                supplierCost: dbMatch.supplierCost,
                marginAmount: dbMatch.marginAmount,
                marginPercent: dbMatch.marginPercent,
                matchType: dbMatch.matchType, // Show if manual
                manualCostOverride: dbMatch.manualCostOverride, // Show manual cost
              }
            : null,
          match: matchStatus,
        });
      }
    }

    // Add DB-only matches that aren't in Shopify's recent orders
    const shopifyOrderIds = new Set(shopifyOrders.map(e => e.node.id));
    for (const dbMatch of dbMatches) {
      if (!shopifyOrderIds.has(dbMatch.shopifyOrderId)) {
        comparison.push({
          orderId: dbMatch.shopifyOrderId,
          orderName: dbMatch.shopifyOrderName,
          createdAt: dbMatch.createdAt,
          shopifySalePrice: dbMatch.shopifyTotalPrice,
          currency: dbMatch.shopifyCurrencyCode,
          shopify: {
            stockxOrderNumber: null,
            status: null,
            supplierCost: null,
            marginAmount: null,
            marginPercent: null,
          },
          db: {
            salePrice: dbMatch.shopifyTotalPrice,
            stockxOrderNumber: dbMatch.stockxOrderNumber,
            status: dbMatch.stockxStatus,
            supplierCost: dbMatch.supplierCost,
            marginAmount: dbMatch.marginAmount,
            marginPercent: dbMatch.marginPercent,
            matchType: dbMatch.matchType,
            manualCostOverride: dbMatch.manualCostOverride,
          },
          match: dbMatch.matchType === "MANUAL_COST" ? "manual_cost" : "db_only",
        });
      }
    }

    return NextResponse.json({
      comparison,
      summary: {
        total: comparison.length,
        synced: comparison.filter((c) => c.match === "synced").length,
        metafieldsOnly: comparison.filter((c) => c.match === "metafields_only").length,
        manualCost: comparison.filter((c) => c.match === "manual_cost").length,
        dbOnly: comparison.filter((c) => c.match === "db_only").length,
      },
    });
  } catch (error: any) {
    console.error("[SHOPIFY COMPARISON] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch comparison data", details: error.message },
      { status: 500 }
    );
  }
}

