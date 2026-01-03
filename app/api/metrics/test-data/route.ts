import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TestDataItem {
  shopifyOrderId: string;
  createdAt: string;
  grossSales: number;
  marginChf: number;
  marginPct: number;
  currency: string;
}

export async function POST(req: Request) {
  try {
    const { testData }: { testData: TestDataItem[] } = await req.json();

    if (!testData || !Array.isArray(testData)) {
      return NextResponse.json(
        { error: "Missing or invalid testData array" },
        { status: 400 }
      );
    }

    console.log(`[TEST-DATA] Creating ${testData.length} test records...`);

    let created = 0;
    let skipped = 0;

    for (const item of testData) {
      try {
        // Check if already exists
        const existing = await prisma.orderMetric.findUnique({
          where: { shopifyOrderId: item.shopifyOrderId },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Create test record
        await prisma.orderMetric.create({
          data: {
            shopifyOrderId: item.shopifyOrderId,
            createdAt: new Date(item.createdAt),
            grossSales: item.grossSales,
            marginChf: item.marginChf,
            marginPct: item.marginPct,
            currency: item.currency,
          },
        });

        created++;
        console.log(`[TEST-DATA] ✅ Created: ${item.shopifyOrderId}`);
      } catch (error) {
        console.error(`[TEST-DATA] Error creating ${item.shopifyOrderId}:`, error);
      }
    }

    console.log(`[TEST-DATA] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[TEST-DATA] ✅ TEST DATA COMPLETE`);
    console.log(`[TEST-DATA] 📊 Results:`);
    console.log(`[TEST-DATA]   - Created: ${created}`);
    console.log(`[TEST-DATA]   - Skipped (existing): ${skipped}`);
    console.log(`[TEST-DATA] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    return NextResponse.json({
      success: true,
      message: `Created ${created} test records, skipped ${skipped} existing`,
      created,
      skipped,
    });

  } catch (error: any) {
    console.error("[TEST-DATA] Error creating test data:", error);
    return NextResponse.json(
      { error: "Failed to create test data", details: error.message },
      { status: 500 }
    );
  }
}
