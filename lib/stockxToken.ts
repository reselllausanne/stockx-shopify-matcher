import { prisma } from "@/app/lib/prisma";

/**
 * Get the current valid Supplier token from database.
 * If no token or expired, returns null.
 */
export async function getSupplierToken(): Promise<string | null> {
  try {
    const result = await prisma.$queryRaw<Array<{ token: string; expires_at: Date }>>`
      SELECT token, expires_at 
      FROM "StockXToken" 
      ORDER BY created_at DESC 
      LIMIT 1;
    `;

    if (!result || result.length === 0) {
      console.warn("[TOKEN] No token found in database");
      return null;
    }

    const tokenData = result[0];
    const isExpired = new Date() > tokenData.expires_at;

    if (isExpired) {
      console.warn("[TOKEN] Token expired, cron should refresh soon");
      return null;
    }

    return tokenData.token;
  } catch (error) {
    console.error("[TOKEN] Error fetching token:", error);
    return null;
  }
}

/**
 * Check if token needs refresh (expires in < 2 hours).
 */
export async function tokenNeedsRefresh(): Promise<boolean> {
  try {
    const result = await prisma.$queryRaw<Array<{ expires_at: Date }>>`
      SELECT expires_at 
      FROM "StockXToken" 
      ORDER BY created_at DESC 
      LIMIT 1;
    `;

    if (!result || result.length === 0) {
      return true; // No token = needs refresh
    }

    const expiresAt = new Date(result[0].expires_at);
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);

    return expiresAt < twoHoursFromNow;
  } catch (error) {
    return true; // Error = assume needs refresh
  }
}

