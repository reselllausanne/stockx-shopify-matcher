# ⚡ Supabase Migration - Quick Command Reference

## 🎯 **TL;DR - Copy/Paste These Commands**

### **1. Update .env.local**

```bash
cat > .env.local << 'EOF'
DATABASE_URL="postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true"
DIRECT_URL="postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=require"
SHOPIFY_ADMIN_ACCESS_TOKEN="your_token"
SHOPIFY_SHOP_DOMAIN="your-shop.myshopify.com"
SHOPIFY_API_VERSION="2024-10"
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
NEXT_PUBLIC_SUPABASE_URL="https://nhxgqbqzevbblhlgfffb.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeGdxYnF6ZXZiYmxobGdmZmZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NjU1NTMsImV4cCI6MjA4MzA0MTU1M30.28hHQDWBg_b6c5_4Is3DtOHk87H1ndg6g4w-4b7HVyM"
EOF
```

**Then manually add your actual `SHOPIFY_ADMIN_ACCESS_TOKEN` and `SHOPIFY_SHOP_DOMAIN`.**

---

### **2. Run Migration**

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name init_supabase_postgres

# Seed database
npm run db:seed

# Start dev server
npm run dev
```

---

### **3. Verify**

```bash
# Test health check
curl http://localhost:3000/api/health

# Test categories endpoint
curl http://localhost:3000/api/expenses/categories

# Open app
open http://localhost:3000
```

---

### **4. Check Supabase Dashboard**

1. Go to: https://supabase.com/dashboard/project/nhxgqbqzevbblhlgfffb
2. Click "Table Editor"
3. Verify 6 tables exist in `public` schema:
   - StockXToken
   - OrderMatch
   - OrderMetric
   - ExpenseCategory
   - PaymentAccount
   - PersonalExpense

---

### **5. Deploy to Vercel**

```bash
# Add env vars in Vercel Dashboard first, then:
git add .
git commit -m "feat: migrate to Supabase PostgreSQL"
git push origin main

# Run migrations on production (after first deploy)
export DATABASE_URL="postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true"
export DIRECT_URL="postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=require"

npx prisma migrate deploy
npm run db:seed
```

---

### **6. Test Production**

```bash
curl https://your-app.vercel.app/api/health
```

---

## ❌ **If Something Goes Wrong**

```bash
# Reset database (⚠️ deletes all data)
npx prisma migrate reset

# Reseed
npm run db:seed

# Check migration status
npx prisma migrate status

# Check Prisma Client
npx prisma generate
```

---

## 📋 **Vercel Environment Variables**

Add these in Vercel Dashboard → Settings → Environment Variables:

```
DATABASE_URL=postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true

DIRECT_URL=postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=require

SHOPIFY_ADMIN_ACCESS_TOKEN=your_token
SHOPIFY_SHOP_DOMAIN=your-shop.myshopify.com
SHOPIFY_API_VERSION=2024-10
NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://nhxgqbqzevbblhlgfffb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeGdxYnF6ZXZiYmxobGdmZmZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NjU1NTMsImV4cCI6MjA4MzA0MTU1M30.28hHQDWBg_b6c5_4Is3DtOHk87H1ndg6g4w-4b7HVyM
```

Set for: **Production**, **Preview**, and **Development** environments.

---

## ✅ **Success Criteria**

You're done when:
- ✅ `/api/health` returns `{"status":"healthy"}`
- ✅ `/api/expenses/categories` returns 22 categories
- ✅ Supabase Dashboard shows 6 tables in `public` schema
- ✅ AppSheet can see all tables
- ✅ Existing order matching/dashboard works

---

**For detailed explanations, see `SUPABASE_MIGRATION.md`**

