-- CreateTable
CREATE TABLE "OrderMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "shopifyProductTitle" TEXT NOT NULL,
    "shopifySku" TEXT,
    "shopifySizeEU" TEXT,
    "shopifyTotalPrice" REAL NOT NULL,
    "shopifyCurrencyCode" TEXT NOT NULL DEFAULT 'CHF',
    "stockxOrderNumber" TEXT NOT NULL,
    "stockxProductName" TEXT NOT NULL,
    "stockxSizeEU" TEXT,
    "stockxSkuKey" TEXT,
    "matchConfidence" TEXT NOT NULL,
    "matchScore" REAL NOT NULL,
    "matchType" TEXT NOT NULL,
    "matchReasons" TEXT NOT NULL,
    "timeDiffHours" REAL,
    "stockxStatus" TEXT NOT NULL,
    "stockxEstimatedDelivery" TEXT,
    "lastStatusCheck" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shopifyMetafieldsSynced" BOOLEAN NOT NULL DEFAULT false,
    "shopifyMetafieldsSetAt" DATETIME,
    "supplierCost" REAL NOT NULL,
    "marginAmount" REAL NOT NULL,
    "marginPercent" REAL NOT NULL,
    "manualCostOverride" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderMatch_shopifyLineItemId_key" ON "OrderMatch"("shopifyLineItemId");

-- CreateIndex
CREATE INDEX "OrderMatch_shopifyOrderId_idx" ON "OrderMatch"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderMatch_stockxOrderNumber_idx" ON "OrderMatch"("stockxOrderNumber");

-- CreateIndex
CREATE INDEX "OrderMatch_shopifyMetafieldsSynced_idx" ON "OrderMatch"("shopifyMetafieldsSynced");

-- CreateIndex
CREATE INDEX "OrderMatch_lastStatusCheck_idx" ON "OrderMatch"("lastStatusCheck");
