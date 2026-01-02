import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { setTimeout as delay } from "timers/promises";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60 seconds max (Vercel Pro needed for longer)

// Dynamic import of puppeteer (avoid Next.js bundling issues)
async function getBrowser() {
  const puppeteerCore = await import("puppeteer");
  return puppeteerCore.default;
}

// Debug helper: capture screenshot + HTML + URL when things fail
async function debugDump(page: any, label: string = "debug") {
  try {
    const url = page.url();
    console.log(`[DEBUG ${label}] Current URL:`, url);

    // Create debug folder if it doesn't exist
    const debugDir = path.join(process.cwd(), "debug");
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    // Screenshot
    const screenshotPath = path.join(debugDir, `${label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[DEBUG ${label}] Screenshot saved: ${screenshotPath}`);

    // HTML dump
    const html = await page.content();
    const htmlPath = path.join(debugDir, `${label}.html`);
    fs.writeFileSync(htmlPath, html, "utf8");
    console.log(`[DEBUG ${label}] HTML saved: ${htmlPath}`);

    // Log first 500 chars of body text
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
    console.log(`[DEBUG ${label}] Page text preview:`, bodyText);

  } catch (error) {
    console.error(`[DEBUG ${label}] Failed to create debug dump:`, error);
  }
}

export async function POST(req: Request) {
  let browser;
  
  try {
    // Verify this is a legitimate call (optional: use a secret)
    const body = await req.json().catch(() => ({}));
    const cronSecret = body.cronSecret || process.env.CRON_SECRET;
    
    if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json(
        { error: "Unauthorized - invalid or missing CRON_SECRET" },
        { status: 401 }
      );
    }

    console.log("[TOKEN REFRESH] 🚀 Starting automated token refresh...");

    // Get StockX credentials from environment variables (with validation)
    const stockxEmail = process.env.STOCKX_EMAIL?.trim();
    const stockxPassword = process.env.STOCKX_PASSWORD?.trim();
    const isDebugMode = process.env.PUPPETEER_DEBUG === "true"; // Set to see browser

    if (!stockxEmail || !stockxPassword) {
      throw new Error("Missing STOCKX_EMAIL or STOCKX_PASSWORD environment variables");
    }

    console.log(`[TOKEN REFRESH] Using email: ${stockxEmail.substring(0, 3)}***@***`);

    // Launch headless browser (or visible if debugging)
    console.log(`[TOKEN REFRESH] 🌐 Launching browser (headless: ${!isDebugMode})...`);
    const puppeteer = await getBrowser();
    browser = await puppeteer.launch({
      headless: !isDebugMode, // Set PUPPETEER_DEBUG=true to see browser
      slowMo: isDebugMode ? 50 : 0, // Slow down in debug mode
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
      await delay(2000);

      // First, try to dismiss any cookie banners that might block interactions
      console.log("[TOKEN REFRESH] 🍪 Checking for cookie banner...");
      try {
        const consentClicked = await page.evaluate(() => {
          const consentSelectors = [
            'button[id*="accept" i]',
            'button[class*="accept" i]',
            'button[class*="consent" i]',
            'button[id*="consent" i]'
          ];
          
          for (const selector of consentSelectors) {
            const btn = document.querySelector(selector);
            if (btn) {
              (btn as HTMLButtonElement).click();
              return true;
            }
          }
          return false;
        });
        
        if (consentClicked) {
          console.log("[TOKEN REFRESH] ✅ Dismissed cookie banner");
          await delay(500);
        }
      } catch (e) {
        console.log("[TOKEN REFRESH] No cookie banner found or already dismissed");
      }

      // Define comprehensive selector lists (including username for email)
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input#email',
        'input[autocomplete="email"]',
        'input[autocomplete="username"]',
        'input[name="username"]',
        'input[id*="email" i]',
        'input[name*="email" i]',
        'input[placeholder*="email" i]',
        'input[aria-label*="email" i]',
        'input[data-testid*="email" i]'
      ].join(", ");

      // Check if login is in an iframe
      console.log("[TOKEN REFRESH] 🔍 Checking for iframes...");
      const frames = page.frames();
      let targetFrame: any = page; // Can be Page or Frame
      
      for (const frame of frames) {
        try {
          const el = await frame.$(emailSelectors).catch(() => null);
          if (el) {
            console.log(`[TOKEN REFRESH] ✅ Found email input in iframe: ${frame.url()}`);
            targetFrame = frame;
            break;
          }
        } catch (e) {
          // Frame not accessible, continue
        }
      }

      // Try to find email input with DEBUG dump on failure
      console.log("[TOKEN REFRESH] 🔍 Looking for email input...");
      try {
        await targetFrame.waitForSelector(emailSelectors, { visible: true, timeout: 20000 });
        console.log("[TOKEN REFRESH] ✅ Email input found!");
      } catch (e) {
        console.error("[TOKEN REFRESH] ❌ Email input not found! Creating debug dump...");
        await debugDump(page, "login_email_not_found");
        throw new Error(`Email input not found. Debug files saved to /debug/ folder. URL: ${page.url()}`);
      }

      // Fill email
      console.log("[TOKEN REFRESH] 📧 Entering email...");
      await targetFrame.type(emailSelectors, stockxEmail, { delay: 30 });

      // Wait a bit before password
      await delay(500);

      // Password selectors
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input#password',
        'input[autocomplete*="password" i]',
        'input[placeholder*="password" i]',
        'input[aria-label*="password" i]',
        'input[data-testid*="password" i]'
      ].join(", ");

      try {
        await targetFrame.waitForSelector(passwordSelectors, { visible: true, timeout: 10000 });
        console.log("[TOKEN REFRESH] ✅ Password input found!");
      } catch (e) {
        console.error("[TOKEN REFRESH] ❌ Password input not found! Creating debug dump...");
        await debugDump(page, "login_password_not_found");
        throw new Error(`Password input not found. Debug files saved to /debug/ folder. URL: ${page.url()}`);
      }

      // Fill password
      console.log("[TOKEN REFRESH] 🔑 Entering password...");
      await targetFrame.type(passwordSelectors, stockxPassword, { delay: 30 });

      // Wait a bit before clicking
      await delay(500);

      // Login button selectors
      const loginButtonSelectors = [
        'button[type="submit"]',
        'button[data-testid*="login" i]',
        'button[data-testid*="submit" i]',
        'input[type="submit"]',
        'button[class*="login" i]',
        'button[class*="submit" i]',
        'button[id*="login" i]',
        'button[id*="submit" i]'
      ].join(", ");

      try {
        await targetFrame.waitForSelector(loginButtonSelectors, { visible: true, timeout: 10000 });
        console.log("[TOKEN REFRESH] ✅ Login button found!");
      } catch (e) {
        console.error("[TOKEN REFRESH] ❌ Login button not found! Creating debug dump...");
        await debugDump(page, "login_button_not_found");
        throw new Error(`Login button not found. Debug files saved to /debug/ folder. URL: ${page.url()}`);
      }

      console.log("[TOKEN REFRESH] 🔓 Clicking login button...");
      await targetFrame.click(loginButtonSelectors);

      // Wait for navigation after login
      console.log("[TOKEN REFRESH] ⏳ Waiting for authentication...");
      try {
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (e) {
        console.log("[TOKEN REFRESH] ⚠️ Navigation timeout, but continuing (may already be on target page)");
      }

      // Additional wait for full page load
      await delay(3000);

      // Check if we're successfully logged in or if there's an error
      const currentUrl = page.url();
      console.log("[TOKEN REFRESH] 📍 Current URL after login:", currentUrl);

      if (currentUrl.includes("login") || currentUrl.includes("error")) {
        await debugDump(page, "login_failed");
        throw new Error(`Login may have failed. Still on login page or error page. URL: ${currentUrl}`);
      }

      // If not already on purchasing orders, navigate there
      if (!currentUrl.includes("purchasing/orders")) {
        console.log("[TOKEN REFRESH] 🔄 Navigating to purchasing orders...");
        await page.goto("https://pro.stockx.com/purchasing/orders", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // Wait for GraphQL request to fire
        console.log("[TOKEN REFRESH] ⏳ Waiting for API call...");
        await delay(5000);
      }

      // Check if we captured the token
      if (capturedToken) {
        console.log("[TOKEN REFRESH] ✅ Token captured successfully!");
        
        // Save to database
        try {
          // Delete old tokens first
          await prisma.stockXToken.deleteMany({});
          
          // Create new token
          await prisma.stockXToken.create({
            data: {
              token: capturedToken,
              expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // Expires in 12 hours
            },
          });
          console.log("[TOKEN REFRESH] 💾 Token saved to database");
        } catch (dbError: any) {
          console.error("[TOKEN REFRESH] ❌ Failed to save token to database:", dbError);
          // Continue anyway - token was captured
        }

        return NextResponse.json({
          success: true,
          message: "StockX token refreshed and saved successfully",
          tokenPreview: `${capturedToken.substring(0, 20)}...`,
        });
      } else {
        await debugDump(page, "token_not_captured");
        throw new Error("Bearer token was not captured from network requests. Login may have failed or token format changed.");
      }

    } catch (error: any) {
      console.error("[TOKEN REFRESH] ❌ Error during login flow:", error);
      throw error;
    }

  } catch (error: any) {
    console.error("[TOKEN REFRESH] ❌ Failed to refresh token:", error);
    return NextResponse.json(
      { 
        error: "Failed to refresh token", 
        details: error.message,
        tip: "Check STOCKX_EMAIL and STOCKX_PASSWORD environment variables. Check debug/ folder for screenshots."
      },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close();
      console.log("[TOKEN REFRESH] 🔒 Browser closed");
    }
  }
}
