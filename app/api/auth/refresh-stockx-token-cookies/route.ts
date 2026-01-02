import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { setTimeout as delay } from "timers/promises";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function getBrowser() {
  const puppeteerCore = await import("puppeteer");
  return puppeteerCore.default;
}

export async function POST(req: Request) {
  let browser;
  
  try {
    const body = await req.json().catch(() => ({}));
    const cronSecret = body.cronSecret || process.env.CRON_SECRET;
    
    if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json(
        { error: "Unauthorized - invalid or missing CRON_SECRET" },
        { status: 401 }
      );
    }

    console.log("[TOKEN REFRESH] 🍪 Starting cookie-based token refresh...");

    // Path to cookies file
    const cookiesPath = path.join(process.cwd(), "stockx-cookies.json");
    
    if (!fs.existsSync(cookiesPath)) {
      return NextResponse.json(
        { 
          error: "Missing cookies file",
          message: "Please login manually and export cookies first",
          instructions: [
            "1. Open Chrome and login to StockX Pro",
            "2. Press F12 → Console tab",
            "3. Paste: copy(JSON.stringify(document.cookie.split('; ').map(c => {const [name, ...v] = c.split('='); return {name, value: v.join('='), domain: '.stockx.com'}})))",
            "4. Save clipboard to: stockx-cookies.json in project root"
          ]
        },
        { status: 400 }
      );
    }

    // Load cookies
    const cookiesData = fs.readFileSync(cookiesPath, "utf8");
    const cookies = JSON.parse(cookiesData);

    console.log(`[TOKEN REFRESH] ✅ Loaded ${cookies.length} cookies`);

    // Launch browser
    const puppeteer = await getBrowser();
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    // Set cookies BEFORE navigating
    await page.setCookie(...cookies);
    console.log("[TOKEN REFRESH] 🍪 Cookies applied");

    // Capture token
    let capturedToken: string | null = null;

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const headers = request.headers();
      if (headers["authorization"]?.startsWith("Bearer ")) {
        capturedToken = headers["authorization"].replace("Bearer ", "");
        console.log("[TOKEN REFRESH] ✅ Token captured!");
      }
      request.continue();
    });

    // Navigate directly to purchasing orders (already logged in via cookies!)
    console.log("[TOKEN REFRESH] 🔄 Navigating to purchasing orders...");
    await page.goto("https://pro.stockx.com/purchasing/orders", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for API calls
    await delay(5000);

    // Check URL - if redirected to login, cookies expired
    const currentUrl = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("accounts.stockx.com")) {
      throw new Error("Cookies expired - please login manually and re-export cookies");
    }

    if (capturedToken) {
      console.log("[TOKEN REFRESH] ✅ Token captured successfully!");
      
      // Save to database
      await prisma.stockXToken.deleteMany({});
      await prisma.stockXToken.create({
        data: {
          token: capturedToken,
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        },
      });
      
      console.log("[TOKEN REFRESH] 💾 Token saved to database");

      return NextResponse.json({
        success: true,
        message: "StockX token refreshed using cookies",
        tokenPreview: `${capturedToken.substring(0, 20)}...`,
      });
    } else {
      throw new Error("No token captured from API requests");
    }

  } catch (error: any) {
    console.error("[TOKEN REFRESH] ❌ Failed:", error);
    return NextResponse.json(
      { 
        error: "Failed to refresh token", 
        details: error.message,
        tip: "Cookies may have expired. Login manually and re-export."
      },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

