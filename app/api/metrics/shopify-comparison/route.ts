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
        shopifyMetafieldsSynced: true,
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
        createdAt: true,
      },
    });

    // Get Shopify data with metafields
    const shopifyAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const shopifyShopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || "2024-10";

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
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              stockxOrderNumber: metafield(namespace: $namespace, key: "stockx_order_number") {
                value
              }
              status: metafield(namespace: $namespace, key: "stockx_status") {
                value
              }
              supplierCost: metafield(namespace: $namespace, key: "supplier_cost") {
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

      // Only include orders that have metafields OR DB match
      if (dbMatch || stockxOrderNumber) {
        comparison.push({
          orderId,
          orderName: order.name,
          createdAt: order.createdAt,
          shopify: {
            stockxOrderNumber,
            status,
            supplierCost,
            marginAmount,
            marginPercent,
          },
          db: dbMatch
            ? {
                stockxOrderNumber: dbMatch.stockxOrderNumber,
                status: dbMatch.stockxStatus,
                supplierCost: dbMatch.supplierCost,
                marginAmount: dbMatch.marginAmount,
                marginPercent: dbMatch.marginPercent,
              }
            : null,
          match: dbMatch ? "synced" : "metafields_only",
        });
      }
    }

    return NextResponse.json({
      comparison,
      summary: {
        total: comparison.length,
        synced: comparison.filter((c) => c.match === "synced").length,
        metafieldsOnly: comparison.filter((c) => c.match === "metafields_only").length,
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

