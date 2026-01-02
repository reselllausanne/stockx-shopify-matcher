# 🔑 StockX Token Refresh Guide

## 🚨 Problem: PerimeterX Bot Detection

StockX uses **PerimeterX (HUMAN Security)** which blocks automated browser logins by detecting:
- Headless browser fingerprints
- Non-human behavior patterns
- Automated scripts

**Error you see**: "Appuyez et maintenez pour confirmer que vous êtes un humain"

---

## ✅ **SOLUTION: Cookie-Based Authentication (RECOMMENDED)**

Instead of automating the login, we **reuse cookies** from your manual login session.

### **How It Works**:
1. You login manually in Chrome (once)
2. Export your cookies
3. App reuses cookies → **bypasses login completely!**
4. No bot detection, 100% reliable

### **Step-by-Step Instructions**:

#### **1️⃣ Login to StockX**
```bash
# Open Chrome and go to:
https://pro.stockx.com/purchasing/orders

# Login normally with your credentials
```

#### **2️⃣ Export Cookies**
```bash
# In Chrome:
# 1. Press F12 (open DevTools)
# 2. Go to "Console" tab
# 3. Copy-paste the entire content of: export-stockx-cookies.js
# 4. Press Enter
# 5. Cookies will be copied to clipboard
```

#### **3️⃣ Save Cookies File**
```bash
# In your project root, create:
stockx-cookies.json

# Paste the clipboard content (the JSON array)
```

Example `stockx-cookies.json`:
```json
[
  {
    "name": "_pxvid",
    "value": "abc123...",
    "domain": ".stockx.com",
    "path": "/",
    "expires": 1767999999,
    "httpOnly": false,
    "secure": true,
    "sameSite": "Lax"
  },
  {
    "name": "stockx_session",
    "value": "xyz789...",
    "domain": ".stockx.com",
    "path": "/",
    "expires": 1767999999,
    "httpOnly": true,
    "secure": true,
    "sameSite": "Lax"
  }
]
```

#### **4️⃣ Test Cookie-Based Refresh**

**In your app** (localhost:3000):
- Click **"🍪 Refresh via Cookies"** button
- Should see: ✅ "Token refreshed successfully!"

**Via API directly**:
```bash
curl -X POST http://localhost:3000/api/auth/refresh-stockx-token-cookies \
  -H "Content-Type: application/json" \
  -d '{"cronSecret":"test123"}'
```

#### **5️⃣ Automate on Vercel**

Update `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-token-cookies",
      "schedule": "0 */10 * * *"
    }
  ]
}
```

Create `/app/api/cron/refresh-token-cookies/route.ts`:
```typescript
import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  
  const response = await fetch(`${baseUrl}/api/auth/refresh-stockx-token-cookies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cronSecret: process.env.CRON_SECRET }),
  });

  const data = await response.json();
  return NextResponse.json(data);
}
```

---

## 📊 Cookie vs Login Comparison

| Method | Pros | Cons | Reliability |
|--------|------|------|-------------|
| **🍪 Cookies** | ✅ No bot detection<br>✅ Fast (3-5s)<br>✅ 100% success | ⚠️ Expires ~7 days<br>⚠️ Manual refresh needed | ⭐⭐⭐⭐⭐ |
| **🔓 Login** | ✅ No manual steps<br>✅ Fully automated | ❌ Bot detection<br>❌ PerimeterX blocks<br>❌ Slow (30-60s) | ⭐⭐ (blocked) |

---

## 🔄 Cookie Expiration Handling

Cookies typically expire after **7 days**. When they expire:

### **Option A: Manual Refresh (Simple)**
1. Get notification/error
2. Login manually
3. Re-export cookies
4. Deploy

### **Option B: Auto-Fallback (Advanced)**
```typescript
// Try cookie-based first
const cookieResult = await refreshViaCookies();

if (cookieResult.error?.includes("expired")) {
  // Send email/Slack notification
  await notifyAdmin("StockX cookies expired - please refresh");
}
```

### **Option C: Cookie Rotation (Enterprise)**
- Store cookies from multiple accounts
- Rotate on expiry
- Auto-detect and switch

---

## 🐛 Troubleshooting

### **"Missing cookies file"**
```bash
# Make sure file exists:
ls stockx-cookies.json

# Should show: stockx-cookies.json
```

### **"Cookies expired"**
Browser redirects to login page → cookies no longer valid.

**Fix**: Login manually and re-export.

### **"No token captured"**
Cookies are valid but no API calls made.

**Fix**: Wait longer (increase delay) or navigate to different page:
```typescript
await delay(8000); // Wait 8 seconds instead of 5
```

### **"401 Unauthorized"**
Wrong CRON_SECRET.

**Fix**: Check `.env.local`:
```bash
CRON_SECRET=your-secret-here
```

---

## 🚀 Deployment Checklist

- [ ] `stockx-cookies.json` created locally
- [ ] `.gitignore` includes `stockx-cookies.json` (don't commit!)
- [ ] Tested locally: **🍪 Refresh via Cookies** button works
- [ ] Upload cookies to Vercel:
  ```bash
  # Option 1: Use Vercel Environment Variables
  # In Vercel dashboard: Add STOCKX_COOKIES_JSON = <paste contents>
  
  # Option 2: Use Vercel Blob Storage (recommended)
  # Upload via Vercel CLI or dashboard
  ```
- [ ] Updated cron job to use cookie endpoint
- [ ] Test cron job manually in Vercel dashboard
- [ ] Set calendar reminder to refresh cookies every 6 days

---

## 📅 Maintenance Schedule

| Task | Frequency | Time Required |
|------|-----------|---------------|
| Refresh cookies | Every 6-7 days | 2 minutes |
| Verify token working | Daily (auto) | 0 minutes |
| Check logs | Weekly | 5 minutes |

---

## ❓ FAQ

### **Q: Why not use stealth plugins?**
**A**: PerimeterX is very sophisticated. Even with stealth plugins, it often detects automation. Cookies bypass this entirely.

### **Q: Can I automate cookie extraction?**
**A**: Not reliably. Chrome/Puppeteer sandbox restrictions prevent reading cookies across sessions. Manual export is the most reliable method.

### **Q: What if I have 2FA enabled?**
**A**: Cookies work perfectly with 2FA! Just login with 2FA manually, then export cookies.

### **Q: Will this work on Vercel?**
**A**: Yes! Just store cookies as:
- Environment variable (small)
- Vercel Blob Storage (recommended)
- External secret manager (enterprise)

### **Q: How long does cookie refresh take?**
**A**: 3-5 seconds (vs 30-60s for login automation)

---

## 🎯 Next Steps

1. **Today**: Export cookies, test locally
2. **This Week**: Deploy to Vercel with cookie-based refresh
3. **Ongoing**: Refresh cookies every 6 days (2 min task)

**Questions?** Check logs in `/debug/` folder or terminal output.

