# 🗄️ Database Management Guide

## Overview
Your matches are stored in a local SQLite database (`dev.db`) using Prisma ORM. This ensures data persistence and avoids re-matching every time.

---

## ✅ What Data is Saved

### **Automatic Saves (HIGH confidence only)**
When you click **"🔄 Sync New Orders"**:
- ✅ Only HIGH confidence matches are saved to DB
- ✅ Metafields automatically set on Shopify
- ✅ Status tracked for future updates

### **Manual Saves**
When you click **"Set Metafields"** on a matched order:
- ✅ Manual matches ARE saved to DB (including MEDIUM/LOW)
- ✅ Manual cost overrides are stored
- ✅ Match type is marked as "manual" (if manually selected)

---

## 🗑️ How to Remove Bad Data

### **Method 1: Delete via UI (Easiest)**

1. Click **"📂 Load from Database"**
2. Find the bad match in the table
3. Click **"🗑️ Delete"** button in the "Actions" column
4. Confirm deletion
5. ✅ Match removed from database

### **Method 2: Delete via API**

**Delete single match** (by ID):
```bash
curl -X DELETE http://localhost:3000/api/db/delete-match \
  -H "Content-Type: application/json" \
  -d '{"id": "YOUR_MATCH_ID"}'
```

**Delete single match** (by Shopify line item ID):
```bash
curl -X DELETE http://localhost:3000/api/db/delete-match \
  -H "Content-Type: application/json" \
  -d '{"shopifyLineItemId": "gid://shopify/LineItem/..."}'
```

**Batch delete multiple matches**:
```bash
curl -X POST http://localhost:3000/api/db/delete-match \
  -H "Content-Type: application/json" \
  -d '{"ids": ["match-id-1", "match-id-2", "match-id-3"]}'
```

**Delete ALL matches** (⚠️ USE WITH CAUTION):
```bash
curl -X POST http://localhost:3000/api/db/delete-match \
  -H "Content-Type: application/json" \
  -d '{"deleteAll": true}'
```

### **Method 3: Direct Database Access**

**Install Prisma Studio** (visual DB editor):
```bash
npx prisma studio
```
This opens a web UI at `http://localhost:5555` where you can:
- View all matches
- Edit records
- Delete records
- Run queries

**Or use SQLite CLI**:
```bash
sqlite3 dev.db

# View all matches
SELECT * FROM OrderMatch;

# Delete specific match
DELETE FROM OrderMatch WHERE id = 'your-match-id';

# Delete by Shopify order
DELETE FROM OrderMatch WHERE shopifyOrderName = '#4213';

# Delete all MEDIUM confidence matches
DELETE FROM OrderMatch WHERE matchConfidence = 'medium';

# Exit
.exit
```

---

## 🔄 How DB Updates Work (Upsert)

### **What is Upsert?**
Upsert = **Update** if exists, **Insert** if new

### **Key Field**
- Database uses `shopifyLineItemId` as unique identifier
- If a match with that line item ID exists → **UPDATE** existing record
- If not → **CREATE** new record

### **Example Flow**

**First time matching:**
```
Shopify Line Item: gid://shopify/LineItem/123456
→ Not in DB → CREATE new record
```

**Re-matching same item (status changed):**
```
Shopify Line Item: gid://shopify/LineItem/123456
→ Already in DB → UPDATE existing record:
  - stockxStatus: "SELLER_SHIPPED" → "DELIVERED"
  - lastStatusCheck: updated
  - stockxEstimatedDelivery: updated
```

**Result**: ✅ Only ONE record per Shopify line item (no duplicates)

---

## 📊 Database Schema

```prisma
model OrderMatch {
  id                      String   @id @default(uuid())
  shopifyOrderId          String   // gid://shopify/Order/...
  shopifyOrderName        String   // #4213
  shopifyLineItemId       String   @unique  // 🔑 UNIQUE KEY
  shopifyProductTitle     String
  shopifySku              String?
  shopifySizeEU           String?
  shopifyTotalPrice       Float
  shopifyCurrencyCode     String   @default("CHF")
  
  stockxOrderNumber       String   // 03-XXX
  stockxProductName       String
  stockxSizeEU            String?
  stockxSkuKey            String?
  
  matchConfidence         String   // "high", "medium", "low"
  matchScore              Float
  matchType               String   // "auto", "manual"
  matchReasons            String   // JSON array
  timeDiffHours           Float
  
  stockxStatus            String   // "ORDER_CREATED", "SELLER_SHIPPED", etc.
  stockxEstimatedDelivery String?
  
  shopifyMetafieldsSynced Boolean  @default(false)
  shopifyMetafieldsSetAt  DateTime?
  
  supplierCost            Float
  marginAmount            Float
  marginPercent           Float
  manualCostOverride      Float?
  
  lastStatusCheck         DateTime @default(now())
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  
  @@index([shopifyOrderName])
  @@index([stockxOrderNumber])
  @@index([matchConfidence])
}
```

---

## 🤖 Auto-Sync Behavior

### **Sync New Orders** (`/api/sync/new-orders`)

**What it does:**
1. Fetches all recent Shopify orders (paid, last 30 days)
2. Fetches all StockX orders (pending/active)
3. Runs matching algorithm on each Shopify item
4. **IF HIGH confidence match**:
   - Check if already in DB (by `shopifyLineItemId`)
   - If exists → Check if status changed → Update DB + Shopify metafields
   - If new → Save to DB + Auto-set Shopify metafields
5. **IF MEDIUM/LOW confidence**:
   - ⏭️ Skip (not saved, not synced)

