# 🤖 Fully Automated StockX Token Refresh - Setup Guide

## ⚠️ Important Warnings

1. **Terms of Service**: This automates login to StockX, which may violate their TOS
2. **Account Risk**: Your StockX account could be banned if detected
3. **Personal Use Only**: Do NOT use this for commercial reselling or data scraping at scale
4. **Your Responsibility**: You accept all risks by implementing this

## ✅ What This Does

- **Every 10 hours**: Automatically logs into StockX using Puppeteer
- **Captures bearer token**: From network requests (lasts ~12 hours)
- **Stores in database**: PostgreSQL table for automatic usage
- **Zero manual work**: Your app always has a fresh token

---

## 📋 Required Environment Variables

Add these to your Vercel project (Settings → Environment Variables):

```env
# StockX Credentials (for auto-login)
STOCKX_EMAIL=your-stockx-email@example.com
STOCKX_PASSWORD=your-stockx-password-here

# Cron Security (generate with: openssl rand -base64 32)
CRON_SECRET=randomly-generated-secret-string-here

# Already configured:
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx
DATABASE_URL=postgresql://...
NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app
```

---

## 🚀 Setup Steps

### **Step 1: Generate Cron Secret**

On your Mac terminal:
```bash
openssl rand -base64 32
```

Copy the output (e.g., `K8s9mN3pQ2rT5vX1yZ4aB7cD0eF6gH9j`)

### **Step 2: Add Environment Variables to Vercel**

1. Go to: https://vercel.com/ → Your Project
2. Click **"Settings"** → **"Environment Variables"**
3. Add these:

| Key | Value | Environment |
|-----|-------|-------------|
| `STOCKX_EMAIL` | your-email@example.com | Production, Preview, Development |
| `STOCKX_PASSWORD` | your-password | Production, Preview, Development |
| `CRON_SECRET` | (paste generated secret) | Production, Preview, Development |

### **Step 3: Redeploy**

- Go to **"Deployments"** tab
- Click **"..."** on latest deployment → **"Redeploy"**
- OR just push new code (already configured in vercel.json)

---

## 🧪 Test It Manually

### **Option A: Via API (Local Testing)**

```bash
# Test token refresh locally
curl -X POST http://localhost:3000/api/auth/refresh-stockx-token \
  -H "Content-Type: application/json" \
  -d '{"cronSecret":"your-cron-secret-here"}'
```

Expected output:
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "tokenPreview": "eyJhbGciOiJSUzI1NiIsInR5cCI...",
  "expiresIn": "12 hours"
}
```

### **Option B: Via UI (Add Test Button)**

I'll add a button to your app for manual testing.

---

## ⏰ Cron Schedule

**Configured in `vercel.json`**:
```json
{
  "crons": [{
    "path": "/api/cron/refresh-token",
    "schedule": "0 */10 * * *"
  }]
}
```

**Means**: Every 10 hours (at minute 0)
- Runs at: 00:00, 10:00, 20:00 (midnight, 10am, 8pm)
- Token lasts: 12 hours
- Refresh window: 2 hours before expiry

---

## 🔍 How It Works

### **1. Cron Triggers (Every 10 Hours)**
```
Vercel Cron → GET /api/cron/refresh-token
                    ↓
             Verifies CRON_SECRET
                    ↓
             Calls Token Refresh API
```

### **2. Token Refresh Process**
```
POST /api/auth/refresh-stockx-token
         ↓
1. Launch Puppeteer (headless browser)
2. Navigate to accounts.stockx.com/login
3. Enter STOCKX_EMAIL
4. Enter STOCKX_PASSWORD
5. Click "Log In"
6. Wait for redirect to pro.stockx.com
7. Intercept bearer token from network request
8. Store in PostgreSQL database
9. Close browser
```

### **3. Automatic Token Usage**
```
Your App → Makes StockX API call
              ↓
       Checks database for token
              ↓
       Uses fresh token automatically
       (no manual paste needed!)
```

---

## 📊 Database Schema

**Table: `StockXToken`**
```sql
CREATE TABLE "StockXToken" (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '12 hours'
);
```

Only keeps the **latest token** (old ones deleted on refresh).

---

## 🛠️ Troubleshooting

### **Issue: "Failed to capture bearer token"**

**Causes**:
- StockX changed their login page HTML
- Wrong email/password
- Account requires 2FA (not supported yet)
- Bot detection triggered

**Solutions**:
1. Check credentials in Vercel env vars
2. Disable 2FA on StockX account (if enabled)
3. Check Vercel logs for detailed error

### **Issue: "Operation not permitted" or Puppeteer crash**

**Cause**: Vercel Hobby plan has memory/time limits

**Solutions**:
1. Upgrade to Vercel Pro ($20/month) - Increases timeout to 60s
2. Or use Railway/Render for the cron job
3. Or keep manual token refresh

### **Issue: Token still expires**

**Check**:
1. Vercel Cron logs: Dashboard → Project → Cron Jobs
2. Last execution time
3. Execution status (success/failure)

**If cron isn't running**:
- Vercel Cron requires paid plan ($20/month)
- Alternative: Use cron-job.org (free) to call your endpoint

---

## 💰 Cost Implications

| Service | Free Tier | Paid (if needed) |
|---------|-----------|------------------|
| **Vercel Hosting** | ✅ Included | - |
| **Vercel Cron** | ❌ Requires Pro | $20/month |
| **Database** | Use Railway $5 | Or Vercel $20 |
| **Puppeteer** | ✅ Works on free | May need Pro for reliability |

**Total**: $0 (if no cron) or $20-25/month (fully automated)

---

## 🔒 Security Best Practices

1. **Never commit credentials**: Use environment variables only
2. **Use strong passwords**: Generate unique password for StockX
3. **Rotate secrets**: Change CRON_SECRET periodically
4. **Monitor logs**: Check Vercel logs for suspicious activity
5. **Rate limiting**: Don't call token refresh manually too often

---

## 🆘 If StockX Bans Your Account

**What to do**:
1. Contact StockX support
2. Explain it's for personal order tracking (not reselling)
3. Ask for API access or permission
4. Fall back to manual token refresh (browser extension method)

**Prevention**:
- Don't run refresh more than once per 10 hours
- Use stealth plugin (already configured)
- Add random delays (already configured)

---

## 📈 Next Steps

After this works:
1. ✅ PostgreSQL database setup
2. ✅ Vercel Cron configuration
3. ✅ Test manual refresh
4. ✅ Wait 10 hours, verify automatic refresh
5. ✅ Check Vercel Cron logs
6. ✅ Build your fulfillment team features

---

## 🎉 You're All Set!

Once deployed with environment variables:
- Token refreshes automatically every 10 hours
- Your app always has a fresh token
- No manual work needed!

**Monitor it for the first 24 hours to ensure it's working.**

