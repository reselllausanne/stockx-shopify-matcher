"use client";

import { useState, useEffect } from "react";
import {
  matchShopifyToStockX,
  type NormalizedStockXOrder,
  type ShopifyLineItem,
  type MatchResult,
} from "./utils/matching";

const DEFAULT_QUERY = `query Buying(
  $first: Int
  $after: String
  $currencyCode: CurrencyCode
  $query: String
  $state: BuyingGeneralState
  $sort: BuyingSortInput
  $order: AscDescOrderInput
) {
  viewer {
    buying(
      query: $query
      state: $state
      currencyCode: $currencyCode
      first: $first
      after: $after
      sort: $sort
      order: $order
    ) {
      edges {
        node {
          chainId
          orderId
          orderNumber
          amount
          currencyCode
          purchaseDate
          creationDate
          estimatedDeliveryDateRange {
            estimatedDeliveryDate
            latestEstimatedDeliveryDate
          }
          state {
            statusKey
            statusTitle
          }
          localizedSizeTitle
          localizedSizeType
          productVariant {
            id
            traits {
              size
              sizeDescriptor
            }
            sizeChart {
              baseType
              baseSize
              displayOptions {
                size
                type
              }
            }
            product {
              id
              name
              title
              model
              styleId
              primaryCategory
              productCategory
              contentGroup
              media {
                thumbUrl
              }
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
        totalCount
        startCursor
        hasPreviousPage
      }
    }
  }
}`;

const DEFAULT_VARIABLES = {
  first: 50,
  after: "",
  currencyCode: "CHF",
  query: null,
  state: "PENDING",
  sort: "MATCHED_AT",
  order: "DESC",
};

interface OrderNode {
  chainId: string;
  orderId: string;
  orderNumber: string | null;
  purchaseDate: string | null;
  purchaseDateFormatted: string | null;
  statusKey: string | null;
  statusTitle: string | null;
  amount: number | null;
  currencyCode: string | null;
  productName: string | null;
  productTitle: string | null;
  displayName: string;
  styleId: string | null;
  model: string | null;
  skuKey: string;
  size: string | null;
  sizeType: string | null;
  estimatedDeliveryDate: string | null;
  estimatedDeliveryFormatted: string | null;
  latestEstimatedDeliveryDate: string | null;
  productVariantId: string | null;
  thumbUrl: string | null;
}

interface PricingResult {
  subtotal: number;
  total: number;
  adjustments: { amount: number; text: string; translationKey: string }[];
}

interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
  totalCount: number;
  startCursor: string | null;
  hasPreviousPage: boolean;
}

