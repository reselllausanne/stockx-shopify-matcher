# 🔧 Auto-Sync Troubleshooting Guide

## Issue: "0 auto-set" even though matches exist

### What I Fixed:

1. ✅ **Existing matches now auto-sync too**
   - Before: Only NEW matches got metafields set
   - After: Existing matches in DB that aren't synced will be auto-set

2. ✅ **Better logging**
   - See exactly why each order was skipped
   - Shows number of Shopify items vs StockX orders
   - Detailed matching logs

---

## How to Debug "All Orders Skipped"

### **Step 1: Check Server Console Logs**

When you click "🔄 Sync New Orders", open your **terminal** (where `npm run dev` is running) and look for:

```
[SYNC] Found X Shopify line items
[SYNC] Found Y StockX orders
[SYNC] Matching X Shopify items with Y StockX orders...
```

**If you see**:
- `Found 0 Shopify line items` → Shopify API issue (see below)
- `Found 0 StockX orders` → StockX API issue (see below)
- Both > 0 but all skipped → Matching issue (see below)

---

### **Step 2: Check Why Orders Are Skipped**

For **each** Shopify order, you'll see one of these:

#### **A) No match found**
```
[SYNC] 🔍 Matching: #4769 - New Balance 1906A (Size: EU 44.5)
[SYNC] ⏭️ No match found for #4769 - New Balance 1906A (skipping)
```
**Reason**: No StockX order matches this product + size
**Solution**: Check if you actually bought this on StockX, or if the product name/size is different

#### **B) MEDIUM/LOW confidence match**
```
[SYNC] ✅ Match found: #4769 → 03-XXX (MEDIUM, score: 105)
[SYNC] ⏭️ Skipping MEDIUM confidence match (only HIGH auto-synced)
```
**Reason**: Match found but confidence too low
**Solution**: Review manually in UI and override if correct

#### **C) HIGH confidence - will process**
```
[SYNC] ✅ Match found: #4769 → 03-XXX (HIGH, score: 175)
[SYNC] 🚀 HIGH confidence - will auto-process
```
**This is what you want!**

#### **D) Already exists, not synced → will auto-sync**
```
[SYNC] 📋 Match exists in DB: #4769 → 03-XXX (synced: false)
[SYNC] 🆕 Metafields not yet synced - auto-setting now...
[SYNC] ✅ Metafields auto-set for existing match: #4769
```
**This is the NEW behavior!** Matches in DB that weren't synced will be auto-synced now.

#### **E) Already synced, no changes**
```
[SYNC] 📋 Match exists in DB: #4769 → 03-XXX (synced: true)
[SYNC] ✅ Already synced, no changes: #4769
```
**Normal** - nothing to do.

---

## Common Issues & Fixes

### **Issue 1: "Found 0 Shopify line items"**

**Causes**:
- Shopify API error
- No paid orders in last 30 days
- All orders already fulfilled

**Check**:
1. Look for error message before this log
2. Check `.env.local` has correct:
   - `SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com`
   - `SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxx`
3. Verify token has `read_orders` permission

**Test Shopify API manually**:
```bash
curl http://localhost:3000/api/shopify/orders
```

---

### **Issue 2: "Found 0 StockX orders"**

**Causes**:
- StockX token expired (tokens expire after ~12 hours)
- StockX API error
- No pending orders on StockX

**Check**:
1. Get fresh token from StockX Pro:
   - Go to https://pro.stockx.com/purchasing/orders
   - Open DevTools (F12) → Network tab
   - Refresh page
   - Find `graphql` request
   - Copy `Authorization: Bearer XXX` token
2. Paste in token field (top of page)

**Test StockX API manually**:
```bash
curl -X POST http://localhost:3000/api/stockx \
  -H "Content-Type: application/json" \
  -d '{"token":"YOUR_TOKEN","operationName":"Buying","query":"...", "variables":{}}'
```

---

### **Issue 3: All matches are MEDIUM/LOW (not HIGH)**

**After the size matching fix**, matching is now **stricter**:
- Product name must match 100%
- Size must match 100% (EU format)
- If sizes don't match → SKIP (not even MEDIUM)

**Example of what gets SKIPPED now**:
- Shopify: "New Balance 1906A Tech Explosion" size EU 44.5
- StockX: "New Balance 1906A Tech Explosion" size EU 37.5
- **Result**: SKIP (different sizes)

**If legitimate matches are skipped**:
1. Check size extraction in logs
2. Verify sizes actually match
3. Use manual matching override if needed

---

### **Issue 4: Matches in DB but metafields not set**

**THIS IS NOW FIXED!**

**Before**: Had to click "Set Metafields" manually
**After**: Auto-sync will detect and auto-set metafields