**Result**: Only HIGH confidence matches auto-saved and auto-synced

### **Check Status Updates** (`/api/sync/status-check`)

**What it does:**
1. Loads ALL matches from DB
2. For each match:
   - Query StockX for current status
   - If status changed → Update DB + Update Shopify metafields
   - If no change → Update `lastStatusCheck` timestamp

**Result**: Keeps Shopify metafields in sync with StockX status

---

## 🔧 Manual Overrides

### **Manual Match Override**
When you use **"Manual Matching Override"**:
1. ✅ Stored in memory state (`manualOverrides`)
2. ❌ NOT automatically saved to DB
3. ✅ Saved to DB when you click **"Set Metafields"**

**To clear manual overrides:**
- Click **"🗑️ Clear All"** button (appears when overrides exist)

### **Manual Cost Override**
When you enter a manual cost:
1. ✅ Stored in memory state (`manualCostOverrides`)
2. ✅ Saved to DB when you click **"Set Metafields"**
3. ✅ Used instead of StockX TTC pricing

---

## ✅ Data Consistency Guarantees

### **Scenario 1: Status Changes**
```
StockX status: ORDER_CREATED → SELLER_SHIPPED
↓
Auto-sync detects change
↓
Updates DB: stockxStatus = "SELLER_SHIPPED"
↓
Updates Shopify metafield: supplier.status = "SELLER_SHIPPED"
```

**Result**: ✅ DB and Shopify always in sync

### **Scenario 2: Manual Metafield Update**
If you manually update a metafield in Shopify admin:
- ❌ DB won't detect this change
- ⚠️ Next status check will overwrite with DB value

**Recommendation**: Always use the app to update metafields

### **Scenario 3: Deleting from DB**
When you delete a match from DB:
- ✅ Removed from local database
- ❌ Shopify metafields remain unchanged
- ⚠️ Next auto-sync may re-match (if still HIGH confidence)

**To prevent re-matching after delete:**
- Fulfill the Shopify order (won't be fetched)
- Or add exclusion logic (e.g., specific SKU patterns)

---

## 📝 Best Practices

### **1. Regular Status Checks**
Set up cron to call `/api/sync/status-check` every 30-60 minutes:
```bash
# Add to crontab
*/30 * * * * curl -X POST http://localhost:3000/api/sync/status-check \
  -H "Content-Type: application/json" \
  -d '{"stockxToken": "YOUR_TOKEN"}'
```

### **2. Clean Up Old Matches**
Periodically delete delivered orders:
```bash
# Using SQLite CLI
sqlite3 dev.db
DELETE FROM OrderMatch WHERE stockxStatus = 'DELIVERED' AND createdAt < date('now', '-30 days');
```

### **3. Backup Database**
```bash
# Backup before making changes
cp dev.db dev.db.backup

# Restore if needed
cp dev.db.backup dev.db
```

### **4. Review MEDIUM Matches**
MEDIUM matches are skipped by auto-sync. Review them manually:
1. Click "Load Shopify Orders"
2. Look for MEDIUM confidence matches
3. Manually confirm or override
4. Click "Set Metafields" to save

### **5. Monitor Manual Overrides**
- Manual overrides persist in memory only (until page reload)
- Click "Set Metafields" to save them permanently
- Use "Clear All" if you change your mind

---

## 🐛 Troubleshooting

### **Problem: Duplicate matches in DB**
**Cause**: Different `shopifyLineItemId` for same order (e.g., multiple line items)
**Solution**: This is expected! Each line item should have its own match.

### **Problem: Wrong match saved**
**Solution**: 
1. Click "📂 Load from Database"
2. Find the match
3. Click "🗑️ Delete"
4. Re-run matching with fixed logic

### **Problem: Status not updating**
**Causes**:
- Auto-sync not running
- StockX token expired
- Network issue

**Solution**:
1. Check token is valid
2. Manually click "✅ Check Status Updates"
3. Check browser console for errors

### **Problem: Manual override not saving**
**Cause**: You didn't click "Set Metafields"
**Solution**: Manual overrides are only saved when metafields are set.

---

## 🚀 Quick Commands

### **View all matches**
```bash
sqlite3 dev.db "SELECT shopifyOrderName, stockxOrderNumber, matchConfidence, stockxStatus FROM OrderMatch;"
```

### **Count matches by confidence**
```bash
sqlite3 dev.db "SELECT matchConfidence, COUNT(*) FROM OrderMatch GROUP BY matchConfidence;"
```

### **Find matches needing TTC pricing**
```bash
sqlite3 dev.db "SELECT * FROM OrderMatch WHERE manualCostOverride IS NULL;"
```

### **Delete all MEDIUM/LOW confidence**
```bash
sqlite3 dev.db "DELETE FROM OrderMatch WHERE matchConfidence IN ('medium', 'low');"
```

---

## 📊 Summary

| Action | Where Saved | When Saved | Auto-Sync |
|--------|-------------|------------|-----------|
| HIGH confidence match | DB + Shopify | Immediately | ✅ Yes |
| MEDIUM/LOW match | Memory only | Manual "Set Metafields" | ❌ No |
| Manual override | Memory only | Manual "Set Metafields" | ❌ No |
| Manual cost | Memory only | Manual "Set Metafields" | ❌ No |
| Status change | DB + Shopify | Auto-detected | ✅ Yes |
| Delete match | DB only | Immediately | N/A |

**Key Takeaway**: 
- ✅ HIGH matches = Fully automatic
- ⚠️ MEDIUM/LOW = Manual review required
- 🗑️ Delete = UI button or API call
- 🔄 Updates = Always upsert (no duplicates)

