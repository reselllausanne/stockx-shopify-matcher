# 📊 Dashboard Guide - StockX Order Matching

## 🚀 Quick Start (Localhost)

### 1. Start Dev Server
```bash
cd "/Users/theomanzinali/Code scrapping price "
npm run dev
```

### 2. Go to Dashboard
```
http://localhost:3000/dashboard
```

### 3. First Time Setup - Create Test Data
If you see "No margin data available":

**Click "🧪 Create Test Data"** → Dashboard will populate with sample data instantly!

---

## 📖 How It Works

### **Data Flow:**
```
1. Match Orders (Main Page /)
   ↓
2. Click "Sync New Orders" 
   ↓
3. OrderMatch records created in DB
   ↓
4. OrderMetric records auto-created for dashboard
   ↓
5. Dashboard shows charts & analytics! 📊
```

---

## 🔄 Syncing Data to Dashboard

### **Option 1: Automatic (Recommended)**
```
Main Page → Click "Sync New Orders" 
→ Dashboard auto-updates!
```

### **Option 2: Manual Sync**
```
Dashboard → Click "🔄 Sync to Dashboard"
→ Syncs from OrderMatch to OrderMetric
```

### **Option 3: Create Test Data**
```
Dashboard → Click "🧪 Create Test Data"
→ Creates 10 days of sample data
→ See dashboard working immediately!
```

### **Option 4: Recover from Shopify**
```
Dashboard → Click "🛟 Recover from Shopify"
→ Reads supplier metafields from Shopify
→ Reconstructs margin data from metafields
→ Use if local DB is lost!
```

---

## 📊 Dashboard Features

### **Summary Cards:**
- 💰 **Total Sales**: Sum of all order revenues
- 📈 **Total Margin**: Sum of all profit amounts  
- % **Overall Margin**: Overall profit percentage

### **Chart:**
- **Blue Bars**: Daily margin amounts (CHF)
- **Green Line**: Daily margin percentages (%)
- **Hover Tooltip**: Shows exact values + order count per day

### **Period Selector:**
- Last 7 days
- Last 30 days (default)
- Last 90 days
- Last year

---

## 🐛 Troubleshooting

### **"Failed to fetch margin metrics"**

**Cause**: Dev server not running or API error

**Fix**:
1. Check if dev server is running: `npm run dev`
2. Check browser console (F12) for error details
3. Check terminal for API errors
4. Try "🧪 Create Test Data" to test dashboard

---

### **"No margin data available"**

**Cause**: No OrderMetric records in database

**Fix Options**:
1. **Quick Test**: Click "🧪 Create Test Data" (instant sample data)
2. **From DB**: Click "🔄 Sync to Dashboard" (if you have OrderMatch records)
3. **From Shopify**: Click "🛟 Recover from Shopify" (if metafields exist)
4. **Match Orders**: Go to main page → match orders → sync

---

### **"Network error - is dev server running?"**

**Cause**: Dev server crashed or not started

**Fix**:
```bash
# Kill any existing process on port 3000
lsof -ti:3000 | xargs kill -9

# Start fresh
cd "/Users/theomanzinali/Code scrapping price "
npm run dev
```

---

### **"OrderMetric table not found"**

**Cause**: Database schema not migrated

**Fix**:
```bash
cd "/Users/theomanzinali/Code scrapping price "
DATABASE_URL="file:./dev.db" npx prisma db push
DATABASE_URL="file:./dev.db" npx prisma generate
```

---

## 🌐 Vercel Deployment

### **Prerequisites:**
1. Vercel account connected to GitHub repo
2. PostgreSQL database (not SQLite)
3. Environment variables set in Vercel

### **Environment Variables (Vercel Dashboard):**
```
DATABASE_URL=postgresql://user:password@host:5432/dbname
SHOPIFY_SHOP_DOMAIN=your-shop.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=your-token
SHOPIFY_API_VERSION=2024-10
CRON_SECRET=your-secret
STOCKX_COOKIES_BASE64=your-base64-cookies (optional)
```

### **Deploy:**
```bash
git push origin main
# Vercel auto-deploys
```

### **After Deploy:**
1. Go to: `https://your-app.vercel.app/dashboard`
2. Click "🧪 Create Test Data" to test
3. Or sync from main page: `https://your-app.vercel.app`

---

## 📁 Database Models

