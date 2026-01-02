import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { setTimeout as delay } from "timers/promises";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PuppeteerContext = any;

async function getBrowser() {
  const puppeteerCore = await import("puppeteer");
  return puppeteerCore.default;
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

    // Log ALL inputs with visibility info
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
          placeholder: inp.placeholder,
          autocomplete: inp.getAttribute('autocomplete'),
          visible: visible,
          parentVisible: inp.offsetParent !== null
        };
      });
    });
    console.log(`[DEBUG ${label}] All inputs:`, JSON.stringify(inputs, null, 2));

  } catch (error) {
    console.error(`[DEBUG ${label}] Failed to create debug dump:`, error);
  }
}

// StockX-specific selectors (order matters: most specific first)
const EMAIL_SELECTORS = [
  '#email-login',                    // StockX's login tab email
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[id*="email" i]',
  'input[placeholder*="email" i]',
].join(", ");

const PASSWORD_SELECTORS = [
  '#password-login',                 // StockX's login tab password
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[name="password"]',
  'input[id*="password" i]',
  'input[placeholder*="password" i]',
].join(", ");

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[id*="login" i]',
  'button[class*="submit" i]',
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

    const stockxEmail = process.env.STOCKX_EMAIL?.trim();
    const stockxPassword = process.env.STOCKX_PASSWORD?.trim();
    const isDebugMode = process.env.PUPPETEER_DEBUG === "true";

    if (!stockxEmail || !stockxPassword) {
      throw new Error("Missing STOCKX_EMAIL or STOCKX_PASSWORD environment variables");
    }

    console.log(`[TOKEN REFRESH] Using email: ${stockxEmail.substring(0, 3)}***@***`);

    const puppeteer = await getBrowser();
    browser = await puppeteer.launch({
      headless: !isDebugMode,
      slowMo: isDebugMode ? 50 : 0,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    const page = await browser.newPage();

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
        timeout: 30000,
      });

      await delay(2000);

      // Dismiss cookie banner
      console.log("[TOKEN REFRESH] 🍪 Checking for cookie banner...");
      try {
        const consentClicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const acceptBtn = btns.find(btn => 
            btn.textContent?.toLowerCase().includes('accept') ||
            btn.id?.toLowerCase().includes('accept') ||
            btn.className?.toLowerCase().includes('accept')
          );
          if (acceptBtn) {
            (acceptBtn as HTMLButtonElement).click();
            return true;
          }
          return false;
        });
        
        if (consentClicked) {
          console.log("[TOKEN REFRESH] ✅ Dismissed cookie banner");
          await delay(500);
        }
      } catch (e) {
        console.log("[TOKEN REFRESH] No cookie banner found");
      }

      // CRITICAL: Click "Log In" tab to ensure we're on the right form
      console.log("[TOKEN REFRESH] 🔍 Ensuring we're on Log In tab...");
      try {
        const loginTabClicked = await page.evaluate(() => {
          // Look for "Log In" tab button
          const allElements = Array.from(document.querySelectorAll('button, a, div[role="tab"]'));
          const loginTab = allElements.find(el => {
            const text = el.textContent?.trim().toLowerCase();
            return text === 'log in' || text === 'login' || text === 'sign in';
          });
          
          if (loginTab) {
            (loginTab as HTMLElement).click();
            return true;
          }
          return false;
        });
        
        if (loginTabClicked) {
          console.log("[TOKEN REFRESH] ✅ Clicked Log In tab");
          await delay(500);
        } else {
          console.log("[TOKEN REFRESH] ℹ️ No Log In tab found (might already be selected)");
        }
      } catch (e) {
        console.log("[TOKEN REFRESH] ⚠️ Failed to click Log In tab:", e);
      }

      // Use the main page context (StockX login is not in iframe based on HTML analysis)
      const ctx: PuppeteerContext = page;

      // STEP 1: Find and fill EMAIL using ElementHandle
      console.log("[TOKEN REFRESH] 📧 Finding email input...");
      const emailEl = await ctx.waitForSelector(EMAIL_SELECTORS, { 
        visible: true, 
        timeout: 20000 
      });

      if (!emailEl) {
        await debugDump(page, "email_element_not_found");
        throw new Error("Email element handle not found after waitForSelector");
      }

      console.log("[TOKEN REFRESH] ✅ Email element found! Typing...");
      await emailEl.click({ clickCount: 3 }); // Select all (in case there's cached value)
      await emailEl.type(stockxEmail, { delay: 30 });
      console.log("[TOKEN REFRESH] ✅ Email typed");

      await delay(500);

      // STEP 2: Find and fill PASSWORD using ElementHandle (after email typing, in case of re-render)
      console.log("[TOKEN REFRESH] 🔑 Finding password input...");
      const passEl = await ctx.waitForSelector(PASSWORD_SELECTORS, { 
        visible: true, 
        timeout: 20000 
      });

      if (!passEl) {
        await debugDump(page, "password_element_not_found");
        throw new Error("Password element handle not found after waitForSelector");
      }

      console.log("[TOKEN REFRESH] ✅ Password element found! Typing...");
      await passEl.click({ clickCount: 3 });
      await passEl.type(stockxPassword, { delay: 30 });
      console.log("[TOKEN REFRESH] ✅ Password typed");

      await delay(500);

      // STEP 3: Find and click SUBMIT button using ElementHandle
      console.log("[TOKEN REFRESH] 🔓 Finding submit button...");
      const submitEl = await ctx.waitForSelector(SUBMIT_SELECTORS, { 
        visible: true, 
        timeout: 10000 
      });

      if (!submitEl) {
        await debugDump(page, "submit_button_not_found");
        throw new Error("Submit button element handle not found");
      }

      console.log("[TOKEN REFRESH] ✅ Submit button found! Clicking...");
      
      // Click and wait for navigation (with race condition handling)
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
        (async () => {
          await submitEl.click();
          await delay(1000);
        })()
      ]);

      console.log("[TOKEN REFRESH] ✅ Login button clicked");

      // Wait for authentication
      console.log("[TOKEN REFRESH] ⏳ Waiting for authentication...");
      await delay(3000);

      const currentUrl = page.url();
      console.log("[TOKEN REFRESH] 📍 Current URL after login:", currentUrl);

      // Check for login errors
      const hasError = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        return bodyText.includes('incorrect') || 
               bodyText.includes('invalid') || 
               bodyText.includes('wrong password') ||
               bodyText.includes('try again');
      });

      if (hasError || currentUrl.includes("login") || currentUrl.includes("error") || currentUrl.includes("captcha")) {
        await debugDump(page, "login_failed_or_blocked");
        throw new Error(`Login failed or blocked by bot detection. URL: ${currentUrl}. Try cookie-based method instead.`);
      }

      // Navigate to purchasing orders if not there already
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

      // Check if token captured
      if (capturedToken) {
        console.log("[TOKEN REFRESH] ✅ Token captured successfully!");
        
        // Save to database
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
          console.error("[TOKEN REFRESH] ❌ Failed to save to DB:", dbError);
        }

        return NextResponse.json({
          success: true,
          message: "StockX token refreshed successfully",
          tokenPreview: `${capturedToken.substring(0, 20)}...`,
        });
      } else {
        await debugDump(page, "token_not_captured");
        throw new Error("Bearer token not captured. Login may have succeeded but no API calls made yet.");
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
        tip: "If blocked by bot detection, use the '🍪 Via Cookies' button instead. See STOCKX_TOKEN_REFRESH.md"
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
