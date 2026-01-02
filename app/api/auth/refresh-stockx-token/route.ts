import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60 seconds max (Vercel Pro needed for longer)

// Dynamic import of puppeteer (avoid Next.js bundling issues)
async function getBrowser() {
  const puppeteerCore = await import("puppeteer");
  return puppeteerCore.default;
}

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
    const puppeteer = await getBrowser();
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Wait a bit for any redirects or dynamic content
      await page.waitForTimeout(2000);

      // Try to find the email input (multiple possible selectors)
      console.log("[TOKEN REFRESH] 🔍 Looking for email input...");
      await page.waitForSelector('input[type="email"], input[name="email"], input#email, input[data-testid="email-input"]', { 
        timeout: 15000,
        visible: true
      });

      // Fill in email
      console.log("[TOKEN REFRESH] 📧 Entering email...");
      const emailFilled = await page.evaluate((email) => {
        const emailInput = document.querySelector('input[type="email"], input[name="email"], input#email') as HTMLInputElement;
        if (emailInput) {
          emailInput.value = email;
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          emailInput.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, stockxEmail);

      if (!emailFilled) {
        throw new Error("Could not find email input field");
      }

      // Wait a bit before password
      await page.waitForTimeout(500);

      // Fill in password
      console.log("[TOKEN REFRESH] 🔑 Entering password...");
      const passwordFilled = await page.evaluate((password) => {
        const passwordInput = document.querySelector('input[type="password"], input[name="password"], input#password') as HTMLInputElement;
        if (passwordInput) {
          passwordInput.value = password;
          passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
          passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, stockxPassword);

      if (!passwordFilled) {
        throw new Error("Could not find password input field");
      }

      // Wait a bit before clicking
      await page.waitForTimeout(500);

      // Click login button (multiple possible selectors, no :has-text)
      console.log("[TOKEN REFRESH] 🔓 Clicking login button...");
      const loginClicked = await page.evaluate(() => {
        // Try multiple button selectors
        const button = 
          document.querySelector('button[type="submit"]') ||
          document.querySelector('button[data-testid="login-button"]') ||
          Array.from(document.querySelectorAll('button')).find(btn => 
            btn.textContent?.toLowerCase().includes('log in') ||
            btn.textContent?.toLowerCase().includes('sign in')
          );
        
        if (button) {
          (button as HTMLButtonElement).click();
          return true;
        }
        return false;
      });

      if (!loginClicked) {
        throw new Error("Could not find or click login button");
      }

      // Wait for navigation after login
      console.log("[TOKEN REFRESH] ⏳ Waiting for authentication...");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 });

      // Additional wait for full page load
      await page.waitForTimeout(3000);

      // Navigate to purchasing orders to trigger GraphQL request
      if (!capturedToken) {
        console.log("[TOKEN REFRESH] 🔄 Navigating to purchasing orders to trigger API call...");
        await page.goto("https://pro.stockx.com/purchasing/orders", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // Wait for GraphQL request to fire
        console.log("[TOKEN REFRESH] ⏳ Waiting for API call...");
        await page.waitForTimeout(5000);
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

