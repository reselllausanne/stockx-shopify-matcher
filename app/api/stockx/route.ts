import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, operationName, query, variables } = body;

    // Validation: token is required
    if (!token || typeof token !== "string" || token.trim() === "") {
      console.error("[API] Missing or invalid token");
      return NextResponse.json(
        { error: "Bearer token is required" },
        { status: 400 }
      );
    }

    console.log("[API] Calling StockX with operation:", operationName);

    // Prepare the request to StockX Pro API
    const stockxResponse = await fetch("https://pro.stockx.com/api/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
        "origin": "https://pro.stockx.com",
        "referer": "https://pro.stockx.com/purchasing/orders",
      },
      body: JSON.stringify({
        operationName,
        query,
        variables,
      }),
    });

    console.log("[API] StockX response status:", stockxResponse.status);

    // Get the response data
    const responseText = await stockxResponse.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (parseError: any) {
      console.error("[API] Failed to parse StockX response:", parseError.message);
      console.error("[API] Response text:", responseText.substring(0, 500));
      return NextResponse.json(
        { error: "Invalid JSON response from StockX", details: parseError.message },
        { status: 500 }
      );
    }

    // Return the response with the same status code
    return NextResponse.json(data, { status: stockxResponse.status });
  } catch (error: any) {
    // Handle any errors
    console.error("[API] Error:", error.message, error.stack);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