**To trigger**:
1. Click "🔄 Sync New Orders"
2. Watch logs for:
   ```
   [SYNC] 📋 Match exists in DB: #4769 (synced: false)
   [SYNC] 🆕 Metafields not yet synced - auto-setting now...
   [SYNC] ✅ Metafields auto-set for existing match
   ```

---

## Expected Console Output (Success)

```
[SYNC] Found 50 Shopify line items
[SYNC] Found 25 StockX orders
[SYNC] Matching 50 Shopify items with 25 StockX orders...

[SYNC] Processing: #4769 - New Balance 1906A Tech Explosion
[SYNC] 🔍 Matching: #4769 (Size: EU 44.5)
[SYNC] ✅ Match found: #4769 → 03-XXX (HIGH, score: 175)
[SYNC] 🚀 HIGH confidence - will auto-process
[SYNC] 📋 Match exists in DB: #4769 → 03-XXX (synced: false)
[SYNC] 🆕 Metafields not yet synced - auto-setting now...
[SYNC] 📤 Auto-setting Shopify metafields...
[SYNC] ✅ Metafields auto-set for existing match: #4769

[SYNC] Processing: #4770 - Nike Air Force 1
[SYNC] 🔍 Matching: #4770 (Size: EU 42)
[SYNC] ⏭️ No match found for #4770 (skipping)

[SYNC] Processing: #4771 - Jordan 1 High
[SYNC] 🔍 Matching: #4771 (Size: EU 43)
[SYNC] ✅ Match found: #4771 → 03-YYY (MEDIUM, score: 105)
[SYNC] ⏭️ Skipping MEDIUM confidence match

[SYNC] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SYNC] ✅ SYNC COMPLETE
[SYNC] 📊 Results:
[SYNC]   - Total Shopify items: 50
[SYNC]   - Total StockX orders: 25
[SYNC]   - New matches: 0
[SYNC]   - Updated: 0
[SYNC]   - Auto-set metafields: 1  ← ✅ THIS!
[SYNC]   - Skipped: 49
[SYNC] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Alert popup**:
```
✅ Auto-Sync Complete!

Processed 50 orders: 0 new matches, 0 updates, 1 auto-set
```

---

## Quick Checklist

Before running auto-sync, verify:

- [ ] Server is running (`npm run dev`)
- [ ] StockX token is fresh (<12 hours old)
- [ ] Token is pasted in input field
- [ ] `.env.local` has Shopify credentials
- [ ] Terminal is visible to see console logs
- [ ] You have unfulfilled paid orders on Shopify
- [ ] You have pending/active orders on StockX
- [ ] Product names match between Shopify and StockX
- [ ] Sizes match (EU format)

---

## Testing the Fix

### **Test 1: Fresh Start (No DB data)**

```bash
# Clear database
sqlite3 dev.db "DELETE FROM OrderMatch;"

# Run auto-sync
Click "🔄 Sync New Orders"

# Expected:
# - HIGH confidence matches → Auto-set metafields
# - Alert shows "X auto-set"
# - DB has new records with shopifyMetafieldsSynced: true
```

### **Test 2: Existing Matches (Not synced)**

```bash
# You already have matches in DB from manual matching
# but shopifyMetafieldsSynced: false

# Run auto-sync
Click "🔄 Sync New Orders"

# Expected:
# - Console shows "Metafields not yet synced - auto-setting now"
# - Alert shows "X auto-set"
# - DB updated: shopifyMetafieldsSynced: true
```

### **Test 3: Verify on Shopify**

```bash
# After auto-sync shows "X auto-set":

1. Go to Shopify Admin → Orders
2. Open an order that was matched
3. Scroll to "Metafields" section
4. Should see:
   - supplier.order_number: 03-XXX
   - supplier.status: SELLER_SHIPPED
   - supplier.estimated_delivery: 2026-01-15
   - supplier.total_cost: 169.34
   - supplier.margin_amount: 69.66
   - supplier.margin_percent: 29.15
```

---

## Still Not Working?

### **Share these logs**:

1. **Terminal output** (entire sync log)
2. **Browser console** (F12 → Console tab)
3. **API response** (from Network tab)
4. **Database query**:
   ```bash
   sqlite3 dev.db "SELECT shopifyOrderName, stockxOrderNumber, matchConfidence, shopifyMetafieldsSynced FROM OrderMatch LIMIT 10;"
   ```

---

## Summary of Changes

| Scenario | Before | After |
|----------|--------|-------|
| NEW HIGH match | ✅ Auto-set | ✅ Auto-set (same) |
| Existing match (not synced) | ❌ Manual | ✅ Auto-set (FIXED!) |
| Existing match (synced) | ✅ Skip | ✅ Skip (same) |
| Status changed | ✅ Auto-update | ✅ Auto-update (same) |
| MEDIUM/LOW | ❌ Skip | ❌ Skip (same) |

**Key Fix**: Existing matches in DB that weren't synced will now be auto-synced! 🎉

