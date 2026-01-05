export interface NormalizedSupplierOrder {
  supplierOrderNumber: string;
  purchaseDate: string; // ISO
  offerAmount: number | null;
  totalTTC: number | null;
  productTitle: string;
  productName?: string; // Optional: original product name (for workers)
  skuKey: string;
  sizeEU: string | null;
  statusKey: string | null;
  statusTitle: string | null;
  currencyCode: string | null;
  estimatedDeliveryDate?: string | null; // Optional: ISO date (for workers)
  productVariantId?: string; // Optional: for pricing queries (for workers)
}

export interface ShopifyLineItem {
  shopifyOrderId: string;
  orderName: string;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string | null;
  customerEmail: string | null;
  customerName: string | null;
  shippingCountry: string | null;
  shippingCity: string | null;
  lineItemId: string;
  title: string;
  sku: string | null;
  variantTitle: string | null;
  quantity: number;
  price: string;
  totalPrice: string;
  currencyCode: string;
  sizeEU: string | null;
}

export interface MatchCandidate {
  supplierOrder: NormalizedSupplierOrder;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  timeDiffHours: number;
  overThreshold: boolean;
}

export interface MatchResult {
  shopifyItem: ShopifyLineItem;
  bestMatch: MatchCandidate | null;
  allCandidates: MatchCandidate[];
}

const THRESHOLD_HOURS = 96; // 4 days

// Fear of God Essentials SKUs in stock (do not match)
const EXCLUDED_SKUS = [
  // Light Heather Gray
  "192HO246258F-XS", "192HO246258F-S", "192HO246258F-M",
  "192HO246258F-L", "192HO246258F-XL", "192HO246258F-XXL",
  // Black FW24
  "192HO246250F-XXS", "192HO246250F-XS", "192HO246250F-S",
  "192HO246250F-M", "192HO246250F-L", "192HO246250F-XL", "192HO246250F-XXL",
];

function cleanShopifyTitleForMatch(title: string): string {
  return title
    // Remove trailing size: " - 49.5", " - EU 49.5", etc.
    .replace(/\s*-\s*(EU\s*)?\d+(\.\d+)?\s*$/i, "")
    // Remove trailing %
    .replace(/\s*%\s*$/i, "")
    .trim();
}

function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ") // normalize spaces
    .replace(/[^\w\s-]/g, ""); // remove special chars except dash
}

function productNameMatch(name1: string, name2: string): boolean {
  const n1 = normalizeProductName(name1);
  const n2 = normalizeProductName(name2);
  
  // Exact match after normalization
  if (n1 === n2) return true;
  
  // For LEGO: very strict match (contains same core name)
  if (n1.includes("lego") && n2.includes("lego")) {
    // Extract main part (remove "lego" prefix and compare rest)
    const legoName1 = n1.replace(/^lego\s*/i, "").trim();
    const legoName2 = n2.replace(/^lego\s*/i, "").trim();
    return legoName1 === legoName2 || legoName1.includes(legoName2) || legoName2.includes(legoName1);
  }
  
  // For regular products: very strict similarity (>95% word overlap)
  // Ignore pure numeric tokens (like "49.5") to avoid false negatives
  const words1 = new Set(
    n1.split(/\s+/).filter(w => w.length > 2 && !/^\d+(\.\d+)?$/.test(w))
  );
  const words2 = new Set(
    n2.split(/\s+/).filter(w => w.length > 2 && !/^\d+(\.\d+)?$/.test(w))
  );
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  const similarity = union.size > 0 ? intersection.size / union.size : 0;
  return similarity >= 0.95; // 95% match required
}

function sizeMatch(size1: string | null, size2: string | null): boolean {
  if (!size1 || !size2) {
    console.log(`[SIZE_MATCH] One or both sizes are null: "${size1}" vs "${size2}"`);
    return false;
  }
  
  // Normalize: remove "EU" prefix, spaces, uppercase
  const normalize = (size: string) => {
    return size
      .replace(/^EU\s*/i, "") // Remove "EU" prefix
      .replace(/\s/g, "") // Remove spaces
      .toUpperCase();
  };
  
  const s1 = normalize(size1);
  const s2 = normalize(size2);
  
  const matches = s1 === s2;
  console.log(`[SIZE_MATCH] Comparing: "${size1}" (normalized: "${s1}") vs "${size2}" (normalized: "${s2}") → ${matches ? "✅ MATCH" : "❌ NO MATCH"}`);
  
  return matches;
}

function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1.0;
  
  // Simple word overlap scoring
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

function calculateTimeDiff(shopifyDate: string, supplierDate: string): number {
  const d1 = new Date(shopifyDate).getTime();
  const d2 = new Date(supplierDate).getTime();
  return Math.abs(d1 - d2) / (1000 * 60 * 60); // hours
}

