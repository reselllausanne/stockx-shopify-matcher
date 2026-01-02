import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { setTimeout as delay } from "timers/promises";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60 seconds max (Vercel Pro needed for longer)

// Type for Puppeteer context (can be Page or Frame)
type PuppeteerContext = any;

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

    // Log all input fields for debugging
    const inputs = await page.evaluate(() => {
      const allInputs = Array.from(document.querySelectorAll('input'));
      return allInputs.map(inp => ({
        id: inp.id,
        name: inp.name,
        type: inp.type,
        placeholder: inp.placeholder,
        autocomplete: inp.getAttribute('autocomplete'),
        visible: inp.offsetParent !== null
      }));
    });
    console.log(`[DEBUG ${label}] All inputs on page:`, JSON.stringify(inputs, null, 2));

  } catch (error) {
    console.error(`[DEBUG ${label}] Failed to create debug dump:`, error);
  }
}

// Find which context (page or iframe) contains a selector
async function findContextWithSelector(page: any, selector: string): Promise<PuppeteerContext> {
  console.log(`[CONTEXT] Searching for selector: ${selector}`);
  
  // 1) Try main page first
  try {
    const el = await page.$(selector);
    if (el) {
      console.log(`[CONTEXT] ✅ Found in main page`);
      return page;
    }
  } catch (e) {
    // Continue to frames
  }

  // 2) Try all iframes
  const frames = page.frames();
  console.log(`[CONTEXT] Checking ${frames.length} frames...`);
  
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    try {
      const el = await frame.$(selector);
      if (el) {
        console.log(`[CONTEXT] ✅ Found in iframe ${i}: ${frame.url()}`);
        return frame;
      }
    } catch (e) {
      // Frame not accessible or selector not found
    }
  }

  // 3) Wait a bit and retry (frames might be loading)
  console.log(`[CONTEXT] Not found, waiting 500ms and retrying...`);
  await delay(500);

  // Retry main page
  try {
    const el = await page.$(selector);
    if (el) {
      console.log(`[CONTEXT] ✅ Found in main page (after delay)`);
      return page;
    }
  } catch (e) {
    // Continue
  }

  // Retry frames
  const framesRetry = page.frames();
  for (let i = 0; i < framesRetry.length; i++) {
    const frame = framesRetry[i];
    try {
      const el = await frame.$(selector);
      if (el) {
        console.log(`[CONTEXT] ✅ Found in iframe ${i} (after delay): ${frame.url()}`);
        return frame;
      }
    } catch (e) {
      // Frame not accessible
    }
  }

  throw new Error(`Selector not found in page or any iframe: ${selector}`);
}

// StockX-specific selectors (based on actual HTML analysis)
const STOCKX_EMAIL_SELECTORS = [
  '#email-login',                    // Primary: StockX's exact ID for login tab
  'input[id="email-login"]',
  'input[type="email"]',
  'input[name="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[name="username"]',
  'input[placeholder*="email" i]',
].join(", ");

const STOCKX_PASSWORD_SELECTORS = [
  '#password-login',                 // Primary: StockX's exact ID for login tab
  'input[id="password-login"]',
  'input[type="password"]',
  'input[name="password"]',
  'input[autocomplete*="password" i]',
  'input[placeholder*="password" i]',
].join(", ");

const STOCKX_SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[id*="login" i]',
  'button[class*="submit" i]',
].join(", ");

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

      // Find the context (page or iframe) that contains the email input
      console.log("[TOKEN REFRESH] 🔍 Finding login form context...");
      let ctx: PuppeteerContext;
      
      try {
        ctx = await findContextWithSelector(page, STOCKX_EMAIL_SELECTORS);
      } catch (e) {
        console.error("[TOKEN REFRESH] ❌ Email input not found in any context!");
        await debugDump(page, "login_email_not_found");
        throw new Error(`Email input not found. Debug files saved. URL: ${page.url()}`);
      }

      // IMPORTANT: Use the SAME context for ALL form interactions

      // Fill email
      console.log("[TOKEN REFRESH] 📧 Filling email...");
      try {
        await ctx.waitForSelector(STOCKX_EMAIL_SELECTORS, { visible: true, timeout: 10000 });
        await ctx.click(STOCKX_EMAIL_SELECTORS, { clickCount: 3 }); // Select all
        await ctx.type(STOCKX_EMAIL_SELECTORS, stockxEmail, { delay: 30 });
        console.log("[TOKEN REFRESH] ✅ Email filled");
      } catch (e) {
        await debugDump(page, "email_fill_failed");
        throw new Error(`Failed to fill email: ${(e as Error).message}`);
      }

      await delay(500);

      // Fill password (SAME context as email!)
      console.log("[TOKEN REFRESH] 🔑 Filling password...");
      try {
        await ctx.waitForSelector(STOCKX_PASSWORD_SELECTORS, { visible: true, timeout: 10000 });
        await ctx.click(STOCKX_PASSWORD_SELECTORS, { clickCount: 3 }); // Select all
        await ctx.type(STOCKX_PASSWORD_SELECTORS, stockxPassword, { delay: 30 });
        console.log("[TOKEN REFRESH] ✅ Password filled");
      } catch (e) {
        await debugDump(page, "password_fill_failed");
        throw new Error(`Failed to fill password: ${(e as Error).message}`);
      }

      await delay(500);

      // Click login button (SAME context!)
      console.log("[TOKEN REFRESH] 🔓 Clicking login button...");
      try {
        await ctx.waitForSelector(STOCKX_SUBMIT_SELECTORS, { visible: true, timeout: 10000 });
        
        // Click and wait for navigation (race condition to handle both cases)
        await Promise.race([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
          (async () => {
            await ctx.click(STOCKX_SUBMIT_SELECTORS);
            await delay(1000);
          })()
        ]);
        
        console.log("[TOKEN REFRESH] ✅ Login button clicked");
      } catch (e) {
        await debugDump(page, "submit_click_failed");
        throw new Error(`Failed to click login button: ${(e as Error).message}`);
      }

      // Wait for navigation after login
      console.log("[TOKEN REFRESH] ⏳ Waiting for authentication...");
      await delay(3000);

      // Check if we're successfully logged in or if there's an error
      const currentUrl = page.url();
      console.log("[TOKEN REFRESH] 📍 Current URL after login:", currentUrl);

      // Check for login errors
      const hasError = await page.evaluate(() => {
        const errorText = document.body.innerText.toLowerCase();
        return errorText.includes('incorrect') || 
               errorText.includes('invalid') || 
               errorText.includes('wrong password') ||
               errorText.includes('error');
      });

      if (hasError || currentUrl.includes("login") || currentUrl.includes("error")) {
        await debugDump(page, "login_failed_still_on_login");
        throw new Error(`Login may have failed. Still on login/error page. URL: ${currentUrl}`);
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
      } else {
        // Already on the right page, just wait for token
        await delay(3000);
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
