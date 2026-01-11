/**
 * lib/shopifyMetafields.ts
 * 
 * Server-only helpers for setting Shopify ORDER metafields.
 * Reuses existing shopifyGraphQL client.
 */

import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const SET_METAFIELDS_MUTATION = /* GraphQL */ `
mutation SetOrderMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key type value }
    userErrors { field message }
  }
}
`;

/**
 * Set tracking_number metafield on Shopify ORDER
 * @param shopifyOrderIdGid - Shopify Order ID (gid format)
 * @param awb - Air Waybill / tracking number
 * @returns Success boolean
 */
export async function setOrderTrackingMetafield(
  shopifyOrderIdGid: string,
  awb: string
): Promise<boolean> {
  try {
    console.log(`[SHOPIFY-META] Setting tracking_number metafield for order ${shopifyOrderIdGid}: ${awb}`);

    const metafields = [
      {
        ownerId: shopifyOrderIdGid,
        namespace: "supplier",
        key: "tracking_number",
        type: "single_line_text_field",
        value: awb,
      },
    ];

    const { data, errors } = await shopifyGraphQL<{
      metafieldsSet: {
        metafields: any[];
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(SET_METAFIELDS_MUTATION, { metafields });

    if (errors?.length) {
      console.error("[SHOPIFY-META] GraphQL errors:", errors);
      return false;
    }

    const userErrors = data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length) {
      console.error("[SHOPIFY-META] User errors:", userErrors);
      return false;
    }

    console.log(`[SHOPIFY-META] ✅ Tracking metafield set successfully`);
    return true;

  } catch (error: any) {
    console.error("[SHOPIFY-META] Error setting tracking metafield:", error);
    return false;
  }
}

/**
 * Set ETA (estimated_delivery) metafield on Shopify ORDER
 * @param shopifyOrderIdGid - Shopify Order ID (gid format)
 * @param etaDate - Estimated delivery date (ISO string or Date)
 * @returns Success boolean
 */
export async function setOrderETAMetafield(
  shopifyOrderIdGid: string,
  etaDate: string | Date
): Promise<boolean> {
  try {
    const dateStr = typeof etaDate === 'string' ? etaDate : etaDate.toISOString().split('T')[0];
    console.log(`[SHOPIFY-META] Setting estimated_delivery metafield for order ${shopifyOrderIdGid}: ${dateStr}`);

    const metafields = [
      {
        ownerId: shopifyOrderIdGid,
        namespace: "supplier",
        key: "estimated_delivery",
        type: "date",
        value: dateStr,
      },
    ];

    const { data, errors } = await shopifyGraphQL<{
      metafieldsSet: {
        metafields: any[];
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(SET_METAFIELDS_MUTATION, { metafields });

    if (errors?.length) {
      console.error("[SHOPIFY-META] GraphQL errors:", errors);
      return false;
    }

    const userErrors = data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length) {
      console.error("[SHOPIFY-META] User errors:", userErrors);
      return false;
    }

    console.log(`[SHOPIFY-META] ✅ ETA metafield set successfully`);
    return true;

  } catch (error: any) {
    console.error("[SHOPIFY-META] Error setting ETA metafield:", error);
    return false;
  }
}

