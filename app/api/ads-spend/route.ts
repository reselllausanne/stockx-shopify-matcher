import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ads-spend?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Get daily ad spend records
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    
    // Build date filter
    const dateFilter: any = {};
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0, 0, 0, 0);
        dateFilter.gte = fromDate;
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        dateFilter.lte = toDate;
      }
    }
    
    const where = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {};
    
    const records = await prisma.dailyAdSpend.findMany({
      where,
      orderBy: {
        date: "desc",
      },
    });
    
    // Convert Decimals to numbers for frontend
    const recordsWithNumbers = records.map(r => ({
      ...r,
      amountChf: toNumberSafe(r.amountChf, 0),
      date: r.date.toISOString().split('T')[0], // YYYY-MM-DD format
    }));
    
    const total = records.reduce((sum, r) => sum + toNumberSafe(r.amountChf, 0), 0);
    
    return NextResponse.json({
      success: true,
      count: records.length,
      total: Number(total.toFixed(2)),
      records: recordsWithNumbers,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[ADS-SPEND] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch ad spend", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ads-spend
 * Create or update (upsert) a daily ad spend record
 * Body: { date: "YYYY-MM-DD", amountChf: number, channel?: string, notes?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, amountChf, channel, notes } = body;
    
    if (!date) {
      return NextResponse.json(
        { error: "Missing required field: date" },
        { status: 400 }
      );
    }
    
    if (amountChf === undefined || amountChf === null) {
      return NextResponse.json(
        { error: "Missing required field: amountChf" },
        { status: 400 }
      );
    }
    
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }
    
    // Set to start of day
    dateObj.setHours(0, 0, 0, 0);
    
    const amount = parseFloat(amountChf);
    if (isNaN(amount) || amount < 0) {
      return NextResponse.json(
        { error: "Invalid amountChf. Must be a positive number" },
        { status: 400 }
      );
    }
    
    const record = await prisma.dailyAdSpend.upsert({
      where: { date: dateObj },
      update: {
        amountChf: amount,
        channel: channel || "google",
        notes: notes || null,
        updatedAt: new Date(),
      },
      create: {
        date: dateObj,
        amountChf: amount,
        channel: channel || "google",
        notes: notes || null,
      },
    });
    
    console.log(`[ADS-SPEND] Upserted: ${date} = CHF ${amount}`);
    
    return NextResponse.json({
      success: true,
      record: {
        ...record,
        amountChf: toNumberSafe(record.amountChf, 0),
        date: record.date.toISOString().split('T')[0],
      },
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[ADS-SPEND] POST error:", error);
    return NextResponse.json(
      { error: "Failed to save ad spend", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ads-spend?date=YYYY-MM-DD
 * Delete a daily ad spend record
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date");
    
    if (!dateStr) {
      return NextResponse.json(
        { error: "Missing required parameter: date" },
        { status: 400 }
      );
    }
    
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }
    
    dateObj.setHours(0, 0, 0, 0);
    
    // Use deleteMany for idempotent delete (safe to call multiple times)
    const result = await prisma.dailyAdSpend.deleteMany({
      where: { date: dateObj },
    });
    
    const deletedCount = result.count;
    console.log(`[ADS-SPEND] Deleted ${deletedCount} record(s) for ${dateStr}`);
    
    return NextResponse.json({
      success: true,
      deletedCount,
      message: deletedCount > 0 
        ? `Ad spend for ${dateStr} deleted` 
        : `No ad spend record found for ${dateStr} (already deleted)`,
    }, { status: 200 });
    
  } catch (error: any) {
    console.error("[ADS-SPEND] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete ad spend", details: error.message },
      { status: 500 }
    );
  }
}

