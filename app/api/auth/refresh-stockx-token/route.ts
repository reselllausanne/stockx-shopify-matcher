import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

// Import Puppeteer with stealth plugin to avoid detection
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60 seconds max (Vercel Pro needed for longer)

/**
 * POST /api/auth/refresh-stockx-token
 * 
 * Fully automated StockX token refresh using Puppeteer.
 * Called by cron job every 10 hours.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { cronSecret } = body;

    // Verify cron secret for security
    if (cronSecret !== process.env.CRON_SECRET) {
      console.error("[TOKEN REFRESH] Unauthorized: Invalid cron secret");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[TOKEN REFRESH] 🚀 Starting automated token refresh...");

    // Get StockX credentials from environment variables
    const stockxEmail = process.env.STOCKX_EMAIL;
    const stockxPassword = process.env.STOCKX_PASSWORD;

    if (!stockxEmail || !stockxPassword) {
      throw new Error("Missing STOCKX_EMAIL or STOCKX_PASSWORD environment variables");
    }

    // Launch headless browser
    console.log("[TOKEN REFRESH] 🌐 Launching browser...");
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ],
    });

    const page = await browser.newPage();

    // Set user agent to appear as normal browser
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Capture bearer token from network requests
    let capturedToken: string | null = null;

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const headers = request.headers();
      if (headers["authorization"] && headers["authorization"].startsWith("Bearer ")) {
        capturedToken = headers["authorization"].replace("Bearer ", "");
        console.log("[TOKEN REFRESH] ✅ Token captured from request!");
      }
      request.continue();
    });

    try {
      // Navigate to StockX login page
      console.log("[TOKEN REFRESH] 📄 Navigating to StockX login...");
      await page.goto("https://accounts.stockx.com/login?redirectTo=https%3A%2F%2Fpro.stockx.com%2Fpurchasing%2Forders", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // Wait for login form
      await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });

      // Fill in email
      console.log("[TOKEN REFRESH] 📧 Entering email...");
      await page.type('input[name="email"], input[type="email"]', stockxEmail, { delay: 50 });

      // Fill in password
      console.log("[TOKEN REFRESH] 🔑 Entering password...");
      await page.type('input[name="password"], input[type="password"]', stockxPassword, { delay: 50 });

      // Click login button
      console.log("[TOKEN REFRESH] 🔓 Clicking login...");
      await Promise.all([
        page.click('button[type="submit"], button:has-text("Log In")'),
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
      ]);

      // Wait for redirect to Pro dashboard (means we're logged in)
      console.log("[TOKEN REFRESH] ⏳ Waiting for authentication...");
      await page.waitForSelector('[data-testid="buying-orders"], .orders-table, h1:has-text("Purchasing")', {
        timeout: 20000,
      });

      // Navigate to purchasing orders to trigger GraphQL request
      if (!capturedToken) {
        console.log("[TOKEN REFRESH] 🔄 Navigating to purchasing orders...");
        await page.goto("https://pro.stockx.com/purchasing/orders", {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // Wait a bit for GraphQL request to fire
        await page.waitForTimeout(3000);
      }

      if (!capturedToken) {
        throw new Error("Failed to capture bearer token from network requests");
      }

      console.log("[TOKEN REFRESH] 🎉 Token successfully captured!");
      console.log("[TOKEN REFRESH] Token preview:", capturedToken.substring(0, 30) + "...");

      // Store token in database (create a StockXToken table)
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "StockXToken" (
          id SERIAL PRIMARY KEY,
          token TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '12 hours'
        );
      `;

      // Insert new token and delete old ones
      await prisma.$executeRaw`
        DELETE FROM "StockXToken";
      `;

      await prisma.$executeRaw`
        INSERT INTO "StockXToken" (token) VALUES (${capturedToken});
      `;

      console.log("[TOKEN REFRESH] 💾 Token saved to database");

      await browser.close();

      return NextResponse.json({
        success: true,
        message: "Token refreshed successfully",
        tokenPreview: capturedToken.substring(0, 30) + "...",
        expiresIn: "12 hours",
      });

    } catch (error) {
      await browser.close();
      throw error;
    }

  } catch (error: any) {
    console.error("[TOKEN REFRESH] ❌ Error:", error);
    return NextResponse.json(
      {
        error: "Failed to refresh token",
        details: error.message,
        tip: "Check STOCKX_EMAIL and STOCKX_PASSWORD environment variables",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/refresh-stockx-token
 * 
 * Get the current stored token.
 */
export async function GET(req: Request) {
  try {
    const result = await prisma.$queryRaw<Array<{ token: string; created_at: Date; expires_at: Date }>>`
      SELECT token, created_at, expires_at 
      FROM "StockXToken" 
      ORDER BY created_at DESC 
      LIMIT 1;
    `;

    if (!result || result.length === 0) {
      return NextResponse.json({ error: "No token found" }, { status: 404 });
    }

    const tokenData = result[0];
    const isExpired = new Date() > tokenData.expires_at;

    return NextResponse.json({
      token: tokenData.token,
      createdAt: tokenData.created_at,
      expiresAt: tokenData.expires_at,
      isExpired,
      tokenPreview: tokenData.token.substring(0, 30) + "...",
    });

  } catch (error: any) {
    console.error("[TOKEN GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to get token", details: error.message },
      { status: 500 }
    );
  }
}

