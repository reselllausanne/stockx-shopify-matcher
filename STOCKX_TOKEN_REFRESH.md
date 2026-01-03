# 🔐 StockX Token Refresh Guide

## 🎯 Overview

This app supports **two methods** for automated StockX token refresh:

1. **🍪 Cookie-Based (RECOMMENDED)** - Works reliably, bypasses bot detection
2. **🤖 Automated Login** - Direct login automation (blocked by PerimeterX currently)

---

## ✅ Method 1: Cookie-Based Token Refresh (RECOMMENDED)

### **Why This Works**:
- Bypasses login form entirely
- Uses your real browser session
- No bot detection issues
- Only needs manual setup once every ~30 days

### **Setup Instructions**:

#### **Step 1: Export Cookies**

1. Open **Chrome/Firefox** (not in incognito!)
2. Navigate to: https://pro.stockx.com/purchasing/orders
3. **Log in normally** (if not already logged in)
4. Press **F12** to open Developer Tools
5. Go to **Console** tab
6. Paste this script and press **Enter**:

```javascript
// Export StockX cookies
(function() {
  const cookies = document.cookie.split('; ').map(c => {
    const [name, value] = c.split('=');
    return {
      name,
      value: decodeURIComponent(value),
      domain: '.stockx.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'Lax'
    };
  });
  
  console.log('📦 Cookies exported! Copy the text below:');
  console.log('─'.repeat(60));
  console.log(JSON.stringify(cookies, null, 2));
  console.log('─'.repeat(60));
  
  // Auto-download
  const blob = new Blob([JSON.stringify(cookies, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stockx-cookies.json';
  a.click();
  URL.revokeObjectURL(url);
  
  console.log('✅ File downloaded as stockx-cookies.json');
})();
```

7. A file `stockx-cookies.json` will download automatically
8. **Copy this file** to your project root:
   ```bash
   cp ~/Downloads/stockx-cookies.json "/Users/theomanzinali/Code scrapping price /"
   ```

#### **Step 2: Test Locally**

```bash
# Make sure cookies file exists
ls -la stockx-cookies.json

# Restart dev server
npm run dev
```

1. Open http://localhost:3000
2. Click **"🍪 Via Cookies"** button
3. Enter your `CRON_SECRET` (from `.env.local`)
4. Click **Refresh**

**Expected Output**:
```json
{
  "success": true,
  "message": "Token refreshed successfully (via cookies)!",
  "tokenPreview": "eyJhbGciOiJSUzI1NiIs...",
  "expiresAt": "2026-01-04T12:00:00.000Z",
  "method": "cookies"
}
```

#### **Step 3: Deploy to Vercel**

1. **Upload cookies to Vercel**:
   - Go to Vercel Dashboard → Your Project → Storage
   - Or use Vercel Blob/KV to store cookies
   - **OR** Base64 encode cookies and store as env var:

```bash
# Encode cookies
cat stockx-cookies.json | base64 > stockx-cookies.b64

# Add to Vercel env vars:
STOCKX_COOKIES_BASE64=<paste contents of stockx-cookies.b64>
```

2. **Update the cookies route** to read from env var:
   - Modify `/app/api/auth/refresh-stockx-token-cookies/route.ts`
   - Read `process.env.STOCKX_COOKIES_BASE64`
   - Decode and parse cookies

3. **Update Vercel cron** to use cookie method:
   - Modify `/app/api/cron/refresh-token/route.ts`
   - Change endpoint to `/api/auth/refresh-stockx-token-cookies`

---

## 🤖 Method 2: Automated Login (Currently Blocked by PerimeterX)

### **Why This Doesn't Work Yet**:
- PerimeterX bot detection at network level
- Blocks Puppeteer before page loads
- Manual stealth techniques not sufficient

### **What We Tried**:
- ✅ Manual stealth (hide `navigator.webdriver`, mock plugins)
- ✅ Realistic user-agent and viewport
- ✅ Delays and human-like typing
- ❌ Still blocked by TLS/HTTP2 fingerprinting

### **Potential Solutions** (Advanced):

#### **Option A: Residential Proxies**
- Use proxy services like:
  - Bright Data (formerly Luminati)
  - Oxylabs
  - SmartProxy
- Rotate IPs to avoid fingerprinting
- **Cost**: $300-500/month for reliable service

#### **Option B: Playwright with Firefox**
- Switch from Puppeteer (Chromium) to Playwright with Firefox
- Different fingerprint
- Might avoid detection temporarily

#### **Option C: Puppeteer Real Browser**
- Use `puppeteer-real-browser` package
- Patches Chromium to remove automation signals
- More resource-intensive

---

## 🛠️ Current Setup Files

| File | Purpose | Status |
|------|---------|--------|
| `/app/api/auth/refresh-stockx-token/route.ts` | Automated login (Puppeteer) | ⚠️ Blocked |
| `/app/api/auth/refresh-stockx-token-cookies/route.ts` | Cookie-based refresh | ✅ Ready |
| `/app/api/cron/refresh-token/route.ts` | Vercel cron job | ✅ Ready |
| `vercel.json` | Cron schedule (every 10 hours) | ✅ Configured |
| `export-stockx-cookies.js` | Browser script to export cookies | ✅ Ready |

---

## 🔄 Cookie Refresh Frequency

**How often do cookies expire?**
- StockX session cookies typically last **30-90 days**
- You'll need to manually re-export cookies when they expire

**How to automate cookie refresh?**
- Set up a monthly reminder to re-export cookies
- Or implement a "login popup" in your app (see below)

---

## 💡 Future Enhancement: Manual Login Popup

If you want a **semi-automated** solution:

1. **App detects expired token**
2. **Shows popup**: "Please log in to StockX"
3. **Opens new window**: `https://accounts.stockx.com/login`
4. **User logs in manually** (bypasses bot detection)
5. **App captures token** from redirect/network
6. **Token saved to DB**

This gives you the best of both worlds:
- ✅ No monthly cookie export
- ✅ Bypasses bot detection
- ⚠️ Requires manual interaction every 10 hours

---

## 🚀 Recommended Path Forward

### **Phase 1: Use Cookie Method (NOW)**
1. Export cookies manually
2. Test locally with "🍪 Via Cookies" button
3. Deploy to Vercel with cookies in env var
4. Set reminder to refresh cookies monthly

### **Phase 2: Monitor & Optimize**
1. Track token refresh success rate
2. Set up alerts when token expires
3. Consider manual popup if cookies expire frequently

### **Phase 3: Explore Advanced Solutions (LATER)**
1. Test Playwright with Firefox
2. Evaluate proxy costs vs. manual effort
3. Consider `puppeteer-real-browser` if budget allows

---

## 📞 Support

If you encounter issues:

1. **Check debug files**: `/debug/*.html` and `/debug/*.png`
2. **Check Vercel logs**: Real-time logs in Vercel dashboard
3. **Test locally first**: Always verify locally before deploying
4. **Cookie expiration**: Re-export cookies if refresh fails

---

## 🔒 Security Notes

- ✅ Cookies stored as env vars (encrypted)
- ✅ CRON_SECRET protects refresh endpoints
- ✅ Token stored in Postgres (not exposed)
- ⚠️ Don't commit `stockx-cookies.json` to git (already in `.gitignore`)