export default function Home() {
  const [token, setToken] = useState("");
  const [saveToken, setSaveToken] = useState(false);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [variables, setVariables] = useState(
    JSON.stringify(DEFAULT_VARIABLES, null, 2)
  );
  const [stateFilter, setStateFilter] = useState<string>("PENDING");
  const [orders, setOrders] = useState<OrderNode[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);
  const [lastErrors, setLastErrors] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const [pricingByOrder, setPricingByOrder] = useState<Record<string, PricingResult | null>>({});
  const [pricingLoading, setPricingLoading] = useState<Record<string, boolean>>({});
  
  // Shopify matching state
  const [shopifyItems, setShopifyItems] = useState<ShopifyLineItem[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [loadingShopify, setLoadingShopify] = useState(false);
  const [confirmedMatches, setConfirmedMatches] = useState<Record<string, string>>({});
  const [manualOverrides, setManualOverrides] = useState<Record<string, { stockxOrderNumber: string; method: string }>>({});
  
  // Manual matching state
  const [manualShopifyOrder, setManualShopifyOrder] = useState("");
  const [manualStockXOrder, setManualStockXOrder] = useState("");
  const [manualMatchLoading, setManualMatchLoading] = useState(false);
  
  // Metafields state (track which matches have been synced to Shopify)
  const [metafieldsSet, setMetafieldsSet] = useState<Record<string, { timestamp: string; stockxOrderNumber: string }>>({});
  const [metafieldsLoading, setMetafieldsLoading] = useState<Record<string, boolean>>({});
  const [manualCostOverrides, setManualCostOverrides] = useState<Record<string, string>>({});

  // DB + Workers state
  const [dbMatches, setDbMatches] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [statusCheckLoading, setStatusCheckLoading] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<any>(null);
  const [lastStatusCheckResult, setLastStatusCheckResult] = useState<any>(null);

  // Load token from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("stockx_token");
    if (savedToken) {
      setToken(savedToken);
      setSaveToken(true);
    }
  }, []);

  // Save/remove token from localStorage
  useEffect(() => {
    if (saveToken && token) {
      localStorage.setItem("stockx_token", token);
    } else {
      localStorage.removeItem("stockx_token");
    }
  }, [saveToken, token]);

  const fetchPage = async (cursor: string | null = null, append = false) => {
    if (!token.trim()) {
      alert("Please enter a Bearer token");
      return null;
    }

    setLoading(true);
    try {
      const vars = JSON.parse(variables);
      // Apply state filter from input (empty string = null)
      const stateValue = stateFilter.trim() === "" ? null : stateFilter.trim();
      // Keep after as is (can be "" or null or a cursor string)
      const afterValue = cursor === null ? "" : cursor;
      const updatedVars = { ...vars, after: afterValue, state: stateValue };

      const response = await fetch("/api/stockx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          operationName: "Buying",
          query,
          variables: updatedVars,
        }),
      });

      setLastStatus(response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setLastErrors([
          { message: `HTTP ${response.status}: ${errorData.error || "Unknown error"}` },
        ]);
        return null;
      }

      const data = await response.json();

      // Debug logs
      console.log("RAW JSON", data);
      console.log("FIRST NODE", data?.data?.viewer?.buying?.edges?.[0]?.node);

      if (data.errors) {
        setLastErrors(data.errors);
        return null;
      }

      setLastErrors([]);

      const buyingData = data.data?.viewer?.buying;
      if (!buyingData) {
        setLastErrors([{ message: "No buying data in response" }]);
        return null;
      }

      const edges = buyingData.edges ?? [];
      const newOrders = edges.map((edge: any) => {
        const n = edge?.node ?? {};
        
        // Extract product fields
        const product = n.productVariant?.product ?? {};
        const styleId = product.styleId?.trim() || null;
        const model = product.model?.trim() || null;
        const productName = product.name || null;
        const productTitle = product.title || null;
        const productVariantId = n.productVariant?.id ?? null;
        
        // Computed fields
        const skuKey = styleId || model || product.id || productVariantId || "unknown";
        const displayName = productTitle || productName || "—";
        
        // Size extraction: ALWAYS prefer EU from displayOptions
        const displayOptions = n.productVariant?.sizeChart?.displayOptions ?? [];
        const euOption = displayOptions.find((opt: any) => opt.type === "eu");
        
        let size: string | null = null;
        if (euOption?.size) {
          // Priority 1: EU size from displayOptions (most reliable)
          size = euOption.size;
        } else if (n.localizedSizeTitle) {
          // Priority 2: localizedSizeTitle (if no EU available)
          size = n.localizedSizeTitle;
        } else {
          // Priority 3: Fallback to base size
          const baseSize = n.productVariant?.sizeChart?.baseSize;
          const baseType = n.productVariant?.sizeChart?.baseType;
          size = baseSize ? `${baseType?.toUpperCase() || ""} ${baseSize}`.trim() : null;
        }
        
        // Dates with time
        const purchaseDate = n.purchaseDate ?? null;
        const purchaseDateFormatted = purchaseDate 
          ? new Date(purchaseDate).toLocaleString('fr-CH', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })
          : null;
        
        const estimatedDeliveryDate = n.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null;
        const estimatedDeliveryFormatted = estimatedDeliveryDate
          ? new Date(estimatedDeliveryDate).toLocaleDateString()
          : null;
        const latestEstimatedDeliveryDate = n.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null;
        
        return {
          chainId: n.chainId ?? "",
          orderId: n.orderId ?? "",
          orderNumber: n.orderNumber ?? null,
          purchaseDate,
          purchaseDateFormatted,
          statusKey: n.state?.statusKey ?? null,
          statusTitle: n.state?.statusTitle ?? null,
          amount: typeof n.amount === "number" ? n.amount : null,
          currencyCode: n.currencyCode ?? null,
          productName,
          productTitle,
          displayName,
          styleId,
          model,
          skuKey,
          size,
          sizeType: n.localizedSizeType ?? null,
          estimatedDeliveryDate,
          estimatedDeliveryFormatted,
          latestEstimatedDeliveryDate,
          productVariantId,
          thumbUrl: product.media?.thumbUrl ?? null,
        };
      });
      const newPageInfo = buyingData.pageInfo;

      console.log("MAPPED ORDERS", newOrders);
      console.log("PAGE INFO", newPageInfo);

      if (append) {
        setOrders((prev) => [...prev, ...newOrders]);
      } else {
        setOrders(newOrders);
      }

      setPageInfo(newPageInfo);
      return newPageInfo;
    } catch (error: any) {
      setLastErrors([{ message: error.message }]);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleFetchFirstPage = () => {
    fetchPage(null, false);
  };

  const handleFetchNextPage = () => {
    if (pageInfo?.endCursor && pageInfo.hasNextPage) {
      fetchPage(pageInfo.endCursor, true);
    } else {
      alert("No next page available");
    }
  };

  const handleFetchAllPages = async () => {
    setIsFetchingAll(true);
    setOrders([]);
    setPageInfo(null);

    let currentPageInfo = await fetchPage(null, false);
    
    while (currentPageInfo?.hasNextPage && currentPageInfo?.endCursor) {
      // Add 250ms delay between pages
      await new Promise((resolve) => setTimeout(resolve, 250));
      currentPageInfo = await fetchPage(currentPageInfo.endCursor, true);
    }

    setIsFetchingAll(false);
  };

  const handleClearResults = () => {
    setOrders([]);
    setPageInfo(null);
    setLastStatus(null);
    setLastErrors([]);
  };

  const handleExportCSV = () => {
    if (orders.length === 0) {
      alert("No data to export");
      return;
    }

    const headers = [
      "orderNumber",
      "purchaseDate",
      "offerPrice",
      "currencyCode",
      "totalTTC",
      "productTitle",
      "productName",
      "sku",
      "size",
      "sizeType",
      "estimatedDeliveryDate",
      "statusKey",
      "productVariantId",
    ];

    const rows = orders.map((order) => [
      order.orderNumber ?? "",
      order.purchaseDate ?? "",
      order.amount != null ? order.amount : "",
      order.currencyCode ?? "",
      order.orderNumber && pricingByOrder[order.orderNumber]?.total != null
        ? pricingByOrder[order.orderNumber]!.total
        : "",
      order.displayName,
      order.productName ?? "",
      order.skuKey,
      order.size ?? "",
      order.sizeType ?? "",
      order.estimatedDeliveryDate ?? "",
      order.statusKey ?? "",
      order.productVariantId ?? "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "stockx_buying_orders.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchPricingForOrder = async (order: OrderNode) => {
    const orderNumber = order.orderNumber;
    if (!orderNumber || !token.trim()) return;

    // Already fetched
    if (pricingByOrder[orderNumber]) return;

    setPricingLoading((p) => ({ ...p, [orderNumber]: true }));

    const variables = {
      tradeContext: "buying",
      currencyCode: order.currencyCode ?? "CHF",
      orderNumber,
      variants: [
        {
          uuid: order.productVariantId,
          quantity: 1,
          amount: {
            currencyCode: order.currencyCode ?? "CHF",
            value: order.amount,
          },
        },
      ],
    };

    try {
      const res = await fetch("/api/stockx/pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, variables }),
      });

      const json = await res.json();
      console.log("PRICING RESPONSE for", orderNumber, json);

      const estimate = json?.data?.pricing?.estimate;
      if (estimate?.total != null) {
        setPricingByOrder((p) => ({ ...p, [orderNumber]: estimate }));
      } else {
        setPricingByOrder((p) => ({ ...p, [orderNumber]: null }));
      }
    } catch (error) {
      console.error("Pricing fetch error:", error);
      setPricingByOrder((p) => ({ ...p, [orderNumber]: null }));
    }

    setPricingLoading((p) => ({ ...p, [orderNumber]: false }));
  };

  const fetchAllPricing = async () => {
    if (!token.trim()) {
      alert("Please enter a Bearer token");
      return;
    }

    for (const order of orders) {
      if (!order.orderNumber) continue;
      await fetchPricingForOrder(order);
      // Delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  };

  const loadShopifyOrders = async (sinceDays = 30) => {
    setLoadingShopify(true);
    try {
      const res = await fetch("/api/shopify/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sinceDays }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(`Shopify error: ${data.error || "Unknown error"}`);
        return;
      }

      const items = data.lineItems || [];
      setShopifyItems(items);

      // Normalize StockX orders for matching
      const normalizedStockX: NormalizedStockXOrder[] = orders.map((o) => ({
        stockxOrderNumber: o.orderNumber || "",
        purchaseDate: o.purchaseDate || "",
        offerAmount: o.amount,
        totalTTC:
          o.orderNumber && pricingByOrder[o.orderNumber]?.total != null
            ? pricingByOrder[o.orderNumber]!.total
            : null,
        productTitle: o.displayName,
        skuKey: o.skuKey,
        sizeEU: o.size,
        statusKey: o.statusKey,
        statusTitle: o.statusTitle,
        currencyCode: o.currencyCode,
      }));

      // Run matching
      const results = items.map((item: ShopifyLineItem) =>
        matchShopifyToStockX(item, normalizedStockX)
      );

      setMatchResults(results);
      console.log(`Matched ${results.length} Shopify items`);
    } catch (error) {
      console.error("Error loading Shopify orders:", error);
      alert("Failed to load Shopify orders");
    } finally {
      setLoadingShopify(false);
    }
  };

  const handleManualMatch = async () => {
    if (!manualShopifyOrder.trim() || !manualStockXOrder.trim()) {
      alert("Please enter both Shopify and StockX order numbers");
      return;
    }

    setManualMatchLoading(true);

    try {
      // Clean input
      const cleanShopifyNum = manualShopifyOrder.replace("#", "").trim();
      const cleanStockXNum = manualStockXOrder.trim();

      // 1. Try to find Shopify item in already loaded items
      let shopifyItem = shopifyItems.find(
        (item) => item.orderName.replace("#", "") === cleanShopifyNum
      );

      // 2. If not found, fetch it directly from Shopify API
      if (!shopifyItem) {
        console.log(`[MANUAL MATCH] Shopify order #${cleanShopifyNum} not in loaded items, fetching...`);
        
        const fetchRes = await fetch("/api/shopify/order-by-name", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderName: `#${cleanShopifyNum}` }),
        });

        if (!fetchRes.ok) {
          const errorData = await fetchRes.json();
          alert(
            `❌ Failed to fetch Shopify order #${cleanShopifyNum}\n\n` +
            `Error: ${errorData.error || "Unknown error"}\n\n` +
            `Make sure the order number is correct and exists in your Shopify store.`
          );
          return;
        }

        const fetchedData = await fetchRes.json();
        const fetchedLineItems = fetchedData.lineItems || [];

        if (fetchedLineItems.length === 0) {
          alert(`❌ Shopify order #${cleanShopifyNum} has no line items`);
          return;
        }

        // Add fetched items to shopifyItems state
        setShopifyItems((prev) => [...prev, ...fetchedLineItems]);

        // Use the first line item for matching (or let user pick if multiple)
        if (fetchedLineItems.length > 1) {
          const proceed = confirm(
            `ℹ️ Order #${cleanShopifyNum} has ${fetchedLineItems.length} line items.\n\n` +
            `This will match the StockX order to the FIRST line item:\n` +
            `"${fetchedLineItems[0].title}"\n\n` +
            `Continue?`
          );
          if (!proceed) return;
        }

        shopifyItem = fetchedLineItems[0];
        console.log(`[MANUAL MATCH] Fetched Shopify order #${cleanShopifyNum}:`, shopifyItem);

        // Create match results for the fetched items (to show auto-suggestions if user wants)
        const normalizedStockX: NormalizedStockXOrder[] = orders.map((o) => ({
          stockxOrderNumber: o.orderNumber || "",
          purchaseDate: o.purchaseDate || "",
          offerAmount: o.amount,
          totalTTC:
            o.orderNumber && pricingByOrder[o.orderNumber]?.total != null
              ? pricingByOrder[o.orderNumber]!.total
              : null,
          productTitle: o.displayName,
          skuKey: o.skuKey,
          sizeEU: o.size,
          statusKey: o.statusKey,
          statusTitle: o.statusTitle,
          currencyCode: o.currencyCode,
        }));

        const newMatchResults = fetchedLineItems.map((item: ShopifyLineItem) =>
          matchShopifyToStockX(item, normalizedStockX)
        );

        setMatchResults((prev) => [...prev, ...newMatchResults]);
      }

      // 3. Final safety check (should never happen, but TypeScript needs it)
      if (!shopifyItem) {
        alert(`❌ Internal error: Shopify item not found after fetch`);
        return;
      }

      // 4. Check if StockX order exists (optional warning)
      const stockxOrder = orders.find((o) => o.orderNumber === cleanStockXNum);

      if (!stockxOrder) {
        const proceed = confirm(
          `⚠️ StockX order ${cleanStockXNum} not found in currently loaded StockX orders.\n\n` +
          `This might be because:\n` +
          `- The order hasn't been fetched yet\n` +
          `- The order number is incorrect\n\n` +
          `Do you want to save this match anyway?`
        );
        if (!proceed) return;
      }

      // 5. Save manual override
      setManualOverrides({
        ...manualOverrides,
        [shopifyItem.lineItemId]: {
          stockxOrderNumber: cleanStockXNum,
          method: "MANUAL_OVERRIDE",
        },
      });

      setConfirmedMatches({
        ...confirmedMatches,
        [shopifyItem.lineItemId]: cleanStockXNum,
      });

      console.log(`✅ Manual match created: ${shopifyItem.orderName} → ${cleanStockXNum}`);
      alert(
        `✅ Manual match saved!\n\n` +
        `${shopifyItem.orderName} → ${cleanStockXNum}\n\n` +
        `Product: ${shopifyItem.title}`
      );

      // Clear inputs
      setManualShopifyOrder("");
      setManualStockXOrder("");
    } catch (error: any) {
      console.error("[MANUAL MATCH] Error:", error);
      alert(`❌ Error creating manual match:\n\n${error.message}`);
    } finally {
      setManualMatchLoading(false);
    }
  };

  const handleSetMetafields = async (shopifyItem: ShopifyLineItem, stockxOrderNumber: string) => {
    const lineItemId = shopifyItem.lineItemId;
    
    setMetafieldsLoading((prev) => ({ ...prev, [lineItemId]: true }));

    try {
      // Find the StockX order for additional details
      const stockxOrder = orders.find((o) => o.orderNumber === stockxOrderNumber);

      if (!stockxOrder) {
        alert(`⚠️ StockX order ${stockxOrderNumber} not found in loaded orders.\n\nPlease fetch the StockX order first.`);
        return;
      }

      // Calculate financials
      // 1. Shopify revenue (sale price for this line item)
      const shopifyRevenue = parseFloat(shopifyItem.totalPrice) || 0;
      
      // 2. Supplier cost (StockX total TTC or manual override)
      let supplierCost = 0;
      
      // Check for manual override first
      if (manualCostOverrides[lineItemId]) {
        supplierCost = parseFloat(manualCostOverrides[lineItemId]) || 0;
      } else {
        // Try to get TTC from pricing data
        const pricingData = pricingByOrder[stockxOrderNumber];
        if (pricingData?.total != null) {
          supplierCost = pricingData.total;
        } else {
          // Fallback to offer amount (not ideal, but better than nothing)
          supplierCost = stockxOrder.amount || 0;
          
          // Prompt user to confirm or enter manual cost
          const manualCostInput = prompt(
            `⚠️ No TTC pricing found for StockX order ${stockxOrderNumber}\n\n` +
            `Offer amount: ${supplierCost.toFixed(2)} ${stockxOrder.currencyCode || "CHF"}\n\n` +
            `Please enter the TOTAL cost (including fees) or press OK to use offer amount:`,
            supplierCost.toFixed(2)
          );
          
          if (manualCostInput === null) {
            // User cancelled
            return;
          }
          
          const parsedCost = parseFloat(manualCostInput);
          if (!isNaN(parsedCost) && parsedCost > 0) {
            supplierCost = parsedCost;
            // Save override
            setManualCostOverrides((prev) => ({ ...prev, [lineItemId]: manualCostInput }));
          }
        }
      }
      
      // 3. Calculate margin
      const marginAmount = shopifyRevenue - supplierCost;
      const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;

      // Confirm before setting
      const confirmMessage = 
        `📦 Set Metafields on Shopify?\n\n` +
        `Shopify Order: ${shopifyItem.orderName}\n` +
        `Product: ${shopifyItem.title}\n\n` +
        `💰 Financial Data:\n` +
        `- Shopify Revenue: ${shopifyRevenue.toFixed(2)} ${shopifyItem.currencyCode}\n` +
        `- Supplier Cost: ${supplierCost.toFixed(2)} ${shopifyItem.currencyCode}\n` +
        `- Margin: ${marginAmount.toFixed(2)} ${shopifyItem.currencyCode} (${marginPercent.toFixed(2)}%)\n\n` +
        `📦 StockX Data:\n` +
        `- Order Number: ${stockxOrderNumber}\n` +
        `- Status: ${stockxOrder.statusKey || "UNKNOWN"}\n` +
        `- Estimated Delivery: ${stockxOrder.estimatedDeliveryDate || "N/A"}\n\n` +
        `This will write 6 metafields to Shopify:\n` +
        `supplier.order_number\n` +
        `supplier.status\n` +
        `supplier.estimated_delivery\n` +
        `supplier.total_cost\n` +
        `supplier.margin_amount\n` +
        `supplier.margin_percent`;

      if (!confirm(confirmMessage)) {
        return;
      }

      console.log(`[METAFIELDS] Setting for ${shopifyItem.orderName}...`);

      const res = await fetch("/api/shopify/set-metafields", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: shopifyItem.shopifyOrderId,
          stockxOrderNumber: stockxOrderNumber,
          estimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
          stockxStatus: stockxOrder.statusKey || "UNKNOWN",
          supplierCost: supplierCost.toFixed(2),
          marginAmount: marginAmount.toFixed(2),
          marginPercent: marginPercent.toFixed(2),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(
          `❌ Failed to set metafields:\n\n` +
          `${data.error || "Unknown error"}\n\n` +
          `Details: ${JSON.stringify(data.details || {}, null, 2)}`
        );
        return;
      }

      // Mark as set
      setMetafieldsSet((prev) => ({
        ...prev,
        [lineItemId]: {
          timestamp: new Date().toISOString(),
          stockxOrderNumber,
        },
      }));

      // Save to database
      try {
        console.log(`[METAFIELDS] Saving match to database...`);
        
        // Get match data for database save
        const matchResult = matchResults.find(r => r.shopifyItem.lineItemId === lineItemId);
        const bestMatch = matchResult?.bestMatch;
        
        const saveRes = await fetch("/api/db/save-match", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            shopifyOrderId: shopifyItem.shopifyOrderId,
            shopifyOrderName: shopifyItem.orderName,
            shopifyLineItemId: shopifyItem.lineItemId,
            shopifyProductTitle: shopifyItem.title,
            shopifySku: shopifyItem.sku,
            shopifySizeEU: shopifyItem.sizeEU,
            shopifyTotalPrice: shopifyRevenue,
            shopifyCurrencyCode: shopifyItem.currencyCode || "CHF",
            stockxOrderNumber: stockxOrderNumber,
            stockxProductName: stockxOrder.displayName,
            stockxSizeEU: stockxOrder.size,
            stockxSkuKey: stockxOrder.skuKey,
            matchConfidence: bestMatch?.confidence || "manual",
            matchScore: bestMatch?.score || 0,
            matchType: manualOverrides[lineItemId] ? "manual" : "auto",
            matchReasons: bestMatch?.reasons || ["Manual match"],
            timeDiffHours: bestMatch?.timeDiffHours || 0,
            stockxStatus: stockxOrder.statusKey || "",
            stockxEstimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
            supplierCost: supplierCost,
            marginAmount: marginAmount,
            marginPercent: marginPercent,
            manualCostOverride: manualCostOverrides[lineItemId] || null,
            shopifyMetafieldsSynced: true,
          }),
        });

        if (saveRes.ok) {
          console.log(`[METAFIELDS] ✅ Match saved to database`);
        } else {
          console.error(`[METAFIELDS] ❌ Failed to save to database`);
        }
      } catch (dbError: any) {
        console.error("[METAFIELDS] Database save error:", dbError);
        // Don't fail the whole operation if DB save fails
      }

      alert(
        `✅ Metafields set successfully on Shopify!\n\n` +
        `${shopifyItem.orderName} → ${stockxOrderNumber}\n\n` +
        `${data.metafields?.length || 0} metafields written.\n\n` +
        `💾 Match saved to database.`
      );
      console.log(`[METAFIELDS] Success for ${shopifyItem.orderName}:`, data);
    } catch (error: any) {
      console.error("[METAFIELDS] Error:", error);
      alert(`❌ Error setting metafields:\n\n${error.message}`);
    } finally {
      setMetafieldsLoading((prev) => ({ ...prev, [lineItemId]: false }));
    }
  };

  // Load matches from DB
  const loadFromDB = async () => {
    setDbLoading(true);
    try {
      const res = await fetch("/api/db/matches");
      if (!res.ok) {
        throw new Error(`Failed to load from DB: ${res.status}`);
      }
      const data = await res.json();
      setDbMatches(data.matches || []);
      console.log(`[DB] Loaded ${data.matches?.length || 0} matches from DB`);
      alert(`✅ Loaded ${data.matches?.length || 0} matches from database`);
    } catch (error: any) {
      console.error("[DB] Error loading matches:", error);
      alert(`❌ Error loading from DB:\n\n${error.message}`);
    } finally {
      setDbLoading(false);
    }
  };

  // Trigger sync worker (auto-match new orders)
  const triggerSync = async () => {
    if (!token) {
      alert("⚠️ Please enter your StockX token first");
      return;
    }

    setSyncLoading(true);
    setLastSyncResult(null);
    
    try {
      console.log("[SYNC] Triggering new-orders sync...");
      const res = await fetch("/api/sync/new-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stockxToken: token }),
      });

      if (!res.ok) {
        throw new Error(`Sync failed: ${res.status}`);
      }

      const data = await res.json();
      setLastSyncResult(data);
      console.log("[SYNC] Result:", data);

      alert(
        `✅ Sync Complete!\n\n` +
        `${data.message}\n\n` +
        `New Matches: ${data.newMatches || 0}\n` +
        `Auto-Set: ${data.autoSetCount || 0}`
      );

      // Reload DB matches
      await loadFromDB();
    } catch (error: any) {
      console.error("[SYNC] Error:", error);
      alert(`❌ Sync failed:\n\n${error.message}`);
    } finally {
      setSyncLoading(false);
    }
  };

  // Trigger status check worker
  const triggerStatusCheck = async () => {
    if (!token) {
      alert("⚠️ Please enter your StockX token first");
      return;
    }

    setStatusCheckLoading(true);
    setLastStatusCheckResult(null);

    try {
      console.log("[STATUS] Triggering status check...");
      const res = await fetch("/api/sync/status-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stockxToken: token }),
      });

      if (!res.ok) {
        throw new Error(`Status check failed: ${res.status}`);
      }

      const data = await res.json();
      setLastStatusCheckResult(data);
      console.log("[STATUS] Result:", data);

      alert(
        `✅ Status Check Complete!\n\n` +
        `${data.message}\n\n` +
        `Checked: ${data.checkedCount || 0}\n` +
        `Updated: ${data.updatedCount || 0}`
      );

      // Reload DB matches
      await loadFromDB();
    } catch (error: any) {
      console.error("[STATUS] Error:", error);
      alert(`❌ Status check failed:\n\n${error.message}`);
    } finally {
      setStatusCheckLoading(false);
    }
  };

  const deleteMatch = async (matchId: string, orderName: string) => {
    if (!confirm(`🗑️ Delete match for ${orderName}?\n\nThis will remove it from the database permanently.`)) {
      return;
    }

    try {
      console.log(`[DB] Deleting match ${matchId}...`);
      const res = await fetch("/api/db/delete-match", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: matchId }),
      });

      if (!res.ok) {
        throw new Error(`Delete failed: ${res.status}`);
      }

      alert(`✅ Match deleted successfully`);
      
      // Reload DB matches
      await loadFromDB();
    } catch (error: any) {
      console.error("[DB] Delete error:", error);
      alert(`❌ Failed to delete match:\n\n${error.message}`);
    }
  };

  const clearManualOverrides = () => {
    if (!confirm(`Clear ${Object.keys(manualOverrides).length} manual override(s)?`)) {
      return;
    }
    setManualOverrides({});
    alert("✅ Manual overrides cleared");
  };

  const [tokenRefreshing, setTokenRefreshing] = useState(false);
  const [autoTokenStatus, setAutoTokenStatus] = useState<string | null>(null);

  const refreshStockXToken = async () => {
    if (!confirm("🤖 Trigger automated token refresh?\n\nThis will:\n- Launch headless browser\n- Auto-login to StockX\n- Capture fresh bearer token\n- Store in database\n\nTakes ~30 seconds. Continue?")) {
      return;
    }

    setTokenRefreshing(true);
    try {
      const res = await fetch("/api/auth/refresh-stockx-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cronSecret: prompt("Enter CRON_SECRET (from env vars):") }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.details || "Token refresh failed");
      }

      alert(`✅ Token Refreshed!\n\nPreview: ${data.tokenPreview}\nExpires: ${data.expiresIn}\n\nYou can now use the app without manually pasting a token!`);
      setAutoTokenStatus("Active - Auto-refreshes every 10 hours");
    } catch (error: any) {
      alert(`❌ Token refresh failed:\n\n${error.message}\n\nMake sure STOCKX_EMAIL and STOCKX_PASSWORD are set in environment variables.`);
    } finally {
      setTokenRefreshing(false);
    }
  };

  const refreshStockXTokenViaCookies = async () => {
    if (!confirm("🍪 Refresh token using saved cookies?\n\nThis will:\n- Use cookies from stockx-cookies.json\n- Bypass bot detection!\n- Capture fresh bearer token\n- Store in database\n\nTakes ~5 seconds. Continue?\n\n⚠️ Make sure you've exported cookies first! See STOCKX_TOKEN_REFRESH.md")) {
      return;
    }

    setTokenRefreshing(true);
    try {
      const res = await fetch("/api/auth/refresh-stockx-token-cookies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cronSecret: prompt("Enter CRON_SECRET (from env vars):") || "test" }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "Missing cookies file") {
          throw new Error(
            "❌ Missing stockx-cookies.json!\n\n" +
            "INSTRUCTIONS:\n" +
            "1. Login to StockX Pro in Chrome\n" +
            "2. Press F12 → Console tab\n" +
            "3. Run the script from: export-stockx-cookies.js\n" +
            "4. Save to: stockx-cookies.json\n\n" +
            "See STOCKX_TOKEN_REFRESH.md for full guide"
          );
        }
        throw new Error(data.details || data.message || "Token refresh failed");
      }

      alert(`✅ Token Refreshed via Cookies!\n\nPreview: ${data.tokenPreview}\n\n✨ No bot detection! Fast & reliable!`);
      setAutoTokenStatus("Active (via cookies) - Refresh cookies every ~7 days");
    } catch (error: any) {
      alert(`❌ Cookie-based refresh failed:\n\n${error.message}`);
    } finally {
      setTokenRefreshing(false);
    }
  };

  const checkAutoTokenStatus = async () => {
    try {
      const res = await fetch("/api/auth/refresh-stockx-token");
      if (res.ok) {
        const data = await res.json();
        setAutoTokenStatus(data.isExpired ? "Expired - Will refresh soon" : `Active until ${new Date(data.expiresAt).toLocaleString()}`);
      } else {
        setAutoTokenStatus("No auto-token found");
      }
    } catch (error) {
      setAutoTokenStatus(null);
    }
  };

  useEffect(() => {
    checkAutoTokenStatus();
  }, []);

  const autoSetAllHighMatches = async () => {
    const highMatches = matchResults.filter((r) => r.bestMatch?.confidence === "high");
    
    if (highMatches.length === 0) {
      alert("⚠️ No HIGH confidence matches to set");
      return;
    }

    if (!confirm(`🚀 Auto-Set Metafields for ${highMatches.length} HIGH confidence matches?\n\nThis will:\n- Set Shopify metafields for all HIGH matches\n- Save all matches to database\n- No manual approval for each one\n\nContinue?`)) {
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const result of highMatches) {
      const shopifyItem = result.shopifyItem;
      const match = result.bestMatch;
      if (!match) continue;

      // Use the stockxOrder from the match result (normalized)
      const stockxOrder = match.stockxOrder;
      
      // Also find the raw order for pricing data
      const rawStockxOrder = orders.find((o) => o.orderNumber === stockxOrder.stockxOrderNumber);

      // Calculate financials
      const shopifyRevenue = parseFloat(shopifyItem.totalPrice) || 0;
      const pricingData = stockxOrder.stockxOrderNumber ? pricingByOrder[stockxOrder.stockxOrderNumber] : null;
      const supplierCost = pricingData?.total || stockxOrder.offerAmount || rawStockxOrder?.amount || 0;
      const marginAmount = shopifyRevenue - supplierCost;
      const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;

      try {
        console.log(`[AUTO-SET] Setting metafields for ${shopifyItem.orderName}...`);
        
        // Set metafields
        const res = await fetch("/api/shopify/set-metafields", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            shopifyOrderId: shopifyItem.shopifyOrderId,
            stockxOrderNumber: stockxOrder.stockxOrderNumber || "",
            estimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
            stockxStatus: stockxOrder.statusKey || "UNKNOWN",
            supplierCost: supplierCost.toFixed(2),
            marginAmount: marginAmount.toFixed(2),
            marginPercent: marginPercent.toFixed(2),
          }),
        });

        if (!res.ok) {
          console.error(`[AUTO-SET] Failed to set metafields for ${shopifyItem.orderName}`);
          failCount++;
          continue;
        }

        // Save to DB
        await fetch("/api/db/save-match", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            shopifyOrderId: shopifyItem.shopifyOrderId,
            shopifyOrderName: shopifyItem.orderName,
            shopifyLineItemId: shopifyItem.lineItemId,
            shopifyProductTitle: shopifyItem.title,
            shopifySku: shopifyItem.sku || null,
            shopifySizeEU: shopifyItem.sizeEU || null,
            shopifyTotalPrice: shopifyRevenue,
            shopifyCurrencyCode: shopifyItem.currencyCode || "CHF",
            stockxOrderNumber: stockxOrder.stockxOrderNumber || "",
            stockxProductName: stockxOrder.productName || stockxOrder.productTitle || "",
            stockxSizeEU: stockxOrder.sizeEU || null,
            stockxSkuKey: stockxOrder.skuKey || null,
            matchConfidence: match.confidence,
            matchScore: match.score,
            matchType: "auto",
            matchReasons: match.reasons,
            timeDiffHours: match.timeDiffHours,
            stockxStatus: stockxOrder.statusKey || "",
            stockxEstimatedDelivery: stockxOrder.estimatedDeliveryDate || null,
            supplierCost: supplierCost,
            marginAmount: marginAmount,
            marginPercent: marginPercent,
            shopifyMetafieldsSynced: true,
          }),
        });

        console.log(`[AUTO-SET] ✅ Success for ${shopifyItem.orderName}`);
        successCount++;

        // Rate limit
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`[AUTO-SET] Error for ${shopifyItem.orderName}:`, error);
        failCount++;
      }
    }

    alert(
      `✅ Auto-Set Complete!\n\n` +
      `Success: ${successCount}/${highMatches.length}\n` +
      `Failed: ${failCount}\n\n` +
      `All successful matches are now synced to Shopify and saved to database.`
    );

    // Reload DB matches to show updated data
    await loadFromDB();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          StockX Pro GraphQL Playground
        </h1>

        {/* Token Input */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Authentication</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="bearerToken" className="block text-sm font-medium text-gray-700 mb-2">
                Bearer Token
              </label>
              <div className="flex gap-2">
                <input
                  id="bearerToken"
                  name="bearerToken"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your StockX Pro API token (or use auto-refresh)"
                  autoComplete="off"
                />
                <button
                  onClick={refreshStockXToken}
                  disabled={tokenRefreshing}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap font-semibold"
                  title="Automatically refresh token using StockX login credentials (may be blocked by bot detection)"
                >
                  {tokenRefreshing ? "⏳ Refreshing..." : "🤖 Auto-Refresh"}
                </button>
                <button
                  onClick={refreshStockXTokenViaCookies}
                  disabled={tokenRefreshing}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap font-semibold"
                  title="Refresh token using saved cookies (bypasses bot detection)"
                >
                  {tokenRefreshing ? "⏳ Refreshing..." : "🍪 Via Cookies"}
                </button>
              </div>
              {autoTokenStatus && (
                <p className="mt-2 text-sm text-gray-600">
                  🤖 Auto-token status: <span className="font-semibold">{autoTokenStatus}</span>
                </p>
              )}
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="saveToken"
                name="saveToken"
                checked={saveToken}
                onChange={(e) => setSaveToken(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label
                htmlFor="saveToken"
                className="ml-2 block text-sm text-gray-700"
              >
                Save token locally (localStorage)
              </label>
            </div>
          </div>
        </div>

        {/* Query Configuration */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Query Configuration</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="stateFilter" className="block text-sm font-medium text-gray-700 mb-2">
                State Filter (optional - discover valid values from DevTools)
              </label>
              <input
                id="stateFilter"
                name="stateFilter"
                type="text"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                placeholder='Leave empty for "All" or enter state like "PENDING"'
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-gray-500">
                Empty = All states. Common: PENDING, COMPLETED. Check Network tab for valid BuyingGeneralState enum values.
              </p>
            </div>
            <div>
              <label htmlFor="graphqlQuery" className="block text-sm font-medium text-gray-700 mb-2">
                GraphQL Query
              </label>
              <textarea
                id="graphqlQuery"
                name="graphqlQuery"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                rows={12}
              />
            </div>
            <div>
              <label htmlFor="variables" className="block text-sm font-medium text-gray-700 mb-2">
                Variables (JSON)
              </label>
              <textarea
                id="variables"
                name="variables"
                value={variables}
                onChange={(e) => setVariables(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                rows={6}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Actions</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleFetchFirstPage}
              disabled={loading || isFetchingAll}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Fetch First Page
            </button>
            <button
              onClick={handleFetchNextPage}
              disabled={loading || isFetchingAll || !pageInfo?.hasNextPage}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Fetch Next Page
            </button>
            <button
              onClick={handleFetchAllPages}
              disabled={loading || isFetchingAll}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isFetchingAll ? "Fetching All..." : "Fetch All Pages"}
            </button>
            <button
              onClick={fetchAllPricing}
              disabled={loading || isFetchingAll || orders.length === 0}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Fetch All Pricing
            </button>
            <button
              onClick={handleClearResults}
              disabled={loading || isFetchingAll}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Clear Results
            </button>
            <button
              onClick={handleExportCSV}
              disabled={loading || isFetchingAll || orders.length === 0}
              className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Debug Panel */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Debug Info</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="font-medium">Last HTTP Status:</span>{" "}
              <span
                className={
                  lastStatus === 200
                    ? "text-green-600"
                    : lastStatus
                    ? "text-red-600"
                    : ""
                }
              >
                {lastStatus || "N/A"}
              </span>
            </div>
            <div>
              <span className="font-medium">Progress:</span>{" "}
              <span className="text-gray-600">
                {pageInfo
                  ? `${orders.length} / ${pageInfo.totalCount}`
                  : "N/A"}
              </span>
            </div>
            <div>
              <span className="font-medium">Current Cursor:</span>{" "}
              <span className="text-gray-600">
                {pageInfo?.endCursor
                  ? `${pageInfo.endCursor.substring(0, 15)}...`
                  : "N/A"}
              </span>
            </div>
            <div>
              <span className="font-medium">Has Next Page:</span>{" "}
              <span className="text-gray-600">
                {pageInfo ? (pageInfo.hasNextPage ? "Yes" : "No") : "N/A"}
              </span>
            </div>
          </div>
          {lastErrors.length > 0 && (
            <div className="mt-4">
              <span className="font-medium text-red-600">Errors:</span>
              <pre className="mt-2 p-3 bg-red-50 rounded text-red-800 text-xs overflow-auto">
                {JSON.stringify(lastErrors, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Results Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold">
              Results ({orders.length} orders)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Order Number
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Purchase Date
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Offer Price
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total TTC
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                    SKU
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ETA
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-6 py-8 text-center text-gray-500"
                    >
                      No orders loaded. Click "Fetch First Page" to start.
                    </td>
                  </tr>
                ) : (
                  orders.map((order, idx) => (
                    <tr key={`${order.orderId}-${idx}`} className="hover:bg-gray-50">
                      <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {order.orderNumber ?? "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500" title={order.purchaseDate ?? ""}>
                        {order.purchaseDateFormatted ?? "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                        {order.amount != null ? order.amount.toFixed(2) : "—"}{" "}
                        {order.currencyCode ?? ""}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                        {order.orderNumber ? (
                          pricingByOrder[order.orderNumber]?.total != null ? (
                            <span className="font-semibold text-green-700">
                              {pricingByOrder[order.orderNumber]!.total.toFixed(2)}{" "}
                              {order.currencyCode ?? "CHF"}
                            </span>
                          ) : pricingLoading[order.orderNumber] ? (
                            <span className="text-blue-600 text-xs">Loading…</span>
                          ) : (
                            <button
                              onClick={() => fetchPricingForOrder(order)}
                              className="text-blue-600 underline hover:text-blue-800 text-xs"
                            >
                              Get
                            </button>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900" title={order.productTitle ?? order.productName ?? ""}>
                        {order.displayName}
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-600 font-mono w-32" title={`StyleID: ${order.styleId ?? "—"} / Model: ${order.model ?? "—"}`}>
                        {order.styleId || order.model || "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                        {order.size ?? "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500" title={order.estimatedDeliveryDate ?? ""}>
                        {order.estimatedDeliveryFormatted ?? "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                        {order.statusKey ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Manual Matching Section */}
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <h2 className="text-xl font-semibold mb-4">
            🔧 Manual Matching Override
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Force a match between a specific Shopify order and StockX order. 
            This will override any automatic matching suggestions.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label htmlFor="manualShopifyOrder" className="block text-sm font-medium text-gray-700 mb-2">
                Shopify Order Number
              </label>
              <input
                id="manualShopifyOrder"
                name="manualShopifyOrder"
                type="text"
                value={manualShopifyOrder}
                onChange={(e) => setManualShopifyOrder(e.target.value)}
                placeholder="#4654"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label htmlFor="manualStockXOrder" className="block text-sm font-medium text-gray-700 mb-2">
                StockX Order Number
              </label>
              <input
                id="manualStockXOrder"
                name="manualStockXOrder"
                type="text"
                value={manualStockXOrder}
                onChange={(e) => setManualStockXOrder(e.target.value)}
                placeholder="03-XXXXXXXXXX"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <button
                onClick={handleManualMatch}
                disabled={!manualShopifyOrder.trim() || !manualStockXOrder.trim() || manualMatchLoading}
                className="w-full px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {manualMatchLoading ? "Fetching Shopify order..." : "Match Manually"}
              </button>
            </div>
          </div>
          {Object.keys(manualOverrides).length > 0 && (
            <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-orange-800">
                  Manual Overrides Active: {Object.keys(manualOverrides).length}
                </p>
                <button
                  onClick={clearManualOverrides}
                  className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 font-semibold"
                >
                  🗑️ Clear All
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {shopifyItems
                  .filter((item) => manualOverrides[item.lineItemId])
                  .map((item) => (
                    <p key={item.lineItemId} className="text-xs text-orange-700">
                      {item.orderName} → {manualOverrides[item.lineItemId].stockxOrderNumber}
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Database & Auto-Sync Section */}
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg shadow-lg p-6 mt-6 border-2 border-purple-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-purple-900">
                🤖 Database & Auto-Sync
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Persistent storage + background workers for automatic matching & status monitoring
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <button
              onClick={loadFromDB}
              disabled={dbLoading}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium shadow"
            >
              {dbLoading ? "Loading..." : "📂 Load from Database"}
            </button>

            <button
              onClick={triggerSync}
              disabled={syncLoading || !token}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium shadow"
            >
              {syncLoading ? "Syncing..." : "🔄 Sync New Orders (Auto-Match)"}
            </button>

            <button
              onClick={triggerStatusCheck}
              disabled={statusCheckLoading || !token}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium shadow"
            >
              {statusCheckLoading ? "Checking..." : "✅ Check Status Updates"}
            </button>
          </div>

          {/* Last Sync Results */}
          {(lastSyncResult || lastStatusCheckResult) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {lastSyncResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-semibold text-green-800 mb-2">Last Sync Result</h3>
                  <p className="text-sm text-gray-700">
                    New Matches: <span className="font-bold">{lastSyncResult.newMatches || 0}</span>
                  </p>
                  <p className="text-sm text-gray-700">
                    Auto-Set: <span className="font-bold">{lastSyncResult.autoSetCount || 0}</span>
                  </p>
                </div>
              )}

              {lastStatusCheckResult && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-800 mb-2">Last Status Check</h3>
                  <p className="text-sm text-gray-700">
                    Checked: <span className="font-bold">{lastStatusCheckResult.checkedCount || 0}</span>
                  </p>
                  <p className="text-sm text-gray-700">
                    Updated: <span className="font-bold">{lastStatusCheckResult.updatedCount || 0}</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* DB Matches Display */}
          {dbMatches.length > 0 && (
            <div className="bg-white rounded-lg border border-purple-200 p-4">
              <h3 className="font-semibold text-purple-900 mb-3">
                Stored Matches ({dbMatches.length})
              </h3>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-purple-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Shopify Order</th>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-left">StockX Order</th>
                      <th className="px-3 py-2 text-left">Confidence</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Synced</th>
                      <th className="px-3 py-2 text-left">Margin</th>
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbMatches.map((match) => (
                      <tr key={match.id} className="border-b hover:bg-purple-50">
                        <td className="px-3 py-2 font-medium">{match.shopifyOrderName}</td>
                        <td className="px-3 py-2 text-xs">{match.shopifyProductTitle}</td>
                        <td className="px-3 py-2 font-mono text-xs">{match.stockxOrderNumber}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              match.matchConfidence === "high"
                                ? "bg-green-100 text-green-800"
                                : match.matchConfidence === "medium"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {match.matchConfidence.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{match.stockxStatus}</td>
                        <td className="px-3 py-2">
                          {match.shopifyMetafieldsSynced ? (
                            <span className="text-green-600 font-semibold">✅</span>
                          ) : (
                            <span className="text-gray-400">⏸️</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs font-semibold">
                          {match.marginPercent.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => deleteMatch(match.id, match.shopifyOrderName)}
                            className="text-red-600 hover:text-red-800 font-semibold text-xs px-2 py-1 rounded hover:bg-red-50"
                            title="Delete this match from database"
                          >
                            🗑️ Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">ℹ️ How it works (FULLY AUTOMATIC)</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• <strong>Sync New Orders</strong>: 🤖 Fetches recent Shopify orders, auto-matches with StockX, <span className="font-bold text-green-700">automatically sets metafields + saves to DB for HIGH confidence matches</span>. No manual approval needed!</li>
              <li>• <strong>Check Status Updates</strong>: 🔄 Monitors all synced orders for StockX status changes and updates Shopify metafields automatically.</li>
              <li>• <strong>Database</strong>: 💾 All HIGH confidence matches stored locally. MEDIUM/LOW skipped (require manual review).</li>
              <li>• <strong>Cron Jobs</strong>: ⏰ Call <code className="bg-white px-1 rounded">/api/sync/new-orders</code> every 5-10 min and <code className="bg-white px-1 rounded">/api/sync/status-check</code> every 30-60 min for full automation.</li>
            </ul>
          </div>
        </div>

        {/* Shopify Matching Section (Manual Mode) */}
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">
                Order Matching (Shopify ↔ StockX)
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Manual matching interface (for review and overrides)
              </p>
            </div>
            <button
              onClick={() => loadShopifyOrders(30)}
              disabled={loadingShopify || orders.length === 0}
              className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loadingShopify ? "Loading..." : "Load Shopify (100 recent unfulfilled)"}
            </button>
          </div>

          {matchResults.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              Click "Load Shopify Orders" to fetch recent unfulfilled orders and match with StockX
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-gray-600">
                    {matchResults.length} Shopify line items (unfulfilled) • {" "}
                    {matchResults.filter((r) => r.bestMatch).length} matches found
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    HIGH: {matchResults.filter((r) => r.bestMatch?.confidence === "high").length} • 
                    MEDIUM: {matchResults.filter((r) => r.bestMatch?.confidence === "medium").length} • 
                    LOW: {matchResults.filter((r) => r.bestMatch?.confidence === "low").length}
                  </p>
                </div>
                <button
                  onClick={autoSetAllHighMatches}
                  disabled={matchResults.filter((r) => r.bestMatch?.confidence === "high").length === 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold shadow"
                >
                  🚀 Auto-Set All HIGH Matches ({matchResults.filter((r) => r.bestMatch?.confidence === "high").length})
                </button>
              </div>

              {matchResults.map((result, idx) => {
                const shopify = result.shopifyItem;
                const match = result.bestMatch;
                const isLiquidation = shopify.title.trim().endsWith("%");

                return (
                  <div
                    key={`${shopify.lineItemId}-${idx}`}
                    className={`border rounded-lg p-4 ${
                      isLiquidation
                        ? "border-purple-300 bg-purple-50"
                        : match?.overThreshold
                        ? "border-yellow-300 bg-yellow-50"
                        : match?.confidence === "high"
                        ? "border-green-300 bg-green-50"
                        : match?.confidence === "medium"
                        ? "border-blue-300 bg-blue-50"
                        : "border-gray-300"
                    }`}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Shopify Side */}
                      <div>
                        <h3 className="font-semibold text-sm text-gray-700 mb-2">
                          📦 Shopify Order: {shopify.orderName}
                        </h3>
                        <div className="text-xs space-y-1">
                          <p>
                            <span className="font-medium">Created:</span>{" "}
                            {new Date(shopify.createdAt).toLocaleString("fr-CH")}
                          </p>
                          <p>
                            <span className="font-medium">Status:</span>{" "}
                            <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                              shopify.displayFinancialStatus === "PAID" 
                                ? "bg-green-100 text-green-800"
                                : shopify.displayFinancialStatus === "PENDING"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-gray-100 text-gray-800"
                            }`}>
                              {shopify.displayFinancialStatus}
                            </span>
                            {shopify.displayFulfillmentStatus && (
                              <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800">
                                {shopify.displayFulfillmentStatus}
                              </span>
                            )}
                          </p>
                          {shopify.customerName && (
                            <p>
                              <span className="font-medium">Customer:</span>{" "}
                              {shopify.customerName}
                            </p>
                          )}
                          <p>
                            <span className="font-medium">Product:</span>{" "}
                            {shopify.title}
                          </p>
                          <p>
                            <span className="font-medium">SKU:</span>{" "}
                            {shopify.sku || "—"}
                          </p>
                          <p>
                            <span className="font-medium">Size:</span>{" "}
                            {shopify.sizeEU || shopify.variantTitle || "—"}
                          </p>
                          <p>
                            <span className="font-medium">Price:</span>{" "}
                            {shopify.currencyCode} {shopify.price}
                            {shopify.quantity > 1 && (
                              <span className="text-gray-500"> (×{shopify.quantity})</span>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* StockX Match Side */}
                      <div>
                        {manualOverrides[shopify.lineItemId] ? (
                          // Manual override exists - show it with priority
                          (() => {
                            const manualStockXOrderNum = manualOverrides[shopify.lineItemId].stockxOrderNumber;
                            const manualStockXOrder = orders.find(o => o.orderNumber === manualStockXOrderNum);
                            return (
                              <>
                                <div className="mb-3 px-2 py-1 bg-orange-100 border border-orange-400 rounded">
                                  <p className="text-xs font-bold text-orange-800 text-center">
                                    🔧 MANUAL OVERRIDE
                                  </p>
                                </div>
                                <h3 className="font-semibold text-sm text-gray-700 mb-2">
                                  🎯 Manually Matched StockX Order
                                </h3>
                                {manualStockXOrder ? (
                                  <div className="text-xs space-y-1">
                                    <p>
                                      <span className="font-medium">Order:</span>{" "}
                                      <span className="font-mono text-orange-700 font-semibold">
                                        {manualStockXOrderNum}
                                      </span>
                                    </p>
                                    <p>
                                      <span className="font-medium">Purchase:</span>{" "}
                                      {manualStockXOrder.purchaseDate 
                                        ? new Date(manualStockXOrder.purchaseDate).toLocaleString("fr-CH")
                                        : "—"}
                                    </p>
                                    <p>
                                      <span className="font-medium">Product:</span>{" "}
                                      {manualStockXOrder.displayName}
                                    </p>
                                    <p>
                                      <span className="font-medium">SKU:</span>{" "}
                                      {manualStockXOrder.skuKey}
                                    </p>
                                    <p>
                                      <span className="font-medium">Size:</span>{" "}
                                      {manualStockXOrder.size || "—"}
                                    </p>
                                    <p>
                                      <span className="font-medium">Offer:</span> CHF{" "}
                                      {manualStockXOrder.amount?.toFixed(2) || "—"}
                                      {manualStockXOrder.orderNumber && pricingByOrder[manualStockXOrder.orderNumber]?.total && (
                                        <span className="text-green-700 font-semibold ml-2">
                                          (Total: CHF {pricingByOrder[manualStockXOrder.orderNumber]!.total.toFixed(2)})
                                        </span>
                                      )}
                                    </p>
                                    <p>
                                      <span className="font-medium">Status:</span>{" "}
                                      <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100">
                                        {manualStockXOrder.statusKey || "—"}
                                      </span>
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-red-600 text-xs">
                                    ⚠️ Order {manualStockXOrderNum} not found in loaded StockX orders
                                  </p>
                                )}
                                
                                {/* Financial Summary + Manual Cost Override (for manual override) */}
                                {manualStockXOrder && (
                                  <>
                                    <div className="mt-3 pt-2 border-t border-orange-200">
                                      {(() => {
                                        const shopifyRevenue = parseFloat(shopify.totalPrice) || 0;
                                        const pricingData = pricingByOrder[manualStockXOrderNum];
                                        const autoTTC = pricingData?.total || null;
                                        const manualCost = manualCostOverrides[shopify.lineItemId];
                                        const displayCost = manualCost ? parseFloat(manualCost) : (autoTTC || manualStockXOrder.amount || 0);
                                        const marginAmount = shopifyRevenue - displayCost;
                                        const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;
                                        
                                        return (
                                          <>
                                            <div className="text-xs space-y-1 mb-2 p-2 bg-orange-50 rounded">
                                              <p className="font-semibold text-orange-800">💰 Financial Preview:</p>
                                              <p>
                                                <span className="font-medium">Shopify Revenue:</span>{" "}
                                                {shopify.currencyCode} {shopifyRevenue.toFixed(2)}
                                              </p>
                                              <div className="flex items-center gap-2">
                                                <span className="font-medium">Supplier Cost:</span>
                                                <input
                                                  type="number"
                                                  step="0.01"
                                                  value={manualCost || (autoTTC ? autoTTC.toFixed(2) : (manualStockXOrder.amount || 0).toFixed(2))}
                                                  onChange={(e) => setManualCostOverrides({
                                                    ...manualCostOverrides,
                                                    [shopify.lineItemId]: e.target.value
                                                  })}
                                                  className="px-2 py-0.5 border rounded text-xs w-20 font-mono"
                                                  placeholder="Cost"
                                                />
                                                {!autoTTC && <span className="text-orange-600 text-xs">⚠️ No TTC</span>}
                                                {manualCost && <span className="text-blue-600 text-xs">✏️ Manual</span>}
                                              </div>
                                              <p className={`font-semibold ${marginAmount >= 0 ? "text-green-700" : "text-red-700"}`}>
                                                Margin: {shopify.currencyCode} {marginAmount.toFixed(2)} ({marginPercent.toFixed(2)}%)
                                              </p>
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </div>

                                    {/* Metafields Set Button (for manual override) */}
                                    <div className="mt-2">
                                      {metafieldsSet[shopify.lineItemId] ? (
                                      <div className="text-xs">
                                        <div className="flex items-center gap-2 mb-2">
                                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded font-semibold">
                                            ✅ SYNCED TO SHOPIFY
                                          </span>
                                        </div>
                                        <p className="text-gray-600">
                                          Set on: {new Date(metafieldsSet[shopify.lineItemId].timestamp).toLocaleString("fr-CH")}
                                        </p>
                                        <p className="text-gray-600">
                                          StockX Order: {metafieldsSet[shopify.lineItemId].stockxOrderNumber}
                                        </p>
                                        <button
                                          onClick={() => handleSetMetafields(shopify, manualStockXOrderNum)}
                                          disabled={metafieldsLoading[shopify.lineItemId]}
                                          className="mt-2 text-xs text-blue-600 hover:underline disabled:text-gray-400"
                                        >
                                          {metafieldsLoading[shopify.lineItemId] ? "Updating..." : "Update Metafields"}
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => handleSetMetafields(shopify, manualStockXOrderNum)}
                                        disabled={metafieldsLoading[shopify.lineItemId]}
                                        className="w-full px-3 py-2 bg-purple-600 text-white text-sm font-medium rounded hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                      >
                                        {metafieldsLoading[shopify.lineItemId] ? "Setting..." : "📝 Set Metafields on Shopify"}
                                      </button>
                                    )}
                                    </div>
                                  </>
                                )}
                                
                                <button
                                  onClick={() => {
                                    const newOverrides = { ...manualOverrides };
                                    delete newOverrides[shopify.lineItemId];
                                    setManualOverrides(newOverrides);
                                    const newConfirmed = { ...confirmedMatches };
                                    delete newConfirmed[shopify.lineItemId];
                                    setConfirmedMatches(newConfirmed);
                                  }}
                                  className="mt-2 text-xs text-red-600 hover:underline"
                                >
                                  Remove Manual Override
                                </button>
                              </>
                            );
                          })()
                        ) : isLiquidation ? (
                          <div className="text-purple-700 text-center py-4">
                            <p className="text-sm font-semibold">🛍️ Liquidation Product (Manual Match Only)</p>
                            <p className="text-xs mt-2">
                              This is an in-stock liquidation item.
                              <br />
                              Auto-matching disabled - use manual selection below if needed.
                            </p>
                            <input
                              type="text"
                              value={confirmedMatches[shopify.lineItemId] || ""}
                              onChange={(e) =>
                                setConfirmedMatches({
                                  ...confirmedMatches,
                                  [shopify.lineItemId]: e.target.value,
                                })
                              }
                              placeholder="Enter StockX order # manually"
                              className="mt-2 w-full px-2 py-1 border rounded text-xs font-mono"
                            />
                          </div>
                        ) : match ? (
                          <>
                            <h3 className="font-semibold text-sm text-gray-700 mb-2">
                              🎯 Suggested StockX Match
                            </h3>
                            <div className="text-xs space-y-1">
                              <p>
                                <span className="font-medium">Order:</span>{" "}
                                <input
                                  type="text"
                                  value={
                                    confirmedMatches[shopify.lineItemId] ||
                                    match.stockxOrder.stockxOrderNumber
                                  }
                                  onChange={(e) =>
                                    setConfirmedMatches({
                                      ...confirmedMatches,
                                      [shopify.lineItemId]: e.target.value,
                                    })
                                  }
                                  className="inline-block w-32 px-1 py-0.5 border rounded text-xs font-mono"
                                />
                              </p>
                              <p>
                                <span className="font-medium">Purchase:</span>{" "}
                                {new Date(
                                  match.stockxOrder.purchaseDate
                                ).toLocaleString("fr-CH")}
                              </p>
                              <p>
                                <span className="font-medium">Product:</span>{" "}
                                {match.stockxOrder.productTitle}
                              </p>
                              <p>
                                <span className="font-medium">SKU:</span>{" "}
                                {match.stockxOrder.skuKey}
                              </p>
                              <p>
                                <span className="font-medium">Size:</span>{" "}
                                {match.stockxOrder.sizeEU || "—"}
                              </p>
                              <p>
                                <span className="font-medium">Offer:</span> CHF{" "}
                                {match.stockxOrder.offerAmount?.toFixed(2) || "—"}
                                {match.stockxOrder.totalTTC && (
                                  <span className="text-green-700 font-semibold ml-2">
                                    (Total: CHF {match.stockxOrder.totalTTC.toFixed(2)})
                                  </span>
                                )}
                              </p>
                              <p>
                                <span className="font-medium">Status:</span>{" "}
                                {match.stockxOrder.statusKey || "—"}
                              </p>
                            </div>
                            <div className="mt-2 pt-2 border-t border-gray-200">
                              <div className="flex items-center gap-2 text-xs">
                                <span
                                  className={`px-2 py-1 rounded font-semibold ${
                                    match.confidence === "high"
                                      ? "bg-green-200 text-green-800"
                                      : match.confidence === "medium"
                                      ? "bg-blue-200 text-blue-800"
                                      : "bg-gray-200 text-gray-800"
                                  }`}
                                >
                                  {match.confidence.toUpperCase()} (Score: {match.score})
                                </span>
                                <span className="text-gray-600">
                                  {match.timeDiffHours.toFixed(1)}h apart
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-gray-600">
                                {match.reasons.join(" • ")}
                              </div>
                            </div>
                            
                            {/* Financial Summary + Manual Cost Override */}
                            <div className="mt-3 pt-2 border-t border-gray-200">
                              {(() => {
                                const shopifyRevenue = parseFloat(shopify.totalPrice) || 0;
                                const stockxOrderNum = confirmedMatches[shopify.lineItemId] || match.stockxOrder.stockxOrderNumber;
                                const pricingData = pricingByOrder[stockxOrderNum];
                                const autoTTC = pricingData?.total || null;
                                const manualCost = manualCostOverrides[shopify.lineItemId];
                                const displayCost = manualCost ? parseFloat(manualCost) : (autoTTC || match.stockxOrder.offerAmount || 0);
                                const marginAmount = shopifyRevenue - displayCost;
                                const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;
                                
                                return (
                                  <>
                                    <div className="text-xs space-y-1 mb-2 p-2 bg-purple-50 rounded">
                                      <p className="font-semibold text-purple-800">💰 Financial Preview:</p>
                                      <p>
                                        <span className="font-medium">Shopify Revenue:</span>{" "}
                                        {shopify.currencyCode} {shopifyRevenue.toFixed(2)}
                                      </p>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">Supplier Cost:</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={manualCost || (autoTTC ? autoTTC.toFixed(2) : (match.stockxOrder.offerAmount || 0).toFixed(2))}
                                          onChange={(e) => setManualCostOverrides({
                                            ...manualCostOverrides,
                                            [shopify.lineItemId]: e.target.value
                                          })}
                                          className="px-2 py-0.5 border rounded text-xs w-20 font-mono"
                                          placeholder="Cost"
                                        />
                                        {!autoTTC && <span className="text-orange-600 text-xs">⚠️ No TTC</span>}
                                        {manualCost && <span className="text-blue-600 text-xs">✏️ Manual</span>}
                                      </div>
                                      <p className={`font-semibold ${marginAmount >= 0 ? "text-green-700" : "text-red-700"}`}>
                                        Margin: {shopify.currencyCode} {marginAmount.toFixed(2)} ({marginPercent.toFixed(2)}%)
                                      </p>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>

                            {/* Metafields Set Button */}
                            <div className="mt-2">
                              {metafieldsSet[shopify.lineItemId] ? (
                                <div className="text-xs">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="px-2 py-1 bg-green-100 text-green-800 rounded font-semibold">
                                      ✅ SYNCED TO SHOPIFY
                                    </span>
                                  </div>
                                  <p className="text-gray-600">
                                    Set on: {new Date(metafieldsSet[shopify.lineItemId].timestamp).toLocaleString("fr-CH")}
                                  </p>
                                  <p className="text-gray-600">
                                    StockX Order: {metafieldsSet[shopify.lineItemId].stockxOrderNumber}
                                  </p>
                                  <button
                                    onClick={() =>
                                      handleSetMetafields(
                                        shopify,
                                        confirmedMatches[shopify.lineItemId] ||
                                          match.stockxOrder.stockxOrderNumber
                                      )
                                    }
                                    disabled={metafieldsLoading[shopify.lineItemId]}
                                    className="mt-2 text-xs text-blue-600 hover:underline disabled:text-gray-400"
                                  >
                                    {metafieldsLoading[shopify.lineItemId] ? "Updating..." : "Update Metafields"}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() =>
                                    handleSetMetafields(
                                      shopify,
                                      confirmedMatches[shopify.lineItemId] ||
                                        match.stockxOrder.stockxOrderNumber
                                    )
                                  }
                                  disabled={metafieldsLoading[shopify.lineItemId]}
                                  className="w-full px-3 py-2 bg-purple-600 text-white text-sm font-medium rounded hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                >
                                  {metafieldsLoading[shopify.lineItemId] ? "Setting..." : "📝 Set Metafields on Shopify"}
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="text-gray-500 text-center py-4">
                            <p className="text-sm">No match found</p>
                            <p className="text-xs mt-1">Manual selection required</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

