"use client";

import React, { useState, useEffect } from "react";
import {
  matchShopifyToSupplier,
  type NormalizedSupplierOrder,
  type ShopifyLineItem,
  type MatchResult,
  EXCLUDED_SKUS,
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
  // Helper function to safely convert Prisma Decimal to number for display
  const toNumber = (value: any): number => {
    if (typeof value === "number") return value;
    if (typeof value === "string") return parseFloat(value) || 0;
    if (value && typeof value === "object" && "toNumber" in value) return value.toNumber();
    return 0;
  };

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
  const [enrichedOrders, setEnrichedOrders] = useState<any[] | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [detailsProgress, setDetailsProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const [pricingByOrder, setPricingByOrder] = useState<Record<string, PricingResult | null>>({});
  const [pricingLoading, setPricingLoading] = useState<Record<string, boolean>>({});
  
  // Shopify matching state
  const [shopifyItems, setShopifyItems] = useState<ShopifyLineItem[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [loadingShopify, setLoadingShopify] = useState(false);
  const [confirmedMatches, setConfirmedMatches] = useState<Record<string, string>>({});
  const [manualOverrides, setManualOverrides] = useState<Record<string, { supplierOrderNumber: string; method: string }>>({});
  
  // Manual matching state
  const [manualShopifyOrder, setManualShopifyOrder] = useState("");
  const [manualSupplierOrder, setManualSupplierOrder] = useState("");
  const [manualMatchLoading, setManualMatchLoading] = useState(false);
  
  // Metafields state (track which matches have been synced to Shopify)
  const [metafieldsSet, setMetafieldsSet] = useState<Record<string, { timestamp: string; supplierOrderNumber: string }>>({});
  const [metafieldsLoading, setMetafieldsLoading] = useState<Record<string, boolean>>({});
  const [manualCostOverrides, setManualCostOverrides] = useState<Record<string, string>>({});

  // DB + Workers state
  const [dbMatches, setDbMatches] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<any>(null);
  
  // Manual entry modal state
  const [manualEntryModal, setManualEntryModal] = useState<{
    isOpen: boolean;
    shopifyItem: ShopifyLineItem | null;
    mode: 'create' | 'edit';
    matchId?: string;
  }>({ isOpen: false, shopifyItem: null, mode: 'create' });
  const [manualEntryData, setManualEntryData] = useState<any>({});
  const [originalEntryData, setOriginalEntryData] = useState<any>({}); // Pour comparer les changements

  // Load token from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("supplier_token");
    if (savedToken) {
      setToken(savedToken);
      setSaveToken(true);
    }
  }, []);

  // Save/remove token from localStorage
  useEffect(() => {
    if (saveToken && token) {
      localStorage.setItem("supplier_token", token);
    } else {
      localStorage.removeItem("supplier_token");
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
      return { pageInfo: newPageInfo, orders: newOrders };
    } catch (error: any) {
      setLastErrors([{ message: error.message }]);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleFetchFirstPage = async () => {
    await fetchPage(null, false);
  };

  const handleFetchNextPage = async () => {
    if (pageInfo?.endCursor && pageInfo.hasNextPage) {
      await fetchPage(pageInfo.endCursor, true);
    } else {
      alert("No next page available");
    }
  };

  // ✅ Extract AWB (Air Waybill / tracking number) from tracking URL
  const extractAwbFromTrackingUrl = (trackingUrl: string | null): string | null => {
    if (!trackingUrl) {
      console.log(`[AWB] No tracking URL provided`);
      return null;
    }
    
    try {
      const url = new URL(trackingUrl);
      const params = url.searchParams;
      
      // Check common parameter names in order
      const paramNames = ['AWB', 'awb', 'trackingNumber', 'tracking_number', 'waybill', 'consignment', 'shipmentNumber'];
      
      for (const param of paramNames) {
        const value = params.get(param);
        if (value && value.length >= 8) {
          console.log(`[AWB] ✅ Extracted from param "${param}": ${value}`);
          return value;
        }
      }
      
      // Fallback: check if URL path contains AWB pattern
      const pathMatch = trackingUrl.match(/\/([A-Z0-9]{10,})/);
      if (pathMatch && pathMatch[1].length >= 8) {
        console.log(`[AWB] ✅ Extracted from path: ${pathMatch[1]}`);
        return pathMatch[1];
      }
      
      console.log(`[AWB] ❌ Could not extract AWB from: ${trackingUrl}`);
      return null;
    } catch (error) {
      console.log(`[AWB] ❌ Error parsing URL: ${trackingUrl}`);
      return null;
    }
  };

  const handleFetchAllPages = async () => {
    setIsFetchingAll(true);
    setIsEnriching(false);
    setOrders([]);
    setPageInfo(null);
    setEnrichedOrders(null);
    setDetailsProgress({ done: 0, total: 0 });

    // ✅ STEP 1: Fetch all pages with Query A (Buying)
    // Collect orders directly from fetchPage return value
    const allLoadedOrders: OrderNode[] = [];
    
    console.log('[ENRICH] Step 1: Fetching all pages with Query A...');
    
    // First page
    let currentResult = await fetchPage(null, false);
    if (currentResult) {
      allLoadedOrders.push(...currentResult.orders);
      console.log(`[ENRICH] Page 1: ${currentResult.orders.length} orders (total: ${allLoadedOrders.length})`);
    }
    
    // Subsequent pages
    while (currentResult?.pageInfo?.hasNextPage && currentResult?.pageInfo?.endCursor) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      currentResult = await fetchPage(currentResult.pageInfo.endCursor, true);
      if (currentResult) {
        allLoadedOrders.push(...currentResult.orders);
        console.log(`[ENRICH] Page ${Math.ceil(allLoadedOrders.length / 50)}: ${currentResult.orders.length} orders (total: ${allLoadedOrders.length})`);
      }
    }

    setIsFetchingAll(false);
    
    // ✅ STEP 2: Fetch Query B (GET_BUY_ORDER) for each order
    console.log('[ENRICH] Step 2: Fetching Query B for each order...');
    console.log(`[ENRICH] Total orders collected: ${allLoadedOrders.length}`);
    
    if (allLoadedOrders.length === 0) {
      console.error('[ENRICH] ❌ No orders found! Check if fetchPage is working correctly.');
      alert('❌ No orders to enrich. Please try fetching again.');
      return;
    }
    
    setIsEnriching(true);
    
    const total = allLoadedOrders.length;
    console.log(`[ENRICH] Starting enrichment for ${total} orders...`);
    
    const enriched: any[] = [];
    let done = 0;
    
    // ✅ Query B: Minimal working query
    const GET_BUY_ORDER_QUERY = `
  query GET_BUY_ORDER_FULL(
    $chainId: String
    $orderId: String
  ) {
    viewer {
      order(chainId: $chainId, orderId: $orderId) {
        ... on BuyOrder {
          id
          chainId
          orderNumber
          status
          currentStatus {
            key
            completionStatus
          }
          estimatedDeliveryDateRange {
            estimatedDeliveryDate
            latestEstimatedDeliveryDate
          }
          shipping {
            shipment {
              trackingUrl
              deliveryDate
            }
            returnShipment {
              trackingUrl
            }
          }
          currency {
            code
          }
          payment {
            settledAmount {
              value
              currency
            }
            authorizedAmount {
              value
              currency
            }
          }
          pricing {
            finalized {
              local {
                total
                subtotal
              }
            }
          }
          product {
            localizedSize {
              title
            }
            variant {
              id
              product {
                title
                brand
                urlKey
                media {
                  thumbUrl
                  imageUrl
                }
              }
            }
          }
        }
      }
    }
  }
`;
    
    // ✅ OPTIMIZED: Batch parallel processing for faster enrichment
    // Process 5 orders in parallel per batch, with 1.5s delay between batches
    // This reduces time from ~3min (sequential) to ~1.2min (batched) for 94 orders
    const BATCH_SIZE = 40; // Number of parallel requests per batch
    const BATCH_DELAY_MS = 500; // Delay between batches (ms)
    
    console.log(`[ENRICH] 🚀 Starting BATCH processing: ${total} orders in batches of ${BATCH_SIZE}`);
    console.log(`[ENRICH] ⏱️ Estimated time: ~${Math.ceil((total / BATCH_SIZE) * (BATCH_DELAY_MS / 1000))}s (vs ${total * 2}s sequential)`);
    
    // Helper function to fetch single order (extracted for reuse)
    const fetchOrderDetails = async (node: OrderNode): Promise<any> => {
      try {
        const variables = {
          chainId: node.chainId,
          orderId: node.orderId,
        };
        
        const response = await fetch("https://stockx.com/api/p/e", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${token}`,
            "apollographql-client-name": "Iron",
            "apollographql-client-version": "2026.01.04.01",
            "app-platform": "Iron",
            "app-version": "2026.01.04.01",
            "accept": "application/json",
          },
          body: JSON.stringify({
            operationName: "GET_BUY_ORDER_FULL",
            query: GET_BUY_ORDER_QUERY,
            variables,
          }),
        });
        
        const json = await response.json();
        const buyOrder = json.data?.viewer?.order || null;
        const errors = json.errors || [];
        
        // Extract ALL useful fields from Query B
        const trackingUrl = buyOrder?.shipping?.shipment?.trackingUrl || null;
        const awb = extractAwbFromTrackingUrl(trackingUrl);
        
        const supplierCost = buyOrder?.payment?.settledAmount?.value 
          ?? buyOrder?.payment?.authorizedAmount?.value 
          ?? buyOrder?.pricing?.finalized?.local?.total 
          ?? null;
        
        // Extract product info from Query B (more accurate than Query A)
        const productTitleB = buyOrder?.product?.variant?.product?.title || null;
        const brandB = buyOrder?.product?.variant?.product?.brand || null;
        const sizeB = buyOrder?.product?.localizedSize?.title || null;
        const imageUrlB = buyOrder?.product?.variant?.product?.media?.imageUrl || null;
        const thumbUrlB = buyOrder?.product?.variant?.product?.media?.thumbUrl || null;
        
        // Extract status and delivery info
        const statusB = buyOrder?.status || null;
        const statusKeyB = buyOrder?.currentStatus?.key || null;
        const estimatedDeliveryB = buyOrder?.estimatedDeliveryDateRange?.estimatedDeliveryDate || null;
        const latestEstimatedDeliveryB = buyOrder?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate || null;
        
        const enrichedData = {
          ...node, // ✅ Keep ALL Query A data (includes SKU: styleId, model, etc.)
          buyOrder,
          errors,
          awb,
          supplierCost,
          productTitleB,
          brandB,
          sizeB,
          imageUrlB,
          thumbUrlB,
          statusB,
          statusKeyB,
          trackingUrl,
          estimatedDeliveryB,
          latestEstimatedDeliveryB,
        };
        
        return {
          node,
          enriched: enrichedData,
          success: !!buyOrder,
          productTitleB: productTitleB || null,
          sizeB: sizeB || null,
          brandB: brandB || null,
          supplierCost: supplierCost || null,
          statusKeyB: statusKeyB || null,
          statusB: statusB || null,
          awb: awb || null,
          trackingUrl: trackingUrl || null,
        };
      } catch (error: any) {
        console.error(`[ENRICH] Error fetching ${node.orderNumber}:`, error.message);
        return {
          node,
          enriched: {
            ...node,
            buyOrder: null,
            errors: [{ message: error.message }],
            awb: null,
            supplierCost: null,
          },
          success: false,
          error: error.message,
        };
      }
    };
    
    // Process orders in batches
    const totalBatches = Math.ceil(total / BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, total);
      const batch = allLoadedOrders.slice(batchStart, batchEnd);
      const batchNum = batchIndex + 1;
      
      console.log(`[ENRICH] 📦 Batch ${batchNum}/${totalBatches}: Processing ${batch.length} orders in parallel...`);
      
      // Process all orders in this batch in parallel
      const batchPromises = batch.map(node => fetchOrderDetails(node));
      const batchResults = await Promise.all(batchPromises);
      
      // Process results and update progress
      for (const result of batchResults) {
        enriched.push(result.enriched);
        done++;
        setDetailsProgress({ done, total });
        
        if (result.success) {
          console.log(`[ENRICH] ${done}/${total}: ${result.node.orderNumber} ✅`);
          console.log(`  Product: ${result.productTitleB || 'N/A'}`);
          console.log(`  Size: ${result.sizeB || 'N/A'} | Brand: ${result.brandB || 'N/A'}`);
          console.log(`  Cost: ${result.supplierCost || 'N/A'} CHF | Status: ${result.statusKeyB || result.statusB || 'N/A'}`);
          console.log(`  AWB: ${result.awb || 'N/A'} | Tracking: ${result.trackingUrl ? '✅' : '❌'}`);
        } else {
          console.log(`[ENRICH] ${done}/${total}: ${result.node.orderNumber} ❌ (${result.error || 'no data'})`);
        }
      }
      
      // Wait before next batch (except after the last batch)
      if (batchNum < totalBatches) {
        const remainingBatches = totalBatches - batchNum;
        const estimatedSecondsRemaining = Math.ceil(remainingBatches * (BATCH_DELAY_MS / 1000));
        console.log(`[ENRICH] ⏳ Waiting ${BATCH_DELAY_MS / 1000}s before next batch... (~${estimatedSecondsRemaining}s remaining)`);
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    
    console.log(`[ENRICH] ✅ Complete: ${enriched.length} orders enriched`);
    
    // ✅ CRITICAL: Verify no duplicates and data integrity
    const enrichedIds = enriched.map(o => o.orderId);
    const uniqueIds = new Set(enrichedIds);
    
    if (uniqueIds.size !== enriched.length) {
      console.error(`[ENRICH] ⚠️ WARNING: Found duplicates! ${enriched.length} orders but only ${uniqueIds.size} unique IDs`);
      // Remove duplicates (keep first occurrence)
      const seen = new Set<string>();
      const deduplicated = enriched.filter(o => {
        if (seen.has(o.orderId)) {
          console.log(`[ENRICH] Removing duplicate: ${o.orderNumber} (${o.orderId})`);
          return false;
        }
        seen.add(o.orderId);
        return true;
      });
      console.log(`[ENRICH] Deduplicated: ${deduplicated.length} orders (removed ${enriched.length - deduplicated.length} duplicates)`);
      setEnrichedOrders(deduplicated);
    } else {
      console.log(`[ENRICH] ✅ No duplicates detected (${uniqueIds.size} unique orders)`);
      setEnrichedOrders(enriched);
    }
    
    // ✅ VERIFY: Query A fields are preserved
    const sampleOriginal = allLoadedOrders[0];
    const sampleEnriched = enriched[0];
    console.log(`[ENRICH] Data integrity check (first order):`);
    console.log(`  Query A fields preserved:`, {
      orderNumber: sampleOriginal.orderNumber === sampleEnriched.orderNumber,
      displayName: sampleOriginal.displayName === sampleEnriched.displayName,
      size: sampleOriginal.size === sampleEnriched.size,
      skuKey: sampleOriginal.skuKey === sampleEnriched.skuKey,
      amount: sampleOriginal.amount === sampleEnriched.amount,
    });
    console.log(`  New Query B fields added:`, {
      hasAwb: !!sampleEnriched.awb,
      hasSupplierCost: !!sampleEnriched.supplierCost,
      hasProductTitleB: !!sampleEnriched.productTitleB,
      hasSizeB: !!sampleEnriched.sizeB,
    });
    
    setIsEnriching(false);
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
    link.setAttribute("download", "supplier_orders.csv");
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

      // Normalize Supplier orders for matching (use enriched if available)
      // ✅ Use enriched orders if available (prefer enriched for AWB + supplierCost)
      const sourceOrders = enrichedOrders || orders;
      console.log(`[MATCHING] Using ${enrichedOrders ? 'ENRICHED' : 'BASIC'} orders (${sourceOrders.length} total)`);
      
      // ✅ CRITICAL: Verify no duplicates in source
      const sourceIds = sourceOrders.map(o => o.orderId);
      const uniqueSourceIds = new Set(sourceIds);
      if (uniqueSourceIds.size !== sourceOrders.length) {
        console.error(`[MATCHING] ⚠️ WARNING: Source has duplicates! ${sourceOrders.length} orders but only ${uniqueSourceIds.size} unique IDs`);
      }
      
      const normalizedSupplier: NormalizedSupplierOrder[] = sourceOrders.map((o) => {
        // ✅ Priority 1: Use Query B supplierCost (if enriched)
        // ✅ Priority 2: Fallback to old pricingByOrder system
        const supplierCostFromB = (o as any).supplierCost ?? null;
        const supplierCostFromPricing = o.orderNumber && pricingByOrder[o.orderNumber]?.total != null
          ? pricingByOrder[o.orderNumber]!.total
          : null;
        
        const finalTotalTTC = supplierCostFromB ?? supplierCostFromPricing;
        
        return {
          supplierOrderNumber: o.orderNumber || "",
          chainId: o.chainId || "",
          orderId: o.orderId || "",
          purchaseDate: o.purchaseDate || "",
          offerAmount: o.amount,
          totalTTC: finalTotalTTC,  // ✅ Query B supplier cost (priority)
          productTitle: o.displayName,  // ✅ Query A
          skuKey: o.skuKey,             // ✅ Query A
          sizeEU: o.size,               // ✅ Query A
          statusKey: o.statusKey,       // ✅ Query A
          statusTitle: o.statusTitle,   // ✅ Query A
          currencyCode: o.currencyCode, // ✅ Query A
          awb: (o as any).awb || null,  // ✅ Query B AWB (tracking number)
          trackingUrl: (o as any).trackingUrl || null,  // ✅ Query B full tracking URL
        };
      });
      
      console.log(`[MATCHING] Normalized ${normalizedSupplier.length} supplier orders for matching`);
      
      // ✅ Count how many have Query B supplierCost
      const withSupplierCostB = normalizedSupplier.filter(o => o.totalTTC !== null).length;
      console.log(`[MATCHING] ${withSupplierCostB}/${normalizedSupplier.length} orders have totalTTC (Query B supplier cost)`);
      
      console.log(`[MATCHING] Sample normalized order:`, {
        orderNumber: normalizedSupplier[0]?.supplierOrderNumber,
        productTitle: normalizedSupplier[0]?.productTitle,
        skuKey: normalizedSupplier[0]?.skuKey,
        sizeEU: normalizedSupplier[0]?.sizeEU,
        totalTTC: normalizedSupplier[0]?.totalTTC,  // ✅ Should show Query B cost
      });

      // 🔒 CRITICAL: Filter out already-matched Supplier orders
      let availableSupplier = normalizedSupplier;
      try {
        const dbRes = await fetch("/api/db/matches");
        if (dbRes.ok) {
          const dbData = await dbRes.json();
          const usedSupplierNumbers = new Set(
            dbData.matches.map((m: any) => m.supplierOrderNumber)
          );
          
          const beforeCount = normalizedSupplier.length;
          availableSupplier = normalizedSupplier.filter(
            (order) => !usedSupplierNumbers.has(order.supplierOrderNumber)
          );
          
          const filteredOut = normalizedSupplier.filter(
            (order) => usedSupplierNumbers.has(order.supplierOrderNumber)
          );
          
          console.log(`🔒 DB has ${dbData.matches.length} total matches`);
          console.log(`🔒 Filtered out ${beforeCount - availableSupplier.length} already-matched Supplier orders:`, 
            filteredOut.map(o => o.supplierOrderNumber).join(", "));
          console.log(`✅ ${availableSupplier.length} Supplier orders available for matching`);
          
          if (availableSupplier.length === 0 && normalizedSupplier.length > 0) {
            console.warn(`⚠️ WARNING: All ${normalizedSupplier.length} Supplier orders are already matched!`);
          }
        } else {
          console.error("❌ Failed to fetch DB matches, showing all Supplier orders");
        }
      } catch (err) {
        console.error("❌ Error fetching DB matches, showing all Supplier orders:", err);
      }

      // Run matching (only with AVAILABLE Supplier orders)
      const results = items.map((item: ShopifyLineItem) =>
        matchShopifyToSupplier(item, availableSupplier)
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
    if (!manualShopifyOrder.trim() || !manualSupplierOrder.trim()) {
      alert("Please enter both Shopify and Supplier order numbers");
      return;
    }

    setManualMatchLoading(true);

    try {
      // Clean input
      const cleanShopifyNum = manualShopifyOrder.replace("#", "").trim();
      const cleanSupplierNum = manualSupplierOrder.trim();

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
            `This will match the Supplier order to the FIRST line item:\n` +
            `"${fetchedLineItems[0].title}"\n\n` +
            `Continue?`
          );
          if (!proceed) return;
        }

        shopifyItem = fetchedLineItems[0];
        console.log(`[MANUAL MATCH] Fetched Shopify order #${cleanShopifyNum}:`, shopifyItem);

        // Create match results for the fetched items (to show auto-suggestions if user wants)
        const sourceOrders = enrichedOrders || orders;
        console.log(`[MANUAL MATCH] Using ${enrichedOrders ? 'ENRICHED' : 'BASIC'} orders (${sourceOrders.length} total)`);
        
        const normalizedSupplier: NormalizedSupplierOrder[] = sourceOrders.map((o) => {
          // ✅ Priority 1: Use Query B supplierCost (if enriched)
          // ✅ Priority 2: Fallback to old pricingByOrder system
          const supplierCostFromB = (o as any).supplierCost ?? null;
          const supplierCostFromPricing = o.orderNumber && pricingByOrder[o.orderNumber]?.total != null
            ? pricingByOrder[o.orderNumber]!.total
            : null;
          
          const finalTotalTTC = supplierCostFromB ?? supplierCostFromPricing;
          
          return {
            supplierOrderNumber: o.orderNumber || "",
            chainId: o.chainId || "",
            orderId: o.orderId || "",
            purchaseDate: o.purchaseDate || "",
            offerAmount: o.amount,
            totalTTC: finalTotalTTC,  // ✅ Query B supplier cost (priority)
            productTitle: o.displayName,  // ✅ Query A
            skuKey: o.skuKey,             // ✅ Query A
            sizeEU: o.size,               // ✅ Query A
            statusKey: o.statusKey,       // ✅ Query A
            statusTitle: o.statusTitle,   // ✅ Query A
            currencyCode: o.currencyCode, // ✅ Query A
            awb: (o as any).awb || null,  // ✅ Query B AWB (tracking number)
            trackingUrl: (o as any).trackingUrl || null,  // ✅ Query B full tracking URL
          };
        });

        const newMatchResults = fetchedLineItems.map((item: ShopifyLineItem) =>
          matchShopifyToSupplier(item, normalizedSupplier)
        );

        setMatchResults((prev) => [...prev, ...newMatchResults]);
      }

      // 3. Final safety check (should never happen, but TypeScript needs it)
      if (!shopifyItem) {
        alert(`❌ Internal error: Shopify item not found after fetch`);
        return;
      }

      // 4. Check if Supplier order exists (optional warning)
      const supplierOrder = orders.find((o) => o.orderNumber === cleanSupplierNum);

      if (!supplierOrder) {
        const proceed = confirm(
          `⚠️ Supplier order ${cleanSupplierNum} not found in currently loaded Supplier orders.\n\n` +
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
          supplierOrderNumber: cleanSupplierNum,
          method: "MANUAL_OVERRIDE",
        },
      });

      setConfirmedMatches({
        ...confirmedMatches,
        [shopifyItem.lineItemId]: cleanSupplierNum,
      });

      console.log(`✅ Manual match created: ${shopifyItem.orderName} → ${cleanSupplierNum}`);
      alert(
        `✅ Manual match saved!\n\n` +
        `${shopifyItem.orderName} → ${cleanSupplierNum}\n\n` +
        `Product: ${shopifyItem.title}`
      );

      // Clear inputs
      setManualShopifyOrder("");
      setManualSupplierOrder("");
    } catch (error: any) {
      console.error("[MANUAL MATCH] Error:", error);
      alert(`❌ Error creating manual match:\n\n${error.message}`);
    } finally {
      setManualMatchLoading(false);
    }
  };

  const handleSetMetafields = async (shopifyItem: ShopifyLineItem, supplierOrderNumber: string) => {
    const lineItemId = shopifyItem.lineItemId;
    
    setMetafieldsLoading((prev) => ({ ...prev, [lineItemId]: true }));

    try {
      // Find the Supplier order for additional details
      // ✅ Try enrichedOrders first (has AWB), fallback to orders
      const supplierOrder = (enrichedOrders || orders).find((o) => o.orderNumber === supplierOrderNumber);

      if (!supplierOrder) {
        alert(`⚠️ Supplier order ${supplierOrderNumber} not found in loaded orders.\n\nPlease fetch the Supplier order first.`);
        return;
      }
      
      // ✅ Extract AWB and tracking URL from enriched order (if available)
      const stockxAwb = (supplierOrder as any).awb || null;
      const stockxTrackingUrl = (supplierOrder as any).trackingUrl || null;

      // Calculate financials
      // 1. Shopify revenue (sale price for this line item)
      const shopifyRevenue = parseFloat(shopifyItem.totalPrice) || 0;
      
      // 2. Supplier cost (Supplier total TTC or manual override)
      let supplierCost = 0;
      
      // Check for manual override first
      if (manualCostOverrides[lineItemId]) {
        supplierCost = parseFloat(manualCostOverrides[lineItemId]) || 0;
      } else {
        // ✅ Priority 1: Use Query B supplierCost (if enriched)
        const supplierCostFromB = (supplierOrder as any).supplierCost ?? null;
        
        // ✅ Priority 2: Try to get TTC from old pricing data
        const pricingData = pricingByOrder[supplierOrderNumber];
        const supplierCostFromPricing = pricingData?.total ?? null;
        
        if (supplierCostFromB != null) {
          // ✅ Use Query B cost (most accurate)
          supplierCost = supplierCostFromB;
          console.log(`[METAFIELDS] Using Query B supplier cost: ${supplierCost} CHF for ${supplierOrderNumber}`);
        } else if (supplierCostFromPricing != null) {
          // Use old pricing system
          supplierCost = supplierCostFromPricing;
          console.log(`[METAFIELDS] Using pricing system cost: ${supplierCost} CHF for ${supplierOrderNumber}`);
        } else {
          // Fallback to offer amount (not ideal, but better than nothing)
          supplierCost = supplierOrder.amount || 0;
          
          // Prompt user to confirm or enter manual cost
          const manualCostInput = prompt(
            `⚠️ No TTC pricing found for Supplier order ${supplierOrderNumber}\n\n` +
            `Offer amount: ${supplierCost.toFixed(2)} ${supplierOrder.currencyCode || "CHF"}\n\n` +
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
        `📦 Supplier Data:\n` +
        `- Order Number: ${supplierOrderNumber}\n` +
        `- Status: ${supplierOrder.statusKey || "UNKNOWN"}\n` +
        `- Estimated Delivery: ${supplierOrder.estimatedDeliveryDate || "N/A"}\n\n` +
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
          stockxOrderNumber: supplierOrderNumber,
          estimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
          stockxStatus: supplierOrder.statusKey || "UNKNOWN",
          supplierCost: supplierCost.toFixed(2),
          marginAmount: marginAmount.toFixed(2),
          marginPercent: marginPercent.toFixed(2),
          trackingNumber: stockxAwb, // ✅ Pass AWB to metafields
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
          supplierOrderNumber,
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
            stockxChainId: supplierOrder.chainId || null, // ✅ Pass chainId for Query B
            stockxOrderId: supplierOrder.orderId || null, // ✅ Pass orderId for Query B
            stockxOrderNumber: supplierOrderNumber,
            stockxProductName: supplierOrder.displayName,
            stockxSizeEU: supplierOrder.size,
            stockxSkuKey: supplierOrder.skuKey,
            matchConfidence: bestMatch?.confidence || "manual",
            matchScore: bestMatch?.score || 0,
            matchType: manualOverrides[lineItemId] ? "manual" : "auto",
            matchReasons: bestMatch?.reasons || ["Manual match"],
            timeDiffHours: bestMatch?.timeDiffHours || 0,
            stockxStatus: supplierOrder.statusKey || "",
            stockxAwb: stockxAwb, // ✅ Pass AWB to DB
            stockxTrackingUrl: stockxTrackingUrl, // ✅ Pass full tracking URL to DB
            stockxEstimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
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
          const errorData = await saveRes.json().catch(() => ({}));
          console.error(`[METAFIELDS] ❌ Failed to save to database:`, errorData);
          console.error(`Status: ${saveRes.status}, Error:`, errorData.error || errorData);
        }
      } catch (dbError: any) {
        console.error("[METAFIELDS] Database save error:", dbError);
        // Don't fail the whole operation if DB save fails
      }

      alert(
        `✅ Metafields set successfully on Shopify!\n\n` +
        `${shopifyItem.orderName} → ${supplierOrderNumber}\n\n` +
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

  // Manual override state
  const [manualOverrideExpanded, setManualOverrideExpanded] = useState<Record<string, boolean>>({});
  const [manualOverrideData, setManualOverrideData] = useState<Record<string, {
    status: string;
    adjustment: string;
    note: string;
    manualCost: string;
  }>>({});
  const [manualOverrideLoading, setManualOverrideLoading] = useState<Record<string, boolean>>({});

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
      alert("⚠️ Please enter your Supplier token first");
      return;
    }

    setSyncLoading(true);
    setLastSyncResult(null);
    
    try {
      console.log("[SYNC] Triggering new-orders sync...");
      const res = await fetch("/api/sync/new-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ supplierToken: token }),
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

      // 🚀 AUTO-SYNC TO DASHBOARD
      try {
        console.log("[SYNC] Auto-syncing to dashboard...");
        const metricsRes = await fetch("/api/metrics/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
        });

        if (metricsRes.ok) {
          const metricsData = await metricsRes.json();
          console.log("[SYNC] ✅ Dashboard sync complete:", metricsData);
        } else {
          console.warn("[SYNC] ⚠️ Dashboard sync failed, but order sync succeeded");
        }
      } catch (metricsError) {
        console.warn("[SYNC] ⚠️ Dashboard sync error:", metricsError);
      }

      // Reload DB matches
      await loadFromDB();
    } catch (error: any) {
      console.error("[SYNC] Error:", error);
      alert(`❌ Sync failed:\n\n${error.message}`);
    } finally {
      setSyncLoading(false);
    }
  };

  // Create manual cost-only entry (for liquidation / Essential Hoodie)
  const createManualCostEntry = async (shopifyItem: ShopifyLineItem) => {
    const isLiquidation = /%/.test(shopifyItem.title);
    
    // ✅ SIMPLE: If SKU is in EXCLUDED_SKUS → Essential Hoodie (auto 42 CHF)
    // Otherwise → ignore (let normal StockX matching happen)
    const isEssentialHoodie = shopifyItem.sku && EXCLUDED_SKUS.includes(shopifyItem.sku);

    let supplierCost: number;

    if (isEssentialHoodie) {
      // Auto-apply 42 CHF for Essential Hoodies
      const autoConfirm = confirm(
        `💰 Essential Hoodie Detected!\n\n` +
        `Product: ${shopifyItem.title}\n` +
        `SKU: ${shopifyItem.sku}\n\n` +
        `Auto-apply 42 CHF supplier cost?\n\n` +
        `Click OK to auto-apply 42 CHF\n` +
        `Click Cancel to enter custom cost`
      );

      if (autoConfirm) {
        supplierCost = 42;
      } else {
        const customInput = prompt(`Enter custom supplier cost for ${shopifyItem.title}:`, "42");
        if (!customInput) return;
        supplierCost = parseFloat(customInput);
        if (isNaN(supplierCost) || supplierCost < 0) {
          alert("❌ Invalid cost. Please enter a positive number.");
          return;
        }
      }
    } else {
      // Liquidation or other manual cost
      const promptMessage = isLiquidation
        ? `💰 Liquidation Order: ${shopifyItem.title}\n\nEnter your buy price (supplier cost) in CHF:`
        : `💰 Manual Cost Entry: ${shopifyItem.title}\n\nEnter supplier cost in CHF:`;

      const supplierCostInput = prompt(promptMessage, "");

      if (!supplierCostInput) return;

      supplierCost = parseFloat(supplierCostInput);
      if (isNaN(supplierCost) || supplierCost < 0) {
        alert("❌ Invalid cost. Please enter a positive number.");
        return;
      }
    }

    const revenue = parseFloat(shopifyItem.totalPrice);
    const margin = revenue - supplierCost;
    const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0;

    const confirmMessage = 
      `📝 Create Manual Cost Entry?\n\n` +
      `Order: ${shopifyItem.orderName}\n` +
      `Product: ${shopifyItem.title}\n` +
      `Size: ${shopifyItem.sizeEU || "N/A"}\n\n` +
      `💰 Financial Summary:\n` +
      `Revenue: CHF ${revenue.toFixed(2)}\n` +
      `Supplier Cost: CHF ${supplierCost.toFixed(2)}\n` +
      `Margin: CHF ${margin.toFixed(2)} (${marginPercent.toFixed(1)}%)\n\n` +
      `⚠️ This will:\n` +
      `✅ Add to dashboard metrics\n` +
      `✅ Mark as "MANUAL_COST" (no Supplier link)\n` +
      `❌ NOT appear in fulfillment queue\n` +
      `${isLiquidation ? "✅ Track liquidation sale\n" : ""}` +
      `${isEssentialHoodie ? "✅ Track Essential Hoodie with 42 CHF cost\n" : ""}`;

    if (!confirm(confirmMessage)) return;

    try {
      const res = await fetch("/api/db/save-match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: shopifyItem.shopifyOrderId,
          shopifyOrderName: shopifyItem.orderName,
          shopifyLineItemId: shopifyItem.lineItemId,
          shopifyProductTitle: shopifyItem.title,
          shopifySku: shopifyItem.sku,
          shopifySizeEU: shopifyItem.sizeEU,
          shopifyTotalPrice: revenue,
          shopifyCurrencyCode: shopifyItem.currencyCode,
          stockxOrderNumber: null, // Will be auto-generated as MANUAL-xxx
          stockxProductName: shopifyItem.title,
          stockxSizeEU: shopifyItem.sizeEU,
          stockxSkuKey: shopifyItem.sku,
          matchConfidence: "manual",
          matchScore: 100,
          matchType: "MANUAL_COST",
          matchReasons: [isLiquidation ? "Liquidation order (% in title)" : isEssentialHoodie ? "Essential Hoodie (auto 42 CHF)" : "Manual cost entry"],
          timeDiffHours: 0,
          stockxStatus: "MANUAL_COST_ONLY",
          stockxEstimatedDelivery: null,
          supplierCost,
          marginAmount: margin,
          marginPercent,
          manualCostOverride: supplierCost,
          shopifyMetafieldsSynced: false,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(`❌ Failed to create entry:\n\n${result.error}\n\n${result.details || ""}`);
        return;
      }

      alert(
        `✅ Manual cost entry created!\n\n` +
        `Order: ${shopifyItem.orderName}\n` +
        `Product: ${shopifyItem.title}\n` +
        `Revenue: CHF ${revenue.toFixed(2)}\n` +
        `Cost: CHF ${supplierCost.toFixed(2)}\n` +
        `Margin: CHF ${margin.toFixed(2)} (${marginPercent.toFixed(1)}%)\n\n` +
        `✅ Added to dashboard\n` +
        `🔒 Won't appear in fulfillment`
      );

      // Reload to show new entry
      await loadFromDB();

    } catch (error: any) {
      console.error("[MANUAL_COST] Error:", error);
      alert(`❌ Error creating entry:\n\n${error.message}`);
    }
  };

  // ✅ NEW: Open full manual entry modal with ALL DB fields (CREATE mode)
  const openManualEntryModal = (shopifyItem: ShopifyLineItem) => {
    // Pre-fill with intelligent defaults
    const defaultData = {
      // Shopify data (pre-filled)
      shopifyOrderId: shopifyItem.shopifyOrderId,
      shopifyOrderName: shopifyItem.orderName,
      shopifyLineItemId: shopifyItem.lineItemId,
      shopifyProductTitle: shopifyItem.title,
      shopifySku: shopifyItem.sku || "",
      shopifySizeEU: shopifyItem.sizeEU || "",
      shopifyTotalPrice: parseFloat(shopifyItem.totalPrice),
      shopifyCurrencyCode: shopifyItem.currencyCode || "CHF",
      
      // Supplier data (can be filled manually)
      stockxOrderNumber: "",
      stockxChainId: "",
      stockxOrderId: "",
      stockxProductName: shopifyItem.title, // Default to Shopify title
      stockxSizeEU: shopifyItem.sizeEU || "",
      stockxSkuKey: shopifyItem.sku || "",
      stockxPurchaseDate: new Date().toISOString().slice(0, 16), // Current datetime
      stockxStatus: "MANUAL",
      stockxAwb: "",
      stockxTrackingUrl: "",
      stockxEstimatedDelivery: "",
      
      // Financial data
      supplierCost: "",
      marginAmount: "",
      marginPercent: "",
      
      // Match metadata
      matchConfidence: "manual",
      matchScore: 100,
      matchType: "MANUAL",
      matchReasons: "Manual entry",
      timeDiffHours: 0,
      
      // Optional fields
      manualCostOverride: "",
      manualNote: "",
      shopifyMetafieldsSynced: false,
    };
    
    setManualEntryData(defaultData);
    setOriginalEntryData({});
    setManualEntryModal({ isOpen: true, shopifyItem, mode: 'create' });
  };

  // ✅ NEW: Open modal for EDITING existing entry
  const openManualEntryModalForEdit = (match: any) => {
    // Pre-fill with existing data from DB
    const existingData = {
      // Shopify data
      shopifyOrderId: match.shopifyOrderId,
      shopifyOrderName: match.shopifyOrderName,
      shopifyLineItemId: match.shopifyLineItemId,
      shopifyProductTitle: match.shopifyProductTitle,
      shopifySku: match.shopifySku || "",
      shopifySizeEU: match.shopifySizeEU || "",
      shopifyTotalPrice: toNumber(match.shopifyTotalPrice),
      shopifyCurrencyCode: match.shopifyCurrencyCode || "CHF",
      
      // Supplier data
      stockxOrderNumber: match.stockxOrderNumber || "",
      stockxChainId: match.stockxChainId || "",
      stockxOrderId: match.stockxOrderId || "",
      stockxProductName: match.stockxProductName || "",
      stockxSizeEU: match.stockxSizeEU || "",
      stockxSkuKey: match.stockxSkuKey || "",
      stockxPurchaseDate: match.stockxPurchaseDate 
        ? new Date(match.stockxPurchaseDate).toISOString().slice(0, 16) 
        : "",
      stockxStatus: match.stockxStatus || "MANUAL",
      stockxAwb: match.stockxAwb || "",
      stockxTrackingUrl: match.stockxTrackingUrl || "",
      stockxEstimatedDelivery: match.stockxEstimatedDelivery 
        ? new Date(match.stockxEstimatedDelivery).toISOString().slice(0, 16)
        : "",
      
      // Financial data
      supplierCost: toNumber(match.supplierCost).toString(),
      marginAmount: toNumber(match.marginAmount).toString(),
      marginPercent: toNumber(match.marginPercent).toString(),
      
      // Match metadata
      matchConfidence: match.matchConfidence || "manual",
      matchScore: match.matchScore || 100,
      matchType: match.matchType || "MANUAL",
      matchReasons: match.matchReasons || "Manual entry",
      timeDiffHours: toNumber(match.timeDiffHours) || 0,
      
      // Optional fields
      manualCostOverride: match.manualCostOverride ? toNumber(match.manualCostOverride).toString() : "",
      manualNote: match.manualNote || "",
      shopifyMetafieldsSynced: match.shopifyMetafieldsSynced || false,
    };
    
    setManualEntryData(existingData);
    setOriginalEntryData(existingData); // Store original for comparison
    setManualEntryModal({ 
      isOpen: true, 
      shopifyItem: null, // No shopify item in edit mode
      mode: 'edit',
      matchId: match.id 
    });
  };

  // ✅ NEW: Save manual entry with ALL fields (CREATE or EDIT with partial update)
  const saveManualEntry = async () => {
    const isEditMode = manualEntryModal.mode === 'edit';
    
    // In create mode, shopifyItem must exist
    if (!isEditMode && !manualEntryModal.shopifyItem) return;
    
    try {
      // Calculate margin if supplier cost is provided
      const supplierCost = parseFloat(manualEntryData.supplierCost) || 0;
      const revenue = manualEntryData.shopifyTotalPrice || 0;
      const marginAmount = revenue - supplierCost;
      const marginPercent = revenue > 0 ? (marginAmount / revenue) * 100 : 0;
      
      let saveData: any;
      
      if (isEditMode) {
        // ✅ EDIT MODE: Send ALL current data (ensures upsert works)
        // Track changed fields for logging only
        const changedFields: string[] = [];
        
        Object.keys(manualEntryData).forEach(key => {
          const oldValue = originalEntryData[key];
          const newValue = manualEntryData[key];
          
          const isChanged = (oldValue !== newValue) && 
            !((!oldValue || oldValue === "") && (!newValue || newValue === ""));
          
          if (isChanged) {
            changedFields.push(key);
            console.log(`[EDIT] Changed field "${key}": "${oldValue}" → "${newValue}"`);
          }
        });
        
        // Build complete data object with all current values
        saveData = {
          // Shopify fields
          shopifyOrderId: manualEntryData.shopifyOrderId,
          shopifyOrderName: manualEntryData.shopifyOrderName,
          shopifyLineItemId: manualEntryData.shopifyLineItemId,
          shopifyProductTitle: manualEntryData.shopifyProductTitle,
          shopifySku: manualEntryData.shopifySku || null,
          shopifySizeEU: manualEntryData.shopifySizeEU || null,
          shopifyTotalPrice: manualEntryData.shopifyTotalPrice,
          shopifyCurrencyCode: manualEntryData.shopifyCurrencyCode || "CHF",
          
          // Supplier fields
          stockxOrderNumber: manualEntryData.stockxOrderNumber || `MANUAL-${Date.now()}`,
          stockxChainId: manualEntryData.stockxChainId || null,
          stockxOrderId: manualEntryData.stockxOrderId || null,
          stockxProductName: manualEntryData.stockxProductName || manualEntryData.shopifyProductTitle,
          stockxSizeEU: manualEntryData.stockxSizeEU || null,
          stockxSkuKey: manualEntryData.stockxSkuKey || null,
          stockxPurchaseDate: manualEntryData.stockxPurchaseDate || null,
          stockxStatus: manualEntryData.stockxStatus || "MANUAL",
          stockxAwb: manualEntryData.stockxAwb || null,
          stockxTrackingUrl: manualEntryData.stockxTrackingUrl || null,
          stockxEstimatedDelivery: manualEntryData.stockxEstimatedDelivery || null,
          
          // Match metadata
          matchConfidence: manualEntryData.matchConfidence || "manual",
          matchScore: parseFloat(manualEntryData.matchScore?.toString() || "100"),
          matchType: manualEntryData.matchType || "MANUAL",
          matchReasons: Array.isArray(manualEntryData.matchReasons) 
            ? manualEntryData.matchReasons 
            : [manualEntryData.matchReasons || "Manual entry"],
          timeDiffHours: parseFloat(manualEntryData.timeDiffHours?.toString() || "0"),
          
          // Financial fields (always recalculate)
          supplierCost: supplierCost,
          marginAmount: marginAmount,
          marginPercent: marginPercent,
          
          // Optional fields
          manualCostOverride: manualEntryData.manualCostOverride ? parseFloat(manualEntryData.manualCostOverride) : null,
          manualNote: manualEntryData.manualNote || null,
          shopifyMetafieldsSynced: manualEntryData.shopifyMetafieldsSynced || false,
        };
        
        console.log(`[EDIT] Updating entry with ${changedFields.length} changed field(s):`, changedFields);
        
        // Store count for alert message (will be filtered out by API)
        (saveData as any).__changedFieldsCount = changedFields.length;
        
      } else {
        // ✅ CREATE MODE: Send all fields
        saveData = {
          ...manualEntryData,
          supplierCost: supplierCost || 0,
          marginAmount,
          marginPercent,
          // Convert empty strings to null
          stockxOrderNumber: manualEntryData.stockxOrderNumber || `MANUAL-${Date.now()}`,
          stockxChainId: manualEntryData.stockxChainId || null,
          stockxOrderId: manualEntryData.stockxOrderId || null,
          stockxPurchaseDate: manualEntryData.stockxPurchaseDate || null,
          stockxEstimatedDelivery: manualEntryData.stockxEstimatedDelivery || null,
          stockxAwb: manualEntryData.stockxAwb || null,
          stockxTrackingUrl: manualEntryData.stockxTrackingUrl || null,
          manualCostOverride: manualEntryData.manualCostOverride ? parseFloat(manualEntryData.manualCostOverride) : null,
          matchReasons: Array.isArray(manualEntryData.matchReasons) 
            ? manualEntryData.matchReasons 
            : [manualEntryData.matchReasons || "Manual entry"],
        };
      }
      
      const res = await fetch("/api/db/save-match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(saveData),
      });
      
      const result = await res.json();
      
      if (!res.ok) {
        alert(`❌ Failed to save:\n\n${result.error}\n\n${result.details || ""}`);
        return;
      }
      
      const modeText = isEditMode ? "updated" : "saved";
      const changedCount = isEditMode ? (saveData as any).__changedFieldsCount || 0 : 0;
      alert(
        `✅ Manual entry ${modeText}!\n\n` +
        `Order: ${manualEntryData.shopifyOrderName}\n` +
        `Supplier Order: ${saveData.stockxOrderNumber || manualEntryData.stockxOrderNumber}\n` +
        `Cost: CHF ${supplierCost.toFixed(2)}\n` +
        `Margin: CHF ${marginAmount.toFixed(2)} (${marginPercent.toFixed(1)}%)\n\n` +
        (isEditMode && changedCount > 0 ? `${changedCount} field(s) modified` : "")
      );
      
      // Close modal and reload
      setManualEntryModal({ isOpen: false, shopifyItem: null, mode: 'create' });
      await loadFromDB();
      
    } catch (error: any) {
      console.error("[MANUAL_ENTRY] Error:", error);
      alert(`❌ Error saving:\n\n${error.message}`);
    }
  };

  // Apply manual override (for refunds/returns/manual costs)
  const applyManualOverride = async (matchId: string, match: any) => {
    const data = manualOverrideData[matchId];
    if (!data) return;

    const adjustment = parseFloat(data.adjustment || "0");
    const manualCost = data.manualCost ? parseFloat(data.manualCost) : null;
    const effectiveRevenue = match.shopifyTotalPrice + adjustment;
    const effectiveCost = manualCost !== null ? manualCost : match.supplierCost;

    const confirmMessage = 
      `📝 Apply Manual Override?\n\n` +
      `Order: ${match.shopifyOrderName}\n` +
      `Product: ${match.shopifyProductTitle}\n\n` +
      `Status: ${data.status || "ACTIVE (default)"}\n` +
      `Revenue Adjustment: CHF ${adjustment.toFixed(2)}\n` +
      (manualCost !== null ? `Manual Supplier Cost: CHF ${manualCost.toFixed(2)}\n` : "") +
      `Note: ${data.note || "(none)"}\n\n` +
      `💰 Financial Impact:\n` +
      `Original Revenue: CHF ${toNumber(match.shopifyTotalPrice).toFixed(2)}\n` +
      `Adjusted Revenue: CHF ${effectiveRevenue.toFixed(2)}\n` +
      `Supplier Cost: CHF ${effectiveCost.toFixed(2)}\n` +
      `Adjusted Margin: CHF ${(effectiveRevenue - effectiveCost).toFixed(2)} (${((effectiveRevenue - effectiveCost) / effectiveRevenue * 100).toFixed(1)}%)\n\n` +
      `⚠️ This will ${manualCost !== null ? "mark as MANUAL COST (no Supplier) and " : ""}protect this match from auto-sync updates.`;

    if (!confirm(confirmMessage)) return;

    setManualOverrideLoading(prev => ({ ...prev, [matchId]: true }));

    try {
      const res = await fetch("/api/db/manual-override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId,
          manualCaseStatus: data.status || null,
          manualRevenueAdjustment: adjustment,
          manualNote: data.note || null,
          manualSupplierCost: manualCost,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(`❌ Failed to apply override:\n\n${result.error}\n\n${result.details || ""}`);
        return;
      }

      alert(
        `✅ Manual override applied!\n\n` +
        `Order: ${match.shopifyOrderName}\n` +
        `Effective Revenue: CHF ${result.updatedMatch.shopifyTotalPrice + (result.updatedMatch.manualRevenueAdjustment || 0)}\n` +
        `Supplier Cost: CHF ${result.updatedMatch.supplierCost.toFixed(2)}\n` +
        `Margin: CHF ${result.updatedMatch.marginAmount.toFixed(2)} (${result.updatedMatch.marginPercent.toFixed(1)}%)\n\n` +
        `✅ Dashboard will reflect this change immediately.\n` +
        `🔒 Auto-sync will NOT overwrite this.`
      );

      // Collapse and clear form
      setManualOverrideExpanded(prev => ({ ...prev, [matchId]: false }));
      setManualOverrideData(prev => ({ ...prev, [matchId]: { status: "", adjustment: "", note: "", manualCost: "" } }));

      // Reload matches to show updated data
      await loadFromDB();

    } catch (error: any) {
      console.error("[MANUAL_OVERRIDE] Error:", error);
      alert(`❌ Error applying override:\n\n${error.message}`);
    } finally {
      setManualOverrideLoading(prev => ({ ...prev, [matchId]: false }));
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

      // Use the supplierOrder from the match result (normalized)
      const supplierOrder = match.supplierOrder;
      
      // ✅ Find the enriched order (has Query B supplierCost)
      const rawStockxOrder = (enrichedOrders || orders).find((o) => o.orderNumber === supplierOrder.supplierOrderNumber);

      // Calculate financials
      const shopifyRevenue = parseFloat(shopifyItem.totalPrice) || 0;
      
      // ✅ Priority 1: Use supplierOrder.totalTTC (Query B cost from normalizedSupplier)
      // ✅ Priority 2: Use rawStockxOrder.supplierCost (Query B cost from enriched order)
      // ✅ Priority 3: Fallback to old pricingByOrder system
      // ✅ Priority 4: Fallback to offer amount
      const supplierCostFromMatch = supplierOrder.totalTTC;
      const supplierCostFromEnriched = rawStockxOrder ? (rawStockxOrder as any).supplierCost : null;
      const pricingData = supplierOrder.supplierOrderNumber ? pricingByOrder[supplierOrder.supplierOrderNumber] : null;
      const supplierCostFromPricing = pricingData?.total || null;
      
      const supplierCost = supplierCostFromMatch ?? supplierCostFromEnriched ?? supplierCostFromPricing ?? supplierOrder.offerAmount ?? rawStockxOrder?.amount ?? 0;
      
      console.log(`[AUTO-SET] Supplier cost for ${supplierOrder.supplierOrderNumber}: ${supplierCost} CHF (fromMatch: ${supplierCostFromMatch}, fromEnriched: ${supplierCostFromEnriched}, fromPricing: ${supplierCostFromPricing})`);
      
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
            stockxOrderNumber: supplierOrder.supplierOrderNumber || "",
            estimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
            stockxStatus: supplierOrder.statusKey || "UNKNOWN",
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
            stockxChainId: supplierOrder.chainId || null, // ✅ Pass chainId for Query B
            stockxOrderId: supplierOrder.orderId || null, // ✅ Pass orderId for Query B
            stockxOrderNumber: supplierOrder.supplierOrderNumber || "",
            stockxProductName: supplierOrder.productName || supplierOrder.productTitle || "",
            stockxSizeEU: supplierOrder.sizeEU || null,
            stockxSkuKey: supplierOrder.skuKey || null,
            matchConfidence: match.confidence,
            matchScore: match.score,
            matchType: "auto",
            matchReasons: match.reasons,
            timeDiffHours: match.timeDiffHours,
            stockxStatus: supplierOrder.statusKey || "",
            stockxAwb: supplierOrder.awb || null, // ✅ Pass AWB from enriched data
            stockxTrackingUrl: supplierOrder.trackingUrl || null, // ✅ Pass full tracking URL from enriched data
            stockxEstimatedDelivery: supplierOrder.estimatedDeliveryDate || null,
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
          Supplier Pro GraphQL Playground
        </h1>

        {/* Navigation */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <nav className="flex flex-wrap gap-3">
            <span className="text-gray-900 font-bold py-2 px-3 bg-blue-100 rounded-md">
              🏠 Orders (Current)
            </span>
            <a
              href="/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              📊 Margin Dashboard
            </a>
            <a
              href="/expenses"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
            >
              💰 Expenses
            </a>
            <a
              href="/financial"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-medium"
            >
              📈 Financial Overview
            </a>
          </nav>
        </div>

        {/* Token Input */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Authentication</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="bearerToken" className="block text-sm font-medium text-gray-700 mb-2">
                Bearer Token
              </label>
              <input
                id="bearerToken"
                name="bearerToken"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your Supplier Pro API token"
                autoComplete="off"
              />
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
              disabled={loading || isFetchingAll || isEnriching}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isFetchingAll ? "📥 Fetching All Pages (A)..." : isEnriching ? `🔍 Enriching (B) ${detailsProgress.done}/${detailsProgress.total}...` : "🔍 Fetch All Pages + Details"}
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
              Results ({(enrichedOrders || orders).length} orders{enrichedOrders ? " - Enriched (A+B)" : " - Basic (A)"})
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
                    Status {enrichedOrders && "(B)"}
                  </th>
                  {enrichedOrders && (
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      AWB (B)
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(enrichedOrders || orders).length === 0 ? (
                  <tr>
                    <td
                      colSpan={enrichedOrders ? 10 : 9}
                      className="px-6 py-8 text-center text-gray-500"
                    >
                      No orders loaded. Click "🔍 Fetch All Pages + Details" to start.
                    </td>
                  </tr>
                ) : (
                  (enrichedOrders || orders).map((order, idx) => (
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
                        {enrichedOrders && order.supplierCost != null ? (
                          <span className="font-semibold text-green-700" title="From Query B (exact payment)">
                            {Number(order.supplierCost).toFixed(2)} CHF
                          </span>
                        ) : order.orderNumber ? (
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
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          {enrichedOrders && order.thumbUrlB && (
                            <img 
                              src={order.thumbUrlB} 
                              alt={order.productTitleB || ''} 
                              className="w-8 h-8 object-cover rounded"
                            />
                          )}
                          <span title={enrichedOrders && order.productTitleB ? order.productTitleB : (order.productTitle ?? order.productName ?? "")}>
                            {enrichedOrders && order.productTitleB ? (
                              <span className="font-medium">{order.productTitleB}</span>
                            ) : (
                              order.displayName
                            )}
                            {enrichedOrders && order.brandB && (
                              <span className="text-xs text-gray-500 block">{order.brandB}</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-600 font-mono w-32" title={`StyleID: ${order.styleId ?? "—"} / Model: ${order.model ?? "—"}`}>
                        {order.styleId || order.model || "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                        {enrichedOrders && order.sizeB ? (
                          <span className="font-medium text-gray-900">{order.sizeB}</span>
                        ) : (
                          order.size ?? "—"
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                        {enrichedOrders && order.estimatedDeliveryB ? (
                          <span className="text-blue-600 font-medium" title={`Latest: ${order.latestEstimatedDeliveryB || 'N/A'}`}>
                            {new Date(order.estimatedDeliveryB).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </span>
                        ) : (
                          order.estimatedDeliveryFormatted ?? "—"
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-sm">
                        {enrichedOrders && order.statusKeyB ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {order.statusKeyB}
                          </span>
                        ) : (
                          <span className="text-gray-500">{order.statusKey ?? "—"}</span>
                        )}
                      </td>
                      {enrichedOrders && (
                        <td className="px-3 py-3 text-sm">
                          {order.awb && order.trackingUrl ? (
                            <a 
                              href={order.trackingUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline"
                              title="Click to track package"
                            >
                              📦 {order.awb}
                            </a>
                          ) : order.awb ? (
                            <span className="text-xs font-mono text-gray-700" title="Tracking number (no URL)">
                              📦 {order.awb}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">⏳ Not shipped</span>
                          )}
                        </td>
                      )}
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
            Force a match between a specific Shopify order and Supplier order. 
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
              <label htmlFor="manualSupplierOrder" className="block text-sm font-medium text-gray-700 mb-2">
                Supplier Order Number
              </label>
              <input
                id="manualSupplierOrder"
                name="manualSupplierOrder"
                type="text"
                value={manualSupplierOrder}
                onChange={(e) => setManualSupplierOrder(e.target.value)}
                placeholder="03-XXXXXXXXXX"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <button
                onClick={handleManualMatch}
                disabled={!manualShopifyOrder.trim() || !manualSupplierOrder.trim() || manualMatchLoading}
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
                      {item.orderName} → {manualOverrides[item.lineItemId].supplierOrderNumber}
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
                Persistent storage + background workers for automatic matching
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
              {syncLoading ? "Syncing..." : "🔄 Sync New Orders"}
            </button>

        
            <a
              href="/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium shadow"
            >
              📊 View Dashboard ↗
            </a>
          </div>

          {/* Last Sync Results */}
          {lastSyncResult && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-semibold text-green-800 mb-2">Last Sync Result</h3>
                <p className="text-sm text-gray-700">
                  New Matches: <span className="font-bold">{lastSyncResult.newMatches || 0}</span>
                </p>
                <p className="text-sm text-gray-700">
                  Auto-Set: <span className="font-bold">{lastSyncResult.autoSetCount || 0}</span>
                </p>
              </div>
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
                      <th className="px-3 py-2 text-left">Supplier Order</th>
                      <th className="px-3 py-2 text-left">Confidence</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Synced</th>
                      <th className="px-3 py-2 text-left">Margin</th>
                      <th className="px-3 py-2 text-left">Case Status</th>
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbMatches.map((match) => {
                      const isExpanded = manualOverrideExpanded[match.id];
                      const data = manualOverrideData[match.id] || { status: "", adjustment: "", note: "" };
                      const isLoading = manualOverrideLoading[match.id];
                      
                      return (
                        <React.Fragment key={match.id}>
                          <tr className="border-b hover:bg-purple-50">
                            <td className="px-3 py-2 font-medium">{match.shopifyOrderName}</td>
                            <td className="px-3 py-2 text-xs">{match.shopifyProductTitle}</td>
                            <td className="px-3 py-2 font-mono text-xs">{match.supplierOrderNumber}</td>
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
                            <td className="px-3 py-2 text-xs">{match.supplierStatus}</td>
                            <td className="px-3 py-2">
                              {match.shopifyMetafieldsSynced ? (
                                <span className="text-green-600 font-semibold">✅</span>
                              ) : (
                                <span className="text-gray-400">⏸️</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs font-semibold">
                              {toNumber(match.marginPercent).toFixed(1)}%
                            </td>
                            <td className="px-3 py-2">
                              {match.manualCaseStatus ? (
                                <span className="px-2 py-1 rounded text-xs font-semibold bg-orange-100 text-orange-800">
                                  {match.manualCaseStatus}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">Active</span>
                              )}
                              {match.manualRevenueAdjustment && (
                                <div className="text-xs text-orange-600 font-mono mt-1">
                                  {toNumber(match.manualRevenueAdjustment) >= 0 ? "+" : ""}
                                  {toNumber(match.manualRevenueAdjustment).toFixed(2)} CHF
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 space-x-1">
                              <button
                                onClick={() => openManualEntryModalForEdit(match)}
                                className="text-blue-600 hover:text-blue-800 font-semibold text-xs px-2 py-1 rounded hover:bg-blue-50"
                                title="Edit all fields"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => setManualOverrideExpanded(prev => ({ ...prev, [match.id]: !isExpanded }))}
                                className="text-orange-600 hover:text-orange-800 font-semibold text-xs px-2 py-1 rounded hover:bg-orange-50"
                                title="Mark as refund/return"
                              >
                                {isExpanded ? "❌" : "💰"} Override
                              </button>
                              <button
                                onClick={() => deleteMatch(match.id, match.shopifyOrderName)}
                                className="text-red-600 hover:text-red-800 font-semibold text-xs px-2 py-1 rounded hover:bg-red-50"
                                title="Delete this match from database"
                              >
                                🗑️
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-orange-50 border-b">
                              <td colSpan={9} className="px-6 py-4">
                                <div className="max-w-2xl">
                                  <h4 className="font-semibold text-orange-900 mb-3">
                                    💰 Manual Override: {match.shopifyOrderName}
                                  </h4>
                                  <div className="grid grid-cols-3 gap-4 mb-4">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Case Status
                                      </label>
                                      <select
                                        value={data.status}
                                        onChange={(e) => setManualOverrideData(prev => ({
                                          ...prev,
                                          [match.id]: { ...prev[match.id] || {}, status: e.target.value }
                                        }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                      >
                                        <option value="">ACTIVE (default)</option>
                                        <option value="CLOSED_CREDIT">CLOSED_CREDIT (store credit)</option>
                                        <option value="RETURNED">RETURNED (item returned)</option>
                                        <option value="EXCHANGE_PENDING">EXCHANGE_PENDING</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Revenue Adjustment (CHF)
                                      </label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={data.adjustment}
                                        onChange={(e) => setManualOverrideData(prev => ({
                                          ...prev,
                                          [match.id]: { ...prev[match.id] || {}, adjustment: e.target.value }
                                        }))}
                                        placeholder="e.g., -200 for full refund"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                                      />
                                      <p className="text-xs text-gray-500 mt-1">
                                        Original: CHF {toNumber(match.shopifyTotalPrice).toFixed(2)}
                                        {data.adjustment && ` → CHF ${(match.shopifyTotalPrice + parseFloat(data.adjustment || "0")).toFixed(2)}`}
                                      </p>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Manual Supplier Cost (CHF)
                                      </label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={data.manualCost}
                                        onChange={(e) => setManualOverrideData(prev => ({
                                          ...prev,
                                          [match.id]: { ...prev[match.id] || {}, manualCost: e.target.value }
                                        }))}
                                        placeholder="Leave blank to keep current"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                                      />
                                      <p className="text-xs text-gray-500 mt-1">
                                        Current: CHF {toNumber(match.supplierCost).toFixed(2)}
                                        {data.manualCost && ` → CHF ${parseFloat(data.manualCost).toFixed(2)}`}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mb-4">
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                      Note (optional)
                                    </label>
                                    <input
                                      type="text"
                                      value={data.note}
                                      onChange={(e) => setManualOverrideData(prev => ({
                                        ...prev,
                                        [match.id]: { ...prev[match.id] || {}, note: e.target.value }
                                      }))}
                                      placeholder="e.g., Customer received store credit"
                                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => applyManualOverride(match.id, match)}
                                      disabled={isLoading}
                                      className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 text-sm font-medium"
                                    >
                                      {isLoading ? "Applying..." : "✅ Apply Override"}
                                    </button>
                                    <button
                                      onClick={() => setManualOverrideExpanded(prev => ({ ...prev, [match.id]: false }))}
                                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm font-medium"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                  <div className="mt-3 text-xs text-gray-600 bg-white p-3 rounded border border-orange-200">
                                    <strong>ℹ️ How it works:</strong>
                                    <ul className="mt-1 space-y-1 list-disc list-inside">
                                      <li><strong>Full refund:</strong> Set adjustment to -{toNumber(match.shopifyTotalPrice).toFixed(2)}</li>
                                      <li><strong>Partial refund:</strong> Set adjustment to negative amount (e.g., -50)</li>
                                      <li><strong>Store credit:</strong> Set status to CLOSED_CREDIT</li>
                                      <li><strong>Liquidation (%):</strong> Set manual cost to your buy price (e.g., 80)</li>
                                      <li><strong>Essential Hoodie:</strong> Auto 42 CHF cost (or override manually)</li>
                                      <li><strong>Dashboard:</strong> Will show adjusted margin immediately</li>
                                      <li><strong>Auto-sync:</strong> Will NOT overwrite manual fields</li>
                                      <li><strong>Fulfillment:</strong> Manual cost items won't auto-match Supplier</li>
                                    </ul>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">ℹ️ How it works (FULLY AUTOMATIC)</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• <strong>Sync New Orders</strong>: 🤖 Fetches recent Shopify orders, auto-matches with Supplier, <span className="font-bold text-green-700">automatically sets metafields + saves to DB for HIGH confidence matches</span>. No manual approval needed!</li>
              <li>• <strong>Check Status Updates</strong>: 🔄 Monitors all synced orders for Supplier status changes and updates Shopify metafields automatically.</li>
              <li>• <strong>Database</strong>: 💾 All HIGH confidence matches stored locally. MEDIUM/LOW skipped (require manual review).</li>
              <li>• <strong>Cron Jobs</strong>: ⏰ Call <code className="bg-white px-1 rounded">/api/sync/new-orders</code> every 5-10 min for full automation.</li>
            </ul>
          </div>
        </div>

        {/* Shopify Matching Section (Manual Mode) */}
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">
                Order Matching (Shopify ↔ Supplier)
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
              Click "Load Shopify Orders" to fetch recent unfulfilled orders and match with Supplier
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
                const isLiquidation = /%/.test(shopify.title);
                
                // ✅ SIMPLE: If SKU is in EXCLUDED_SKUS → Essential Hoodie (auto 42 CHF)
                // Otherwise → ignore (let normal StockX matching happen)
                const isEssentialHoodie = shopify.sku && EXCLUDED_SKUS.includes(shopify.sku);

                return (
                  <div
                    key={`${shopify.lineItemId}-${idx}`}
                    className={`border rounded-lg p-4 ${
                      isLiquidation
                        ? "border-purple-300 bg-purple-50"
                        : isEssentialHoodie
                        ? "border-indigo-300 bg-indigo-50"
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

                      {/* Supplier Match Side */}
                      <div>
                        {manualOverrides[shopify.lineItemId] ? (
                          // Manual override exists - show it with priority
                          (() => {
                            const manualSupplierOrderNum = manualOverrides[shopify.lineItemId].supplierOrderNumber;
                            const manualSupplierOrder = orders.find(o => o.orderNumber === manualSupplierOrderNum);
                            return (
                              <>
                                <div className="mb-3 px-2 py-1 bg-orange-100 border border-orange-400 rounded">
                                  <p className="text-xs font-bold text-orange-800 text-center">
                                    🔧 MANUAL OVERRIDE
                                  </p>
                                </div>
                                <h3 className="font-semibold text-sm text-gray-700 mb-2">
                                  🎯 Manually Matched Supplier Order
                                </h3>
                                {manualSupplierOrder ? (
                                  <div className="text-xs space-y-1">
                                    <p>
                                      <span className="font-medium">Order:</span>{" "}
                                      <span className="font-mono text-orange-700 font-semibold">
                                        {manualSupplierOrderNum}
                                      </span>
                                    </p>
                                    <p>
                                      <span className="font-medium">Purchase:</span>{" "}
                                      {manualSupplierOrder.purchaseDate 
                                        ? new Date(manualSupplierOrder.purchaseDate).toLocaleString("fr-CH")
                                        : "—"}
                                    </p>
                                    <p>
                                      <span className="font-medium">Product:</span>{" "}
                                      {manualSupplierOrder.displayName}
                                    </p>
                                    <p>
                                      <span className="font-medium">SKU:</span>{" "}
                                      {manualSupplierOrder.skuKey}
                                    </p>
                                    <p>
                                      <span className="font-medium">Size:</span>{" "}
                                      {manualSupplierOrder.size || "—"}
                                    </p>
                                    <p>
                                      <span className="font-medium">Offer:</span> CHF{" "}
                                      {manualSupplierOrder.amount?.toFixed(2) || "—"}
                                      {manualSupplierOrder.orderNumber && pricingByOrder[manualSupplierOrder.orderNumber]?.total && (
                                        <span className="text-green-700 font-semibold ml-2">
                                          (Total: CHF {pricingByOrder[manualSupplierOrder.orderNumber]!.total.toFixed(2)})
                                        </span>
                                      )}
                                    </p>
                                    <p>
                                      <span className="font-medium">Status:</span>{" "}
                                      <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100">
                                        {manualSupplierOrder.statusKey || "—"}
                                      </span>
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-red-600 text-xs">
                                    ⚠️ Order {manualSupplierOrderNum} not found in loaded Supplier orders
                                  </p>
                                )}
                                
                                {/* Financial Summary + Manual Cost Override (for manual override) */}
                                {manualSupplierOrder && (
                                  <>
                                    <div className="mt-3 pt-2 border-t border-orange-200">
                                      {(() => {
                                        const shopifyRevenue = parseFloat(shopify.totalPrice) || 0;
                                        
                                        // ✅ Find the enriched order to get Query B supplierCost
                                        const enrichedOrder = enrichedOrders?.find(o => o.orderNumber === manualSupplierOrderNum);
                                        const supplierCostFromB = enrichedOrder ? (enrichedOrder as any).supplierCost : null;
                                        
                                        // ✅ Fallback to old pricing system
                                        const pricingData = pricingByOrder[manualSupplierOrderNum];
                                        const supplierCostFromPricing = pricingData?.total || null;
                                        const autoTTC = supplierCostFromB ?? supplierCostFromPricing;
                                        
                                        const manualCost = manualCostOverrides[shopify.lineItemId];
                                        const displayCost = manualCost ? parseFloat(manualCost) : (autoTTC || manualSupplierOrder.amount || 0);
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
                                                  value={manualCost || (autoTTC ? autoTTC.toFixed(2) : (manualSupplierOrder.amount || 0).toFixed(2))}
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
                                          Supplier Order: {metafieldsSet[shopify.lineItemId].supplierOrderNumber}
                                        </p>
                                        <button
                                          onClick={() => handleSetMetafields(shopify, manualSupplierOrderNum)}
                                          disabled={metafieldsLoading[shopify.lineItemId]}
                                          className="mt-2 text-xs text-blue-600 hover:underline disabled:text-gray-400"
                                        >
                                          {metafieldsLoading[shopify.lineItemId] ? "Updating..." : "Update Metafields"}
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => handleSetMetafields(shopify, manualSupplierOrderNum)}
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
                            <p className="text-sm font-semibold">🛍️ Liquidation Product</p>
                            <p className="text-xs mt-2">
                              This is an in-stock liquidation item.
                              <br />
                              Click below to add to DB with your buy price.
                            </p>
                            <button
                              onClick={() => createManualCostEntry(shopify)}
                              className="mt-3 w-full px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded hover:bg-purple-700"
                            >
                              💰 Add to DB with Manual Cost
                            </button>
                            <p className="text-xs mt-2 text-gray-600">
                              Or enter Supplier order # manually if you want to link:
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
                              placeholder="Enter Supplier order # (optional)"
                              className="mt-2 w-full px-2 py-1 border rounded text-xs font-mono"
                            />
                          </div>
                        ) : isEssentialHoodie ? (
                          <div className="text-indigo-700 text-center py-4">
                            <p className="text-sm font-semibold">👕 Essential Hoodie Detected</p>
                            <p className="text-xs mt-2">
                              SKU: {shopify.sku}
                              <br />
                              Auto-cost: 42 CHF (no fulfillment needed)
                            </p>
                            <button
                              onClick={() => createManualCostEntry(shopify)}
                              className="mt-3 w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700"
                            >
                              ✅ Add to DB (Auto 42 CHF)
                            </button>
                            <p className="text-xs mt-3 text-gray-600">
                              This will add to dashboard with 42 CHF supplier cost.
                              <br />
                              No Supplier matching or fulfillment.
                            </p>
                          </div>
                        ) : match ? (
                          <>
                            <h3 className="font-semibold text-sm text-gray-700 mb-2">
                              🎯 Suggested Supplier Match
                            </h3>
                            <div className="text-xs space-y-1">
                              <p>
                                <span className="font-medium">Order:</span>{" "}
                                <input
                                  type="text"
                                  value={
                                    confirmedMatches[shopify.lineItemId] ||
                                    match.supplierOrder.supplierOrderNumber
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
                                  match.supplierOrder.purchaseDate
                                ).toLocaleString("fr-CH")}
                              </p>
                              <p>
                                <span className="font-medium">Product:</span>{" "}
                                {match.supplierOrder.productTitle}
                              </p>
                              <p>
                                <span className="font-medium">SKU:</span>{" "}
                                {match.supplierOrder.skuKey}
                              </p>
                              <p>
                                <span className="font-medium">Size:</span>{" "}
                                {match.supplierOrder.sizeEU || "—"}
                              </p>
                              <p>
                                <span className="font-medium">Offer:</span> CHF{" "}
                                {match.supplierOrder.offerAmount?.toFixed(2) || "—"}
                                {match.supplierOrder.totalTTC && (
                                  <span className="text-green-700 font-semibold ml-2">
                                    (Total: CHF {match.supplierOrder.totalTTC.toFixed(2)})
                                  </span>
                                )}
                              </p>
                              <p>
                                <span className="font-medium">Status:</span>{" "}
                                {match.supplierOrder.statusKey || "—"}
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
                                const supplierOrderNum = confirmedMatches[shopify.lineItemId] || match.supplierOrder.supplierOrderNumber;
                                
                                // ✅ Priority 1: Use match.supplierOrder.totalTTC (Query B supplier cost)
                                // ✅ Priority 2: Fallback to old pricingByOrder system
                                const supplierCostFromMatch = match.supplierOrder.totalTTC;
                                const pricingData = pricingByOrder[supplierOrderNum];
                                const supplierCostFromPricing = pricingData?.total || null;
                                const autoTTC = supplierCostFromMatch ?? supplierCostFromPricing;
                                
                                const manualCost = manualCostOverrides[shopify.lineItemId];
                                const displayCost = manualCost ? parseFloat(manualCost) : (autoTTC || match.supplierOrder.offerAmount || 0);
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
                                          value={manualCost || (autoTTC ? autoTTC.toFixed(2) : (match.supplierOrder.offerAmount || 0).toFixed(2))}
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
                                    Supplier Order: {metafieldsSet[shopify.lineItemId].supplierOrderNumber}
                                  </p>
                                  <button
                                    onClick={() =>
                                      handleSetMetafields(
                                        shopify,
                                        confirmedMatches[shopify.lineItemId] ||
                                          match.supplierOrder.supplierOrderNumber
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
                                        match.supplierOrder.supplierOrderNumber
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
                            <button
                              onClick={() => openManualEntryModal(shopify)}
                              className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
                            >
                              📝 Create Manual Entry (Full)
                            </button>
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

      {/* ✅ NEW: Manual Entry Modal with ALL DB fields */}
      {manualEntryModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">
                {manualEntryModal.mode === 'edit' ? '✏️ Edit Entry - All Fields' : '📝 Create Manual Entry - All Fields'}
              </h2>
              <button
                onClick={() => setManualEntryModal({ isOpen: false, shopifyItem: null, mode: 'create' })}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Shopify Info (Read-only) */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-semibold text-blue-900 mb-2">📦 Shopify Order (Read-only)</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="font-medium">Order:</span> {manualEntryData.shopifyOrderName || manualEntryModal.shopifyItem?.orderName}</div>
                  <div><span className="font-medium">Revenue:</span> CHF {manualEntryData.shopifyTotalPrice?.toFixed(2)}</div>
                  <div className="col-span-2"><span className="font-medium">Product:</span> {manualEntryData.shopifyProductTitle || manualEntryModal.shopifyItem?.title}</div>
                  <div><span className="font-medium">SKU:</span> {manualEntryData.shopifySku || "N/A"}</div>
                  <div><span className="font-medium">Size:</span> {manualEntryData.shopifySizeEU || "N/A"}</div>
                </div>
                {manualEntryModal.mode === 'edit' && (
                  <div className="mt-2 text-xs text-blue-700">
                    💡 Tip: Only modified fields will be updated in the database
                  </div>
                )}
              </div>

              {/* Supplier Order Info */}
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900">🏪 Supplier Order Info</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Supplier Order Number
                    </label>
                    <input
                      type="text"
                      value={manualEntryData.stockxOrderNumber}
                      onChange={(e) => setManualEntryData({...manualEntryData, stockxOrderNumber: e.target.value})}
                      placeholder="e.g., 03-XXXXXXXXXX"
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Chain ID
                    </label>
                    <input
                      type="text"
                      value={manualEntryData.stockxChainId}
                      onChange={(e) => setManualEntryData({...manualEntryData, stockxChainId: e.target.value})}
                      placeholder="Optional"
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Order ID
                    </label>
                    <input
                      type="text"
                      value={manualEntryData.stockxOrderId}
                      onChange={(e) => setManualEntryData({...manualEntryData, stockxOrderId: e.target.value})}
                      placeholder="Optional"
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Status
                    </label>
                    <select
                      value={manualEntryData.stockxStatus}
                      onChange={(e) => setManualEntryData({...manualEntryData, stockxStatus: e.target.value})}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="MANUAL">MANUAL</option>
                      <option value="ORDER_CREATED">ORDER_CREATED</option>
                      <option value="SELLER_SHIPPED">SELLER_SHIPPED</option>
                      <option value="DELIVERED">DELIVERED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={manualEntryData.stockxProductName}
                    onChange={(e) => setManualEntryData({...manualEntryData, stockxProductName: e.target.value})}
                    className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      SKU Key
                    </label>
                    <input
                      type="text"
                      value={manualEntryData.stockxSkuKey}
                      onChange={(e) => setManualEntryData({...manualEntryData, stockxSkuKey: e.target.value})}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Size (EU)
                    </label>
                    <input
                      type="text"
                      value={manualEntryData.stockxSizeEU}
                      onChange={(e) => setManualEntryData({...manualEntryData, stockxSizeEU: e.target.value})}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Dates & Tracking */}
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900">📅 Dates & Tracking</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Purchase Date
                    </label>
                    <input
                      type="datetime-local"
                      value={manualEntryData.stockxPurchaseDate}
                      onChange={(e) => setManualEntryData({...manualEntryData, stockxPurchaseDate: e.target.value})}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Estimated Delivery
                    </label>
                    <input
                      type="datetime-local"
                      value={manualEntryData.stockxEstimatedDelivery}
                      onChange={(e) => setManualEntryData({...manualEntryData, stockxEstimatedDelivery: e.target.value})}
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    AWB / Tracking Number
                  </label>
                  <input
                    type="text"
                    value={manualEntryData.stockxAwb}
                    onChange={(e) => setManualEntryData({...manualEntryData, stockxAwb: e.target.value})}
                    placeholder="e.g., 123456789"
                    className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tracking URL
                  </label>
                  <input
                    type="url"
                    value={manualEntryData.stockxTrackingUrl}
                    onChange={(e) => setManualEntryData({...manualEntryData, stockxTrackingUrl: e.target.value})}
                    placeholder="https://tracking.example.com/..."
                    className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Financial Data */}
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900">💰 Financial Data</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Supplier Cost (CHF) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={manualEntryData.supplierCost}
                      onChange={(e) => setManualEntryData({...manualEntryData, supplierCost: e.target.value})}
                      placeholder="0.00"
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Manual Cost Override
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={manualEntryData.manualCostOverride}
                      onChange={(e) => setManualEntryData({...manualEntryData, manualCostOverride: e.target.value})}
                      placeholder="Optional"
                      className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                
                {/* Calculated Margin */}
                {manualEntryData.supplierCost && (
                  <div className="bg-green-50 p-3 rounded text-sm">
                    <span className="font-medium">Calculated Margin:</span> CHF {(manualEntryData.shopifyTotalPrice - parseFloat(manualEntryData.supplierCost)).toFixed(2)} 
                    ({(((manualEntryData.shopifyTotalPrice - parseFloat(manualEntryData.supplierCost)) / manualEntryData.shopifyTotalPrice) * 100).toFixed(1)}%)
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={manualEntryData.manualNote}
                  onChange={(e) => setManualEntryData({...manualEntryData, manualNote: e.target.value})}
                  rows={3}
                  placeholder="Any additional notes..."
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <button
                  onClick={saveManualEntry}
                  className="flex-1 px-6 py-3 bg-green-600 text-white font-medium rounded hover:bg-green-700"
                >
                  {manualEntryModal.mode === 'edit' ? '💾 Update Entry (Partial)' : '✅ Save Manual Entry'}
                </button>
                <button
                  onClick={() => setManualEntryModal({ isOpen: false, shopifyItem: null, mode: 'create' })}
                  className="px-6 py-3 bg-gray-300 text-gray-700 font-medium rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

