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

    // Call the token refresh API (using cookie-based method)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    
    // Use cookie-based method if STOCKX_COOKIES_BASE64 is set, else try automated login
    const useCookieMethod = !!process.env.STOCKX_COOKIES_BASE64;
    const endpoint = useCookieMethod 
      ? "/api/auth/refresh-stockx-token-cookies" 
      : "/api/auth/refresh-stockx-token";
    
    console.log(`[CRON] 🔄 Using ${useCookieMethod ? "cookie-based" : "automated login"} method`);
    
    const response = await fetch(`${baseUrl}${endpoint}`, {
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

