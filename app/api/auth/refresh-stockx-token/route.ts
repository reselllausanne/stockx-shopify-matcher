import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import fs from "fs";
import path from "path";

// CRITICAL: Force Node.js runtime (Puppeteer requires Node APIs)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Increase if needed (plan-dependent)

// Native delay helper (replaces page.waitForTimeout)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type PuppeteerContext = any;

// Detect if running on Vercel
const isVercel = !!process.env.VERCEL;

// Dynamic import: puppeteer-core on Vercel, puppeteer locally
async function getBrowser() {
  console.log(`[BROWSER] Environment: ${isVercel ? 'Vercel' : 'Local'}`);
  
  if (isVercel) {
    // Vercel: Use puppeteer-core + Sparticuz Chromium
    const puppeteerCore = (await import("puppeteer-core")).default;
    const chromium = (await import("@sparticuz/chromium-min")).default;
    return { puppeteer: puppeteerCore, chromium };
  } else {
    // Local: Use standard puppeteer (includes Chromium)
    const puppeteer = (await import("puppeteer")).default;
    return { puppeteer, chromium: null };
  }
}

// Debug helper
async function debugDump(page: any, label: string = "debug") {
  try {
    const url = page.url();
    console.log(`[DEBUG ${label}] Current URL:`, url);

    const debugDir = path.join(process.cwd(), "debug");
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    const screenshotPath = path.join(debugDir, `${label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[DEBUG ${label}] Screenshot saved: ${screenshotPath}`);

    const html = await page.content();
    const htmlPath = path.join(debugDir, `${label}.html`);
    fs.writeFileSync(htmlPath, html, "utf8");
    console.log(`[DEBUG ${label}] HTML saved: ${htmlPath}`);

    const inputs = await page.evaluate(() => {
      const allInputs = Array.from(document.querySelectorAll('input'));
      return allInputs.map(inp => {
        const rect = inp.getBoundingClientRect();
        const style = window.getComputedStyle(inp);
        const visible = rect.width > 0 && rect.height > 0 && 
                       style.visibility !== 'hidden' && 
                       style.display !== 'none';
        return {
          id: inp.id,
          name: inp.name,
          type: inp.type,
          visible: visible,
        };
      });
    });
    console.log(`[DEBUG ${label}] Inputs:`, JSON.stringify(inputs, null, 2));

  } catch (error) {
    console.error(`[DEBUG ${label}] Failed:`, error);
  }
}

// StockX-specific selectors
const EMAIL_SELECTORS = [
  '#email-login',
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[name="email"]',
].join(", ");

