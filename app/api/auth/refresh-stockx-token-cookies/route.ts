import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { setTimeout as delay } from "timers/promises";
import fs from "fs";
import path from "path";

export const runtime = "nodejs"; // Force Node.js runtime for Puppeteer
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Environment detection for Vercel vs Local
async function getBrowser() {
  const isVercel = !!process.env.VERCEL;
  
  if (isVercel) {
    console.log("[BROWSER] Environment: Vercel (using puppeteer-core + chromium-min)");
    const puppeteerCore = (await import("puppeteer-core")).default;
    const chromium = (await import("@sparticuz/chromium-min")).default;
    return { puppeteer: puppeteerCore, chromium };
  } else {
    console.log("[BROWSER] Environment: Local (using standard puppeteer)");
    const puppeteer = (await import("puppeteer")).default;
    return { puppeteer, chromium: null };
  }
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

    let cookies;

    // Try to load cookies from environment variable first (for Vercel)
    if (process.env.STOCKX_COOKIES_BASE64) {
      console.log("[TOKEN REFRESH] 📦 Loading cookies from env var (Vercel)...");
      try {
        const cookiesJson = Buffer.from(process.env.STOCKX_COOKIES_BASE64, 'base64').toString('utf-8');
        cookies = JSON.parse(cookiesJson);
        console.log("[TOKEN REFRESH] ✅ Loaded cookies from STOCKX_COOKIES_BASE64");
      } catch (error) {
        console.error("[TOKEN REFRESH] ❌ Failed to parse STOCKX_COOKIES_BASE64:", error);
        return NextResponse.json(
          { 
            error: "Invalid STOCKX_COOKIES_BASE64",
            message: "Base64-encoded cookies in env var are malformed",
            details: error instanceof Error ? error.message : String(error)
          },
          { status: 400 }
        );
      }
    } else {
      // Fallback to file (for local development)
      console.log("[TOKEN REFRESH] 📁 Loading cookies from file (local)...");
      const cookiesPath = path.join(process.cwd(), "stockx-cookies.json");
      
      if (!fs.existsSync(cookiesPath)) {
        return NextResponse.json(
          { 
            error: "Missing cookies",
            message: "No cookies found (neither env var nor file)",
            instructions: [
              "LOCAL: Export cookies to stockx-cookies.json in project root",
              "VERCEL: Set STOCKX_COOKIES_BASE64 environment variable",
              "",
              "To export cookies:",
              "1. Open https://pro.stockx.com/purchasing/orders in Chrome",
              "2. Press F12 → Console tab",
              "3. Run: node export-stockx-cookies.js",
              "4. OR paste the export script from the Console",
              "",
              "To create env var for Vercel:",
              "cat stockx-cookies.json | base64 | pbcopy",
              "Then add STOCKX_COOKIES_BASE64=<paste> in Vercel dashboard"
            ]
          },
          { status: 400 }
        );
      }

      const cookiesData = fs.readFileSync(cookiesPath, "utf8");
      cookies = JSON.parse(cookiesData);
      console.log("[TOKEN REFRESH] ✅ Loaded cookies from file");
    }

    console.log(`[TOKEN REFRESH] ✅ Loaded ${cookies.length} cookies`);

    // Launch browser (environment-aware)
    const { puppeteer, chromium } = await getBrowser();
    const isVercel = !!process.env.VERCEL;
    
    console.log("[TOKEN REFRESH] 🌐 Launching browser...");
    browser = await puppeteer.launch(
      isVercel
        ? {
            args: chromium!.args,
            defaultViewport: chromium!.defaultViewport,
            executablePath: await chromium!.executablePath(),
            headless: chromium!.headless,
          }
        : {
            headless: "new",
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
            ],
          }
    );

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