### **OrderMetric** (Dashboard Data):
```prisma
model OrderMetric {
  shopifyOrderId String   @id
  createdAt      DateTime
  grossSales     Float    // Total revenue
  marginChf      Float    // Profit amount
  marginPct      Float    // Profit percentage
  currency       String
  updatedAt      DateTime @updatedAt
}
```

### **OrderMatch** (Matching Results):
```prisma
model OrderMatch {
  id                      String
  shopifyOrderId          String
  shopifyOrderName        String
  stockxOrderNumber       String
  supplierCost            Float
  marginAmount            Float
  marginPercent           Float
  shopifyMetafieldsSynced Boolean
  // ... more fields
}
```

---

## 🔗 API Endpoints

### **GET /api/metrics/margin?days=30**
- Fetches dashboard metrics for last N days
- Returns: totals + daily series data
- Used by: Dashboard page

### **POST /api/metrics/sync**
- Syncs OrderMatch → OrderMetric
- Creates/updates dashboard records
- Used by: "Sync to Dashboard" button

### **POST /api/metrics/recover-from-shopify**
- Reads Shopify order metafields
- Reconstructs OrderMetric records
- Used by: "Recover from Shopify" button

### **POST /api/metrics/test-data**
- Creates sample OrderMetric records
- 10 days of realistic test data
- Used by: "Create Test Data" button

### **POST /api/sync/new-orders**
- Matches Shopify + StockX orders
- Creates OrderMatch + OrderMetric records
- Auto-sets Shopify metafields
- Used by: "Sync New Orders" button on main page

---

## 💡 Tips & Best Practices

### **For Development:**
1. Use "Create Test Data" to see dashboard working immediately
2. Check browser console (F12) for detailed error messages
3. Check terminal for API logs
4. Use relative URLs (e.g., `/api/metrics/margin`) - works on localhost & Vercel

### **For Production:**
1. Set up PostgreSQL database (not SQLite)
2. Configure all environment variables in Vercel
3. Test with "Create Test Data" first
4. Then sync real orders
5. Monitor Vercel logs for errors

### **Data Backup:**
1. Shopify metafields = permanent backup
2. Use "Recover from Shopify" if DB is lost
3. Regular database backups (if using Postgres)

---

## 🎯 Common Workflows

### **Daily Use:**
```
1. Match new orders on main page
2. Click "Sync New Orders"
3. Dashboard auto-updates!
```

### **Testing Dashboard:**
```
1. Click "🧪 Create Test Data"
2. See charts & metrics!
3. Experiment with period selector
```

### **After DB Loss:**
```
1. Click "🛟 Recover from Shopify"
2. Wait for recovery to complete
3. Dashboard restored from metafields!
```

### **Debugging Issues:**
```
1. Check browser console (F12)
2. Check terminal logs
3. Try "Create Test Data" to isolate issue
4. Check if dev server is running
```

---

## ✅ Success Checklist

- [ ] Dev server runs: `npm run dev`
- [ ] Dashboard loads: `http://localhost:3000/dashboard`
- [ ] Test data works: Click "🧪 Create Test Data"
- [ ] Charts display correctly
- [ ] Period selector changes data
- [ ] Manual sync works: Click "🔄 Sync to Dashboard"
- [ ] Auto-sync works: Main page → "Sync New Orders"
- [ ] Vercel deployment successful
- [ ] Production dashboard accessible

---

## 🆘 Still Having Issues?

### **Check These:**
1. **Is dev server running?** → `npm run dev`
2. **Is port 3000 available?** → `lsof -ti:3000 | xargs kill -9`
3. **Are dependencies installed?** → `npm install`
4. **Is Prisma client generated?** → `npx prisma generate`
5. **Is database migrated?** → `npx prisma db push`

### **Debugging Steps:**
1. Open browser console (F12)
2. Look for error messages in red
3. Check terminal for API errors
4. Try "Create Test Data" - if this works, issue is with data sync
5. If "Create Test Data" fails, issue is with API/database

---

## 📚 Additional Resources

- **Main App**: `http://localhost:3000` - Match orders
- **Dashboard**: `http://localhost:3000/dashboard` - View analytics
- **Prisma Studio**: `npx prisma studio` - View database
- **API Docs**: See `/app/api/` folder for all endpoints

---

**🎉 You're all set! The dashboard should now work perfectly on localhost and Vercel!**

