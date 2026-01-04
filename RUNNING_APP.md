# 🚀 Your App is Running!

## ✅ **Server Status: ACTIVE**

- **Dev Server:** http://localhost:3000
- **Database:** Supabase PostgreSQL (connected ✅)

---

## 🌐 **Working URLs**

### **Main Dashboard**
- **http://localhost:3000/dashboard** ⭐
  - View order metrics
  - See margin analytics
  - Shopify comparison view

### **API Endpoints**

#### Health & Status
- `GET http://localhost:3000/api/health`
  - Check database connectivity
  - Returns: `{"status":"healthy"}`

#### Expense Management (for AppSheet)
- `GET http://localhost:3000/api/expenses/categories`
  - Returns: 22 expense categories
  
- `GET http://localhost:3000/api/expenses/accounts`
  - Returns: 7 payment accounts
  
- `GET http://localhost:3000/api/expenses?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - List expenses with filters
  
- `POST http://localhost:3000/api/expenses`
  - Create new expense
  
- `GET http://localhost:3000/api/expenses/summary?from=&to=`
  - Get aggregated statistics

#### Order Management (existing features)
- `GET http://localhost:3000/api/shopify/orders`
- `POST http://localhost:3000/api/shopify/set-metafields`
- `GET http://localhost:3000/api/stockx`
- `GET http://localhost:3000/api/stockx/pricing`
- `GET http://localhost:3000/api/db/matches`
- `POST http://localhost:3000/api/sync/new-orders`
- `POST http://localhost:3000/api/sync/status-check`

---

## 🏃 **How to Keep Server Running**

### **Option 1: Keep Terminal Open (Current)**
The server is running in the background. Keep your terminal window open.

### **Option 2: Run in Background Permanently**
```bash
cd "/Users/theomanzinali/Code scrapping price "
npm run dev > dev.log 2>&1 &
echo $! > .dev-server.pid
```

### **Option 3: Use Screen/Tmux (Recommended for Production)**
```bash
# Install screen if needed
brew install screen

# Start a named session
screen -S stockx-dev

# Inside screen, start server
cd "/Users/theomanzinali/Code scrapping price "
npm run dev

# Detach: Press Ctrl+A then D
# Reattach later: screen -r stockx-dev
```

---

## 🛑 **How to Stop/Restart Server**

### Stop Server
```bash
pkill -f "next dev"
```

### Restart Server
```bash
cd "/Users/theomanzinali/Code scrapping price "
npm run dev
```

### Check if Running
```bash
curl http://localhost:3000/api/health
# Should return: {"status":"healthy"}
```

---

## 📱 **AppSheet Connection Info**

Your database is ready for AppSheet:

- **Host:** `db.nhxgqbqzevbblhlgfffb.supabase.co`
- **Port:** `5432`
- **Database:** `postgres`
- **User:** `postgres.nhxgqbqzevbblhlgfffb`
- **Password:** `Noelia.701.Noelia`
- **Schema:** `public`

**Tables available:**
1. `StockXToken`
2. `OrderMatch`
3. `OrderMetric`
4. `ExpenseCategory` (22 rows)
5. `PaymentAccount` (7 rows)
6. `PersonalExpense`

---

## 🧪 **Quick Test Commands**

```bash
# Test health
curl http://localhost:3000/api/health

# Test categories
curl http://localhost:3000/api/expenses/categories

# Test accounts
curl http://localhost:3000/api/expenses/accounts

# Open dashboard in browser
open http://localhost:3000/dashboard
```

---

## 📊 **What's Running**

### Local Development Server
- **Port:** 3000
- **Framework:** Next.js 16.1.1 (Turbopack)
- **Runtime:** Node.js
- **Hot Reload:** Enabled ✅

### Database
- **Type:** PostgreSQL (Supabase)
- **Connection:** Pooled (pgbouncer, port 6543)
- **Schema:** `public`
- **Status:** Connected ✅

---

## 🔍 **View Server Logs**

```bash
# If server running in background, check logs
tail -f dev.log

# Or check current terminal
# Server logs appear in the terminal where you ran "npm run dev"
```

---

## ⚡ **Quick Actions**

```bash
# Open dashboard in browser
open http://localhost:3000/dashboard

# Check server status
curl -s http://localhost:3000/api/health | python3 -m json.tool

# View categories (for AppSheet testing)
curl -s http://localhost:3000/api/expenses/categories | python3 -m json.tool

# Restart if needed
pkill -f "next dev" && cd "/Users/theomanzinali/Code scrapping price " && npm run dev
```

---

## 🆘 **Troubleshooting**

### Server won't start
```bash
# Check if port 3000 is in use
lsof -ti:3000

# Kill process on port 3000
kill -9 $(lsof -ti:3000)

# Restart
npm run dev
```

### Can't connect to database
```bash
# Test Supabase connection
psql "postgres://postgres.nhxgqbqzevbblhlgfffb:Noelia.701.Noelia@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=require"
```

### Dashboard shows errors
```bash
# Regenerate Prisma Client
npx prisma generate

# Restart server
pkill -f "next dev" && npm run dev
```

---

**✅ Everything is working! Server is running on http://localhost:3000**

**🎯 Main dashboard: http://localhost:3000/dashboard**

