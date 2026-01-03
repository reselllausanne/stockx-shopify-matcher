"use client";

import { useState, useEffect } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface DailyMetric {
  date: string;
  sales: number;
  marginChf: number;
  marginPct: number;
  medianMarginPct: number;
  orderCount: number;
}

interface MetricsResponse {
  data: DailyMetric[];
  totals: {
    totalSales: number;
    totalMargin: number;
    overallMarginPct: number;
  };
  period: {
    startDate: string;
    endDate: string;
    days: number;
  };
}

interface ComparisonItem {
  orderId: string;
  orderName: string;
  createdAt: string;
  shopify: {
    stockxOrderNumber: string | null;
    status: string | null;
    supplierCost: number | null;
    marginAmount: number | null;
    marginPercent: number | null;
  };
  db: {
    stockxOrderNumber: string;
    status: string;
    supplierCost: number;
    marginAmount: number;
    marginPercent: number;
  } | null;
  match: string;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [comparison, setComparison] = useState<ComparisonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [activeTab, setActiveTab] = useState<"metrics" | "comparison">("metrics");

  const fetchMetrics = async (daysParam: number) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/metrics/margin?days=${daysParam}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.details || data.error || "Failed to fetch metrics");
        return;
      }

      setMetrics(data);
    } catch (err: any) {
      console.error("[DASHBOARD] Error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchComparison = async () => {
    try {
      const response = await fetch(`/api/metrics/shopify-comparison?days=${days}`);
      const data = await response.json();

      if (response.ok) {
        setComparison(data.comparison || []);
      }
    } catch (err) {
      console.error("[COMPARISON] Error:", err);
    }
  };

  useEffect(() => {
    fetchMetrics(days);
    if (activeTab === "comparison") {
      fetchComparison();
    }
  }, [days, activeTab]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("de-CH", {
      style: "currency",
      currency: "CHF",
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  if (loading && !metrics) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">📊 Margin Analytics</h1>
          <p className="text-gray-600">Order matching performance & profitability</p>
          <a href="/" className="text-blue-600 hover:underline mt-2 inline-block">
            ← Back to Matching
          </a>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab("metrics")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "metrics"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              📈 Metrics
            </button>
            <button
              onClick={() => setActiveTab("comparison")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "comparison"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              🔄 Shopify Comparison
            </button>
          </nav>
        </div>

        {/* Period Selector */}
        <div className="mb-6 flex gap-2">
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                days === d
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-300"
              }`}
            >
              {d} days
            </button>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 font-medium">Error: {error}</p>
            <p className="text-red-600 text-sm mt-1">Check browser console (F12) for details</p>
          </div>
        )}

        {/* Metrics Tab */}
        {activeTab === "metrics" && metrics && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="text-sm text-gray-600 mb-1">Total Sales</div>
                <div className="text-3xl font-bold text-gray-900">
                  {formatCurrency(metrics.totals.totalSales)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {metrics.period.days} days
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="text-sm text-gray-600 mb-1">Total Margin</div>
                <div className="text-3xl font-bold text-green-600">
                  {formatCurrency(metrics.totals.totalMargin)}
                </div>
                <div className="text-xs text-gray-500 mt-1">Net profit</div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="text-sm text-gray-600 mb-1">Overall Margin %</div>
                <div className="text-3xl font-bold text-blue-600">
                  {formatPercent(metrics.totals.overallMarginPct)}
                </div>
                <div className="text-xs text-gray-500 mt-1">Average profitability</div>
              </div>
            </div>

            {/* Chart */}
            {metrics.data.length > 0 ? (
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-xl font-semibold mb-4">Daily Performance</h2>
                <ResponsiveContainer width="100%" height={400}>
                  <ComposedChart data={metrics.data}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip
                      formatter={(value: any, name: string) => {
                        if (name === "marginChf") return [formatCurrency(value), "Margin CHF"];
                        if (name === "marginPct") return [formatPercent(value), "Margin %"];
                        if (name === "sales") return [formatCurrency(value), "Sales"];
                        return [value, name];
                      }}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="marginChf" fill="#3b82f6" name="Margin CHF" />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="marginPct"
                      stroke="#10b981"
                      strokeWidth={2}
                      name="Margin %"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-200 text-center">
                <p className="text-gray-600 mb-4">No data available for selected period</p>
                <p className="text-sm text-gray-500">
                  Go to the <a href="/" className="text-blue-600 hover:underline">main page</a> to match orders
                </p>
              </div>
            )}
          </>
        )}

        {/* Comparison Tab */}
        {activeTab === "comparison" && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold">Shopify vs Database Comparison</h2>
              <p className="text-sm text-gray-600 mt-1">
                Compare metafields on Shopify with local database records
              </p>
            </div>

            {comparison.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-600">No synced orders found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Order
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        StockX #
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Shopify Sale
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        DB Sale
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Shopify Cost
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        DB Cost
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Shopify Margin
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        DB Margin
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {comparison.map((item: any) => {
                      const saleMatch = item.shopifySalePrice === item.db?.salePrice;
                      const costMatch =
                        item.shopify.supplierCost === item.db?.supplierCost;
                      const marginMatch =
                        item.shopify.marginAmount === item.db?.marginAmount;

                      return (
                        <tr key={item.orderId}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {item.orderName}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {item.shopify.stockxOrderNumber || item.db?.stockxOrderNumber || "—"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.shopifySalePrice
                              ? formatCurrency(item.shopifySalePrice)
                              : "—"}
                          </td>
                          <td
                            className={`px-6 py-4 whitespace-nowrap text-sm ${
                              saleMatch ? "text-green-600" : "text-orange-600"
                            }`}
                          >
                            {item.db?.salePrice
                              ? formatCurrency(item.db.salePrice)
                              : "—"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.shopify.supplierCost
                              ? formatCurrency(item.shopify.supplierCost)
                              : "—"}
                          </td>
                          <td
                            className={`px-6 py-4 whitespace-nowrap text-sm ${
                              costMatch ? "text-green-600" : "text-orange-600"
                            }`}
                          >
                            {item.db?.supplierCost
                              ? formatCurrency(item.db.supplierCost)
                              : "—"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.shopify.marginAmount
                              ? formatCurrency(item.shopify.marginAmount)
                              : "—"}
                          </td>
                          <td
                            className={`px-6 py-4 whitespace-nowrap text-sm ${
                              marginMatch ? "text-green-600" : "text-orange-600"
                            }`}
                          >
                            {item.db?.marginAmount
                              ? formatCurrency(item.db.marginAmount)
                              : "—"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {item.match === "synced" ? (
                              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                                ✓ Synced
                              </span>
                            ) : item.match === "manual_cost" ? (
                              <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
                                💰 Manual Cost
                              </span>
                            ) : item.match === "db_only" ? (
                              <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                                DB Only
                              </span>
                            ) : (
                              <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                                Metafields only
                              </span>
                            )}
                            {item.db?.matchType === "MANUAL_COST" && item.db?.manualCostOverride && (
                              <div className="text-xs text-purple-600 mt-1">
                                Override: {formatCurrency(item.db.manualCostOverride)}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
