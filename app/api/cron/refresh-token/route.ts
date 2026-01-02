import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/refresh-token
 * 
 * Cron job endpoint called by Vercel Cron every 10 hours.
 * Triggers the token refresh automation.
 */
export async function GET(request: Request) {
  try {
    // Verify Vercel Cron secret
    const authHeader = request.headers.get("authorization");
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedAuth) {
      console.error("[CRON] Unauthorized access attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[CRON] 🕐 Token refresh cron job triggered");

    // Call the token refresh API
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const response = await fetch(`${baseUrl}/api/auth/refresh-stockx-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cronSecret: process.env.CRON_SECRET }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.details || "Token refresh failed");
    }

    console.log("[CRON] ✅ Token refreshed successfully");

    return NextResponse.json({
      success: true,
      message: "Token refresh cron job completed",
      result: data,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error("[CRON] ❌ Error:", error);
    return NextResponse.json(
      {
        error: "Cron job failed",
        details: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

