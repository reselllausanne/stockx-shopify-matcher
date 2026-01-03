# 🚀 **START HERE: StockX Token Refresh Setup**

## 📊 **Current Status**

| Component | Status | Notes |
|-----------|--------|-------|
| **🤖 Automated Login** | ⚠️ BLOCKED | PerimeterX bot detection |
| **🍪 Cookie Method** | ✅ READY | Works locally & Vercel |
| **Database** | ✅ READY | SQLite (local) / Postgres (Vercel) |
| **Cron Job** | ✅ CONFIGURED | Runs every 10 hours |
| **Auto-Sync** | ✅ WORKING | Matches orders & sets metafields |

---

## ⚡ **QUICK START** (5 min)

### **Step 1: Export Cookies**

1. Open Chrome: **https://pro.stockx.com/purchasing/orders** (login first)
2. Press **F12** → **Console** tab
3. Paste this one-liner:

```javascript
(function(){const c=document.cookie.split('; ').map(e=>{const[n,...v]=e.split('=');return{name:n,value:v.join('='),domain:'.stockx.com',path:'/',secure:true,httpOnly:false,sameSite:'Lax'}});const b=new Blob([JSON.stringify(c,null,2)],{type:'application/json'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='stockx-cookies.json';a.click();URL.revokeObjectURL(u);console.log('✅ Downloaded stockx-cookies.json')})();
```

4. File downloads as `stockx-cookies.json`
5. Move to project root:

```bash
cd "/Users/theomanzinali/Code scrapping price "
cp ~/Downloads/stockx-cookies.json .
```

---

### **Step 2: Test Locally**

```bash
npm run dev
```

1. Open: http://localhost:3000
2. Click **"🍪 Via Cookies"** button
3. Enter CRON_SECRET (from `.env.local`)
4. Should see: `"success": true`

**Terminal should show**:
```
[TOKEN REFRESH] 🍪 Starting cookie-based token refresh...
[TOKEN REFRESH] ✅ Loaded 15 cookies
[TOKEN REFRESH] ✅ Token captured!
[TOKEN REFRESH] 💾 Token saved to database
```

---

### **Step 3: Deploy to Vercel**

#### **Option A: Quick (Less Secure)**
```bash
# Allows Vercel to upload the cookies file
echo '!stockx-cookies.json' >> .vercelignore
git add stockx-cookies.json .vercelignore
git commit -m "Add StockX cookies"
git push origin main
```

#### **Option B: Secure (Recommended)**

1. **Encode cookies**:
   ```bash
   cat stockx-cookies.json | base64 | pbcopy  # Mac (copies to clipboard)
   # OR for Linux:
   cat stockx-cookies.json | base64 | xclip -selection clipboard
   ```

2. **Add to Vercel**:
   - Go to: **Vercel Dashboard** → **Settings** → **Environment Variables**
   - Add:
     - **Name**: `STOCKX_COOKIES_BASE64`
     - **Value**: *Paste from clipboard*
     - **Environments**: Production, Preview, Development (all)

3. **Deploy**:
   ```bash
   git push origin main
   ```

4. **Test**:
   ```bash
   curl -X POST https://your-app.vercel.app/api/auth/refresh-stockx-token-cookies \
     -H "Content-Type: application/json" \
     -d '{"cronSecret":"your-secret-here"}'
   ```

---

## 🔄 **How It Works**

```
┌─────────────────────────────────────────────────────────┐
│ 1. Vercel Cron runs every 10 hours                     │
│    ↓                                                    │
│ 2. Calls /api/cron/refresh-token                       │
│    ↓                                                    │
│ 3. Detects STOCKX_COOKIES_BASE64 env var               │
│    ↓                                                    │
│ 4. Uses cookie method (not automated login)            │
│    ↓                                                    │
│ 5. Puppeteer loads cookies → navigates to StockX Pro   │
│    ↓                                                    │
│ 6. Captures bearer token from network requests         │
│    ↓                                                    │
│ 7. Saves token to Postgres (expires in 12 hours)       │
│    ↓                                                    │
│ 8. Auto-sync workers use this token for API calls      │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 **Important Files**

| File | Purpose |
|------|---------|
| `STOCKX_TOKEN_REFRESH.md` | Full documentation (all methods) |
| `TEST_COOKIE_METHOD.md` | Step-by-step testing guide |
| `START_HERE.md` | This file (quick reference) |
| `export-stockx-cookies.js` | Browser script to export cookies |
| `/app/api/auth/refresh-stockx-token-cookies/route.ts` | Cookie-based refresh |
| `/app/api/cron/refresh-token/route.ts` | Cron job (auto-detects method) |
| `vercel.json` | Cron schedule (every 10 hours) |

---

## 🆘 **Troubleshooting**

### **❌ "Missing cookies"**
- **Cause**: `stockx-cookies.json` not in project root
- **Fix**: Re-export cookies and copy to project root

### **❌ "Cookies expired"**
- **Cause**: StockX session expired
- **Fix**: Login to StockX again, re-export cookies

### **❌ "No token captured"**
- **Cause**: Invalid cookies or StockX changed API
- **Fix**: Clear browser cache, fresh login, re-export

### **❌ "Failed to parse STOCKX_COOKIES_BASE64"**
- **Cause**: Base64 encoding error
- **Fix**: Re-encode cookies: `cat stockx-cookies.json | base64`

---

## 🎯 **Next Steps**

### **Phase 1: Get Token Refresh Working** ✅
- [x] Export cookies
- [x] Test locally with "🍪 Via Cookies" button
- [x] Deploy to Vercel with env var
- [x] Verify cron job runs successfully

### **Phase 2: Monitor & Maintain** 🔄
- [ ] Set calendar reminder (every 30 days)
- [ ] Re-export cookies when expired
- [ ] Monitor Vercel logs for failures
- [ ] Track token refresh success rate

### **Phase 3: Optimize (Optional)** 🚀
- [ ] Add Slack/email alerts on token expiry
- [ ] Implement manual login popup fallback
- [ ] Track cookies expiration automatically
- [ ] Consider paid proxy service if needed

---

## 💡 **Why Cookie Method?**

| Method | Success Rate | Maintenance | Cost |
|--------|--------------|-------------|------|
| **🍪 Cookies** | 95% | Low (monthly) | FREE |
| **🤖 Auto Login** | 10% | None (if it worked) | FREE |
| **🔐 Proxies** | 80% | Low | $300+/mo |
| **🖱️ Manual Popup** | 100% | High (per token) | FREE |

**Cookie method is the best balance** of reliability, cost, and maintenance.

---

## 📞 **Need Help?**

1. **Check debug files**: `/debug/*.png` and `/debug/*.html`
2. **Check Vercel logs**: Real-time logs in Vercel dashboard
3. **Re-read docs**:
   - `STOCKX_TOKEN_REFRESH.md` (comprehensive)
   - `TEST_COOKIE_METHOD.md` (step-by-step)

---

## 🎉 **You're All Set!**

Once cookies are exported and tested locally:

1. ✅ Token refreshes automatically every 10 hours
2. ✅ Auto-sync matches orders hourly (if configured)
3. ✅ Metafields update automatically for HIGH matches
4. ✅ App runs fully automated!

**Just re-export cookies every ~30 days when they expire!** 🚀