function scoreTimeProximity(hours: number): number {
  if (hours <= 24) return 20;
  if (hours <= 48) return 15;
  if (hours <= 96) return 10;
  return 0;
}

/**
 * 🔐 CAUSAL HARD FILTER: Supplier order MUST be created AFTER Shopify order
 * 
 * Logic: In dropshipping model:
 * 1. Customer places Shopify order (sale)
 * 2. You buy from Supplier to fulfill it (purchase)
 * 
 * Therefore: supplierCreated MUST be >= shopifyCreated (with small tolerance for clock skew)
 * 
 * @param shopifyDate - Shopify order creation date (ISO)
 * @param supplierDate - Supplier order creation date (ISO)
 * @param toleranceMinutes - Allow small clock skew (default 5 minutes)
 * @returns true if causal order is valid (Supplier after Shopify)
 */
function isValidCausalOrder(
  shopifyDate: string, 
  supplierDate: string,
  toleranceMinutes: number = 5
): boolean {
  const shopifyTime = new Date(shopifyDate).getTime();
  const supplierTime = new Date(supplierDate).getTime();
  const toleranceMs = toleranceMinutes * 60 * 1000;
  
  // Supplier must be created AFTER Shopify (with tolerance for clock skew)
  // If Supplier is more than 5 minutes BEFORE Shopify → INVALID
  const isValid = supplierTime >= (shopifyTime - toleranceMs);
  
  if (!isValid) {
    const diffMinutes = (shopifyTime - supplierTime) / (1000 * 60);
    console.log(
      `[CAUSAL] ❌ REJECTED: Supplier order created ${diffMinutes.toFixed(1)} minutes ` +
      `BEFORE Shopify order (violates dropship causality)`
    );
  }
  
  return isValid;
}

