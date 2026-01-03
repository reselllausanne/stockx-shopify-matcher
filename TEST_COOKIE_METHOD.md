# 🧪 Test Cookie-Based Token Refresh

## ✅ **QUICK START** (5 minutes)

### **Step 1: Export Cookies** (Manual, once)

1. Open **Chrome** (not incognito!)
2. Navigate to: **https://pro.stockx.com/purchasing/orders**
3. **Log in** if not already logged in
4. Press **F12** (Developer Tools)
5. Click **Console** tab
6. Paste this and press **Enter**:

```javascript
(function(){const c=document.cookie.split('; ').map(e=>{const[n,...v]=e.split('=');return{name:n,value:v.join('='),domain:'.stockx.com',path:'/',secure:true,httpOnly:false,sameSite:'Lax'}});const j=JSON.stringify(c,null,2);const b=new Blob([j],{type:'application/json'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='stockx-cookies.json';a.click();URL.revokeObjectURL(u);console.log('✅ Downloaded stockx-cookies.json')})();
```

7. File **`stockx-cookies.json`** downloads automatically
8. **Move it** to your project root:

```bash
cd "/Users/theomanzinali/Code scrapping price "
cp ~/Downloads/stockx-cookies.json .
ls -la stockx-cookies.json  # Verify it exists
```

---

### **Step 2: Test Locally**

```bash
# Restart dev server
npm run dev
```

1. Open: **http://localhost:3000**
2. Look for the **"🍪 Via Cookies"** button (next to "🤖 Auto-Refresh")
3. Click it
4. Enter your `CRON_SECRET` from `.env.local` (e.g., `test123`)
5. Click **Refresh**

---

### **Step 3: Expected Output**

✅ **SUCCESS** - You'll see:

```json
{
  "success": true,
  "message": "StockX token refreshed using cookies",
  "tokenPreview": "eyJhbGciOiJSUzI1NiIs..."
}
```

Terminal logs:
```
[TOKEN REFRESH] 🍪 Starting cookie-based token refresh...
[BROWSER] Environment: Local (using standard puppeteer)
[TOKEN REFRESH] 📁 Loading cookies from file (local)...
[TOKEN REFRESH] ✅ Loaded cookies from file
[TOKEN REFRESH] ✅ Loaded 15 cookies
[TOKEN REFRESH] 🌐 Launching browser...
[TOKEN REFRESH] 🍪 Cookies applied
[TOKEN REFRESH] 🔄 Navigating to purchasing orders...
[TOKEN REFRESH] ✅ Token captured!
[TOKEN REFRESH] ✅ Token captured successfully!
[TOKEN REFRESH] 💾 Token saved to database
```

❌ **FAILURE** - Common errors:

| Error | Cause | Fix |
|-------|-------|-----|
| "Missing cookies" | File not found | Copy `stockx-cookies.json` to project root |
| "Cookies expired" | Logged out on StockX | Re-login to StockX and re-export cookies |
| "No token captured" | Cookies invalid | Clear browser cache, login fresh, re-export |

---

## 🚀 **Deploy to Vercel**

### **Option A: Upload File (Simple)**

1. Create a `.vercelignore` file (if not exists):
   ```
   # Vercel will upload this file
   !stockx-cookies.json
   ```

2. Deploy:
   ```bash
   git add stockx-cookies.json .vercelignore
   git commit -m "Add StockX cookies for token refresh"
   git push origin main
   ```

⚠️ **Security Note**: This exposes cookies in git. Use Option B for production!

---

### **Option B: Environment Variable (Secure)**

1. **Encode cookies** as base64:
   ```bash
   cat stockx-cookies.json | base64 > stockx-cookies.b64
   cat stockx-cookies.b64 | pbcopy  # Copies to clipboard (Mac)
   # OR manually copy the contents of stockx-cookies.b64
   ```

2. **Add to Vercel**:
   - Go to: **Vercel Dashboard** → **Your Project** → **Settings** → **Environment Variables**
   - Add new variable:
     - **Name**: `STOCKX_COOKIES_BASE64`
     - **Value**: *Paste the base64 string*
     - **Environment**: Production, Preview, Development (all)
   - Click **Save**

3. **Deploy**:
   ```bash
   git push origin main
   # Vercel auto-deploys
   ```

4. **Test on Vercel**:
   ```bash
   curl -X POST https://your-app.vercel.app/api/auth/refresh-stockx-token-cookies \
     -H "Content-Type: application/json" \
     -d '{"cronSecret":"your-secret"}'
   ```

---

## 🔄 **Update Cron to Use Cookie Method**

Edit `/app/api/cron/refresh-token/route.ts`:

<function_calls>
<invoke name="read_file">
<parameter name="target_file">/Users/theomanzinali/Code scrapping price /app/api/cron/refresh-token/route.ts
