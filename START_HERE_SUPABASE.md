# 🎯 START HERE - Supabase Migration

## ✅ **Migration Status: READY TO RUN**

All code changes are complete. Your app is ready to migrate from SQLite to Supabase PostgreSQL.

---

## 🚀 **What to Do Now (5 minutes)**

### **Step 1: Update .env.local**

Create or update `.env.local` with these values:

```bash
DATABASE_URL="postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true"

DIRECT_URL="postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=require"

# Add your existing Shopify credentials
SHOPIFY_ADMIN_ACCESS_TOKEN="your_token"
SHOPIFY_SHOP_DOMAIN="your-shop.myshopify.com"
SHOPIFY_API_VERSION="2024-10"

NEXT_PUBLIC_BASE_URL="http://localhost:3000"
NEXT_PUBLIC_SUPABASE_URL="https://nhxgqbqzevbblhlgfffb.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeGdxYnF6ZXZiYmxobGdmZmZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NjU1NTMsImV4cCI6MjA4MzA0MTU1M30.28hHQDWBg_b6c5_4Is3DtOHk87H1ndg6g4w-4b7HVyM"
```

### **Step 2: Run Migration Commands**

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Create and apply migration to Supabase
npx prisma migrate dev --name init_supabase_postgres

# Seed with default categories and accounts
npm run db:seed

# Start development server
npm run dev
```

### **Step 3: Verify It Works**

```bash
# Test health check
curl http://localhost:3000/api/health

# Test expense categories
curl http://localhost:3000/api/expenses/categories

# Open app
open http://localhost:3000
```

**Success:** If `/api/health` returns `{"status":"healthy"}`, you're done! 🎉

---

## 📊 **What Changed in Your Code**

### **1. prisma/schema.prisma**
- Changed `provider` from `"sqlite"` to `"postgresql"`
- Added `directUrl = env("DIRECT_URL")` for migrations
- Added `schemas = ["public"]` for AppSheet compatibility
- Added `@@schema("public")` to all 6 models

### **2. package.json**
- Added `"postinstall": "prisma generate"` for Vercel builds
- Added `"prisma:deploy": "prisma migrate deploy"` for production migrations

### **3. All API Routes**
- ✅ No changes required!
- ✅ All existing code is PostgreSQL-compatible
- ✅ Prisma Client handles the database differences

---

## ✅ **What You Get**

- **Vercel Support:** Deploy to production with serverless functions
- **AppSheet Integration:** Access database directly from mobile app
- **Connection Pooling:** Efficient for serverless (pgbouncer)
- **Automatic Backups:** Daily backups by Supabase
- **Scalability:** Handle thousands of orders
- **SQL Access:** Query database from Supabase Dashboard

---

## 📚 **Documentation**

1. **`SUPABASE_QUICK_START.md`** - Quick command reference (read this first!)
2. **`SUPABASE_MIGRATION.md`** - Detailed migration guide
3. **`SUPABASE_MIGRATION_COMPLETE.md`** - Complete technical summary

---

## 🚨 **Troubleshooting**

### **Can't connect to database?**
```bash
# Test connection directly
psql "postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=require"
```

### **Migration fails?**
```bash
# Check migration status
npx prisma migrate status

# Reset and retry (⚠️ deletes data)
npx prisma migrate reset
npm run db:seed
```

### **Need to start fresh?**
```bash
# Drop all tables in Supabase Dashboard → SQL Editor
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

# Then re-run migrations
npx prisma migrate dev
npm run db:seed
```

---

## 🎯 **Next Steps After Migration Works**

1. **Verify Supabase Dashboard:**
   - Go to https://supabase.com/dashboard/project/nhxgqbqzevbblhlgfffb
   - Check "Table Editor" shows 6 tables

2. **Deploy to Vercel:**
   - See `SUPABASE_MIGRATION.md` → "Vercel Deployment" section

3. **Connect AppSheet:**
   - See `SUPABASE_MIGRATION.md` → "AppSheet Integration" section

---

## ⚡ **TL;DR - Just Run This**

```bash
# Create .env.local with DATABASE_URL and DIRECT_URL (see Step 1 above)

npm install
npx prisma generate
npx prisma migrate dev --name init_supabase_postgres
npm run db:seed
npm run dev

# Test
curl http://localhost:3000/api/health
```

**That's it!** 🚀

---

**Questions? Check `SUPABASE_MIGRATION.md` for detailed explanations.**

