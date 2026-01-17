import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseYmd = (value: string | null): { y: number; m: number; d: number } | null => {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => Number(p));
  if (!y || !m || !d) return null;
  return { y, m, d };
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date");
    const parsed = parseYmd(dateStr);

    if (!parsed) {
      return NextResponse.json(
        { error: "Missing or invalid date. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const { y, m, d } = parsed;
    const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

    const matches = await prisma.orderMatch.findMany({
      where: {
        // @ts-expect-error pending Prisma client regeneration
        shopifyCreatedAt: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        // @ts-expect-error pending Prisma client regeneration
        shopifyCreatedAt: "asc",
      },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifyProductTitle: true,
        shopifySku: true,
        shopifySizeEU: true,
        shopifyTotalPrice: true,
        manualRevenueAdjustment: true,
        supplierCost: true,
        manualCostOverride: true,
        // @ts-expect-error pending Prisma client regeneration
        shopifyCreatedAt: true,
        stockxOrderNumber: true,
        supplierSource: true,
      },
    });

    const rows = matches.map((m) => {
      const revenue =
        toNumberSafe(m.shopifyTotalPrice, 0) + toNumberSafe(m.manualRevenueAdjustment, 0);
      const cost = toNumberSafe(m.manualCostOverride, 0) || toNumberSafe(m.supplierCost, 0);
      const margin = revenue - cost;

      return {
        shopifyOrderId: m.shopifyOrderId,
        shopifyOrderName: m.shopifyOrderName,
        shopifyProductTitle: m.shopifyProductTitle,
        shopifySku: m.shopifySku,
        shopifySizeEU: m.shopifySizeEU,
        shopifyCreatedAt: m.shopifyCreatedAt,
        stockxOrderNumber: m.stockxOrderNumber,
        supplierSource: m.supplierSource,
        revenue,
        cost,
        margin,
      };
    });

    return NextResponse.json({ date: dateStr, rows });
  } catch (error: any) {
    console.error("[METRICS/DAILY-DETAILS] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch daily details", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

