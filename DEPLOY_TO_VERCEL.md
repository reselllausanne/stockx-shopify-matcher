# 🚀 Deploy to Vercel - 5 Simple Steps

## Your app will work 24/7 at a URL like: `yourapp.vercel.app`

---

## **Step 1: Create GitHub Repository**

```bash
# In terminal:
cd "/Users/theomanzinali/Code scrapping price "

# Add all changes
git add .

# Commit
git commit -m "✅ Ready for production"

# Create repo on GitHub.com (name it: stockx-shopify-tracker)
# Then push:
git remote add origin https://github.com/YOUR_USERNAME/stockx-shopify-tracker.git
git branch -M main
git push -u origin main
```

---

## **Step 2: Sign up for Vercel**

1. Go to: **https://vercel.com**
2. Click "Sign Up"
3. Choose "Continue with GitHub"
4. Authorize Vercel to access your repos

**COST: FREE** (Hobby plan includes everything you need)

---

## **Step 3: Import Your Project**

1. On Vercel dashboard, click **"Add New" → "Project"**
2. Find your `stockx-shopify-tracker` repo
3. Click **"Import"**
4. Vercel will auto-detect Next.js ✅

---

## **Step 4: Add Environment Variables**

In the Vercel project settings, add these **EXACT** variables:

### **Database (Supabase)**
```bash
DATABASE_URL=postgresql://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-0-eu-central-1.pooler.supabase.com:6543/postgres

DIRECT_URL=postgresql://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

### **Shopify**
```bash
SHOPIFY_ADMIN_ACCESS_TOKEN=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

SHOPIFY_SHOP_DOMAIN=tdfuture.myshopify.com
```

### **Supabase (optional)**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://nhxgqbqzevbblhlgfffb.supabase.co

NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeGdxYnF6ZXZiYmxobGdmZmZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY0MzYwODAsImV4cCI6MjA1MjAxMjA4MH0.2K-zJT36nxELYaKj4SVlaTbxQa8zy9Cm92GRXBmhMAA
```

**How to add them:**
- In Vercel project → **Settings** → **Environment Variables**
- Add each one, click **"Add"**
- Select **"Production", "Preview", "Development"** for all

---

## **Step 5: Deploy!**

1. Click **"Deploy"** button
2. Wait 2-3 minutes
3. You'll get a URL like: `yourapp.vercel.app`

**DONE! Your app is now live 24/7!** 🎉

---

## **✅ After Deployment**

### **Access Your App**
- **Main page:** `https://yourapp.vercel.app`
- **Dashboard:** `https://yourapp.vercel.app/dashboard`
- **Expenses:** `https://yourapp.vercel.app/expenses`
- **Financial:** `https://yourapp.vercel.app/financial`

### **Works Even When:**
- ❌ Your computer is off
- ❌ Cursor is closed
- ❌ Terminal is closed
- ✅ **It's always online!**

### **Database is SAME**
- Uses the **SAME Supabase database** as localhost
- All your data is already there
- No migration needed

### **StockX Token**
- You'll still need to manually update the StockX token every 10-12 hours
- Just paste it in the app like you do on localhost

---

## **💰 Costs**

### **Vercel** - FREE
- Hobby plan: $0/month
- Unlimited deployments
- 100 GB bandwidth
- Automatic HTTPS

### **Supabase** - FREE
- 500 MB database
- 2 GB bandwidth
- Unlimited API requests
- Automatic backups

**TOTAL: $0/month** (until you scale to thousands of orders)

---

## **🔄 How to Update After Deployment**

```bash
# Make changes in code
# Then:
git add .
git commit -m "Updated feature X"
git push

# Vercel automatically redeploys! (30 seconds)
```

---

## **📱 AppSheet Still Works**

AppSheet connects directly to **Supabase**, not Vercel.

So it works the same whether you're on localhost OR Vercel!

**Connection info stays the same:**
- Host: `db.nhxgqbqzevbblhlgfffb.supabase.co`
- Port: `5432`
- Database: `postgres`
- User: `postgres.nhxgqbqzevbblhlgfffb`
- Password: `Noelia.701.Noelia`
- Schema: `public`

---

## **🎯 Summary**

**Before:** Works only when laptop is on + terminal is open  
**After:** Works 24/7 from anywhere in the world

**Steps:** GitHub → Vercel → Add env vars → Deploy  
**Time:** 15 minutes  
**Cost:** FREE  

**Your data stays in Supabase** (same database for localhost & Vercel)