export function matchShopifyToSupplier(
  shopifyItem: ShopifyLineItem,
  supplierOrders: NormalizedSupplierOrder[]
): MatchResult {
  // Check exclusions
  const isExcluded = EXCLUDED_SKUS.includes(shopifyItem.sku || "");
  const isLiquidation = /%/.test(shopifyItem.title); // More robust: % anywhere

  if (isExcluded) {
    console.log(`[SKIP] Fear of God in stock: ${shopifyItem.sku}`);
    return {
      shopifyItem,
      bestMatch: null,
      allCandidates: [],
    };
  }

  // Liquidation products: never auto-match, return empty for manual only
  if (isLiquidation) {
    console.log(`[SKIP] Liquidation (manual only): ${shopifyItem.title}`);
    return {
      shopifyItem,
      bestMatch: null,
      allCandidates: [],
    };
  }

  const candidates: MatchCandidate[] = [];

  // Clean Shopify title (remove size suffix like " - 49.5")
  const shopifyTitleClean = cleanShopifyTitleForMatch(shopifyItem.title);
  if (shopifyTitleClean !== shopifyItem.title) {
    console.log(`[CLEAN] "${shopifyItem.title}" → "${shopifyTitleClean}"`);
  }

  for (const supplierOrder of supplierOrders) {
    const reasons: string[] = [];

    // HARD FILTER 1: Product name must match 100% (or 95%+ strict)
    const nameMatches = productNameMatch(shopifyTitleClean, supplierOrder.productTitle);
    if (!nameMatches) {
      continue; // Skip this candidate entirely
    }
    reasons.push("✅ Product name strict match (≥95%)");

    // HARD FILTER 2: Size must match 100% (if both have sizes)
    // EXCEPTION: LEGO products have no sizes, skip size validation entirely
    const isLEGO = shopifyItem.title.toLowerCase().includes("lego") || supplierOrder.productTitle.toLowerCase().includes("lego");
    
    if (isLEGO) {
      // LEGO products: No size validation at all
      reasons.push("🧱 LEGO (no size required)");
      console.log(`[MATCH] 🧱 LEGO product detected - skipping size validation`);
    } else {
      // Non-LEGO products: Strict size validation
      const shopifySize = shopifyItem.sizeEU || shopifyItem.variantTitle;
      const supplierSize = supplierOrder.sizeEU;
      
      console.log(`[MATCH] Size comparison: Shopify "${shopifySize}" (sizeEU: "${shopifyItem.sizeEU}", variantTitle: "${shopifyItem.variantTitle}") vs Supplier "${supplierSize}"`);
      
      const sizeMatches = sizeMatch(shopifySize, supplierSize);
      
      // For products with sizes (sneakers, clothing) - MUST match or skip
      if (shopifySize && supplierSize) {
        if (!sizeMatches) {
          console.log(`[MATCH] ❌ Size mismatch: Shopify "${shopifySize}" vs Supplier "${supplierSize}" - SKIPPING`);
          continue; // Different sizes = skip candidate
        }
        reasons.push("✅ Size 100% match");
      } else if (!shopifySize && !supplierSize) {
        // Both have no size (accessories) = OK
        reasons.push("✅ No size required");
      } else {
        // One has size, other doesn't - this is suspicious for sneakers!
        console.log(`[MATCH] ⚠️ Size data incomplete: Shopify "${shopifySize}" vs Supplier "${supplierSize}" - SKIPPING for safety`);
        continue; // Skip if only one has size data
      }
    }

    // HARD FILTER 3: Causal order (StockX must be AFTER Shopify)
    // In dropshipping: Customer orders first (Shopify), then you buy to fulfill (StockX)
    // Prevents matching wrong orders based on time proximity alone
    const isValidCausal = isValidCausalOrder(
      shopifyItem.createdAt,
      supplierOrder.purchaseDate,
      5 // 5 minutes tolerance for clock skew
    );
    
    if (!isValidCausal) {
      console.log(
        `[MATCH] ❌ CAUSAL VIOLATION: Supplier order ${supplierOrder.supplierOrderNumber} ` +
        `created BEFORE Shopify order ${shopifyItem.orderName} - SKIPPING`
      );
      continue; // Skip candidates that violate causality
    }
    
    reasons.push("✅ Valid causal order");

    // Now candidate passed ALL hard filters, calculate score for ranking

    // Time proximity (main differentiator)
    const timeDiffHours = calculateTimeDiff(
      shopifyItem.createdAt,
      supplierOrder.purchaseDate
    );
    
    let score = 0;
    
    // Base score for passing filters
    score += 100;
    
    // Time score (0-50 points) - main way to differentiate duplicates
    if (timeDiffHours <= 1) {
      score += 50;
      reasons.push("⏱️ Within 1 hour");
    } else if (timeDiffHours <= 6) {
      score += 45;
      reasons.push("⏱️ Within 6 hours");
    } else if (timeDiffHours <= 24) {
      score += 40;
      reasons.push("⏱️ Within 24 hours");
    } else if (timeDiffHours <= 48) {
      score += 30;
      reasons.push("⏱️ Within 48 hours");
    } else if (timeDiffHours <= 96) {
      score += 20;
      reasons.push("⏱️ Within 4 days");
    } else {
      score += 5;
      const timeDiffDays = (timeDiffHours / 24).toFixed(1);
      reasons.push(`⚠️ ${timeDiffDays} days apart (over threshold)`);
    }

    // Optional SKU validation (bonus +10 points)
    if (shopifyItem.sku && supplierOrder.skuKey) {
      const shopifySKU = shopifyItem.sku.trim().toUpperCase();
      const supplierSKU = supplierOrder.skuKey.trim().toUpperCase();

      if (shopifySKU === supplierSKU) {
        score += 10;
        reasons.push("🔐 SKU exact match (bonus)");
      } else if (
        shopifySKU.includes(supplierSKU) ||
        supplierSKU.includes(shopifySKU)
      ) {
        score += 5;
        reasons.push("🔐 SKU partial match (bonus)");
      }
    }

    const overThreshold = timeDiffHours > THRESHOLD_HOURS;

    // Determine confidence
    let confidence: "high" | "medium" | "low";
    if (score >= 140 && !overThreshold) confidence = "high"; // name+size+time<24h+sku
    else if (score >= 120 && !overThreshold) confidence = "high"; // name+size+time<48h
    else if (score >= 100) confidence = "medium"; // name+size match but time>4d
    else confidence = "low";

    candidates.push({
      supplierOrder,
      score,
      confidence,
      reasons,
      timeDiffHours,
      overThreshold,
    });
  }

  // Sort by score descending (time proximity will be main differentiator)
  candidates.sort((a, b) => b.score - a.score);

  let bestMatch = candidates.length > 0 ? candidates[0] : null;
  
  // 🔐 AMBIGUITY DETECTION: If top1 and top2 scores are too close, downgrade to MEDIUM
  // This prevents auto-matching when there's uncertainty between multiple candidates
  if (bestMatch && candidates.length >= 2) {
    const top1Score = candidates[0].score;
    const top2Score = candidates[1].score;
    const scoreDiff = top1Score - top2Score;
    
    // If scores are within 10 points of each other → ambiguous
    if (scoreDiff < 10 && bestMatch.confidence === "high") {
      console.log(
        `[MATCH] ⚠️ AMBIGUOUS: Top 2 candidates have close scores ` +
        `(${top1Score} vs ${top2Score}, diff: ${scoreDiff}) - downgrading to MEDIUM for manual review`
      );
      
      // Downgrade confidence to force manual review
      bestMatch = {
        ...bestMatch,
        confidence: "medium",
        reasons: [
          ...bestMatch.reasons,
          `⚠️ Ambiguous (top2 score diff: ${scoreDiff})`
        ]
      };
    }
  }

  return {
    shopifyItem,
    bestMatch,
    allCandidates: candidates,
  };
}