const PASSWORD_SELECTORS = [
  '#password-login',
  'input[type="password"]',
  'input[name="password"]',
].join(", ");

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
].join(", ");

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

    console.log("[TOKEN REFRESH] 🚀 Starting automated token refresh...");
    console.log(`[TOKEN REFRESH] Environment: ${isVercel ? '☁️ Vercel' : '💻 Local'}`);

    const stockxEmail = process.env.STOCKX_EMAIL?.trim();
    const stockxPassword = process.env.STOCKX_PASSWORD?.trim();
    const isDebugMode = process.env.PUPPETEER_DEBUG === "true";

    if (!stockxEmail || !stockxPassword) {
      throw new Error("Missing STOCKX_EMAIL or STOCKX_PASSWORD environment variables");
    }

    console.log(`[TOKEN REFRESH] Using email: ${stockxEmail.substring(0, 3)}***@***`);

    // Load browser with environment-specific config
    const { puppeteer, chromium } = await getBrowser();
    
    console.log("[TOKEN REFRESH] 🌐 Launching browser...");
    
    // Browser launch config - different for Vercel vs Local
    const launchConfig = isVercel && chromium
      ? {
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath: await chromium.executablePath(),
          headless: chromium.headless,
        }
      : {
          headless: !isDebugMode ? "new" : false,
          slowMo: isDebugMode ? 50 : 0,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ],
        };

    browser = await puppeteer.launch(launchConfig);

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Manual stealth: Override navigator properties BEFORE any page loads
    await page.evaluateOnNewDocument(() => {
      // Hide webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission } as PermissionStatus) :
          originalQuery(parameters)
      );

      // Mock chrome runtime
      (window as any).chrome = {
        runtime: {},
      };
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Capture bearer token
    let capturedToken: string | null = null;

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const headers = request.headers();
      if (headers["authorization"]?.startsWith("Bearer ")) {
        capturedToken = headers["authorization"].replace("Bearer ", "");
        console.log("[TOKEN REFRESH] ✅ Token captured from request!");
      }
      request.continue();
    });

    try {
      console.log("[TOKEN REFRESH] 📄 Navigating to StockX login...");
      await page.goto("https://accounts.stockx.com/login?redirectTo=https%3A%2F%2Fpro.stockx.com%2Fpurchasing%2Forders", {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });

      await delay(3000);

      // Check for bot detection EARLY
      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.includes("Appuyez et maintenez") || pageText.includes("Press & Hold")) {
        console.log("[TOKEN REFRESH] ⚠️ PerimeterX bot detection triggered!");
        await debugDump(page, "bot_detection_initial");
        throw new Error("PerimeterX detected automation. Manual stealth bypassed initial checks but still blocked.");
      }

      // Dismiss cookie banner
      console.log("[TOKEN REFRESH] 🍪 Checking for cookie banner...");
      try {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const acceptBtn = btns.find(btn => 
            btn.textContent?.toLowerCase().includes('accept')
          );
          if (acceptBtn) (acceptBtn as HTMLButtonElement).click();
        });
        await delay(500);
      } catch (e) {
        // No banner
      }

      // Click "Log In" tab
      console.log("[TOKEN REFRESH] 🔍 Ensuring we're on Log In tab...");
      try {
        await page.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('button, a, div[role="tab"]'));
          const loginTab = allElements.find(el => {
            const text = el.textContent?.trim().toLowerCase();
            return text === 'log in' || text === 'login';
          });
          if (loginTab) (loginTab as HTMLElement).click();
        });
        await delay(500);
      } catch (e) {
        // Already selected
      }

      const ctx = page;

      // STEP 1: Email
      console.log("[TOKEN REFRESH] 📧 Finding email input...");
      const emailEl = await ctx.waitForSelector(EMAIL_SELECTORS, { 
        visible: true, 
        timeout: 20000 
      });

      if (!emailEl) {
        await debugDump(page, "email_not_found");
        throw new Error("Email input not found");
      }

      console.log("[TOKEN REFRESH] ✅ Email found! Typing...");
      await emailEl.click({ clickCount: 3 });
      await delay(100);
      await emailEl.type(stockxEmail, { delay: 50 });
      console.log("[TOKEN REFRESH] ✅ Email typed");

      await delay(800);

      // STEP 2: Password
      console.log("[TOKEN REFRESH] 🔑 Finding password input...");
      const passEl = await ctx.waitForSelector(PASSWORD_SELECTORS, { 
        visible: true, 
        timeout: 20000 
      });

      if (!passEl) {
        await debugDump(page, "password_not_found");
        throw new Error("Password input not found");
      }

      console.log("[TOKEN REFRESH] ✅ Password found! Typing...");
      await passEl.click({ clickCount: 3 });
      await delay(100);
      await passEl.type(stockxPassword, { delay: 50 });
      console.log("[TOKEN REFRESH] ✅ Password typed");

      await delay(800);

      // STEP 3: Submit
      console.log("[TOKEN REFRESH] 🔓 Finding submit button...");
      const submitEl = await ctx.waitForSelector(SUBMIT_SELECTORS, { 
        visible: true, 
        timeout: 10000 
      });

      if (!submitEl) {
        await debugDump(page, "submit_not_found");
        throw new Error("Submit button not found");
      }

      console.log("[TOKEN REFRESH] ✅ Clicking submit...");
      
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
        (async () => {
          await submitEl.click();
          await delay(1000);
        })()
      ]);

      console.log("[TOKEN REFRESH] ⏳ Waiting for authentication...");
      await delay(4000);

      const currentUrl = page.url();
      console.log("[TOKEN REFRESH] 📍 Current URL:", currentUrl);

      // Check for errors or bot detection AFTER login
      const hasError = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        return bodyText.includes('incorrect') || 
               bodyText.includes('invalid') || 
               bodyText.includes('captcha') ||
               bodyText.includes('press & hold');
      });

      if (hasError || currentUrl.includes("login") || currentUrl.includes("captcha")) {
        await debugDump(page, "post_login_blocked");
        throw new Error(`Login blocked. PerimeterX detected. URL: ${currentUrl}`);
      }

      // Navigate to purchasing orders
      if (!currentUrl.includes("purchasing/orders")) {
        console.log("[TOKEN REFRESH] 🔄 Navigating to purchasing orders...");
        await page.goto("https://pro.stockx.com/purchasing/orders", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await delay(5000);
      } else {
        await delay(3000);
      }

      if (capturedToken) {
        console.log("[TOKEN REFRESH] 🎉 Token captured successfully!");
        
        try {
          await prisma.stockXToken.deleteMany({});
          await prisma.stockXToken.create({
            data: {
              token: capturedToken,
              expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
            },
          });
          console.log("[TOKEN REFRESH] 💾 Token saved to database");
        } catch (dbError: any) {
          console.error("[TOKEN REFRESH] ❌ DB save failed:", dbError);
        }

        return NextResponse.json({
          success: true,
          message: "Token refreshed successfully!",
          tokenPreview: `${capturedToken.substring(0, 20)}...`,
          environment: isVercel ? "Vercel" : "Local",
        });
      } else {
        await debugDump(page, "token_not_captured");
        throw new Error("Login succeeded but no token captured");
      }

    } catch (error: any) {
      console.error("[TOKEN REFRESH] ❌ Error:", error);
      throw error;
    }

  } catch (error: any) {
    console.error("[TOKEN REFRESH] ❌ Failed:", error);
    return NextResponse.json(
      { 
        error: "Failed to refresh token", 
        details: error.message,
        tip: "PerimeterX is very aggressive. If automated login fails consistently, cookie-based auth is more reliable."
      },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
