"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  ComposedChart,
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

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);

  const fetchMetrics = async (daysParam: number) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/metrics/margin?days=${daysParam}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch metrics");
      }

      const data: MetricsResponse = await response.json();
      setMetrics(data);
    } catch (err) {
      console.error("Error fetching metrics:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const syncMetrics = async () => {
    try {
      setSyncing(true);

      const response = await fetch("/api/metrics/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync metrics");
      }

      alert(`✅ Metrics synced!\n\n${data.message}\n\nDashboard will refresh automatically.`);
      await fetchMetrics(days); // Refresh the dashboard
    } catch (err) {
      console.error("Error syncing metrics:", err);
      alert(`❌ Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncing(false);
    }
  };

  const recoverFromShopify = async () => {
    try {
      setSyncing(true);

      const response = await fetch("/api/metrics/recover-from-shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to recover from Shopify");
      }

      alert(`✅ Recovered from Shopify!\n\n${data.message}\n\nDashboard will refresh automatically.`);
      await fetchMetrics(days); // Refresh the dashboard
    } catch (err) {
      console.error("Error recovering from Shopify:", err);
      alert(`❌ Recovery failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchMetrics(days);
  }, [days]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("de-CH", {
      style: "currency",
      currency: "CHF",
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading margin metrics...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h2 className="text-xl font-semibold text-red-800 mb-2">
              Unable to Load Dashboard
            </h2>
            <p className="text-red-600">{error}</p>
            <button
              onClick={() => fetchMetrics(days)}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Margin Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Track your profit margins over time
          </p>
        </div>

        {/* Controls */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700">
              Period:
            </label>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
            {metrics && (
              <span className="text-sm text-gray-500">
                {metrics.period.startDate} to {metrics.period.endDate}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={syncMetrics}
              disabled={syncing}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap font-medium"
              title="Sync OrderMatch data to dashboard metrics"
            >
              {syncing ? "🔄 Syncing..." : "🔄 Sync to Dashboard"}
            </button>
            <button
              onClick={recoverFromShopify}
              disabled={syncing}
              className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap font-medium"
              title="Recover data from Shopify metafields if local DB is lost"
            >
              {syncing ? "🔄 Recovering..." : "🛟 Recover from Shopify"}
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        {metrics && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">💰</span>
                  </div>
                </div>
                <div className="ml-4">
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Total Sales
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {formatCurrency(metrics.totals.totalSales)}
                  </dd>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">📈</span>
                  </div>
                </div>
                <div className="ml-4">
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Total Margin
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {formatCurrency(metrics.totals.totalMargin)}
                  </dd>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center ${
                    metrics.totals.overallMarginPct >= 20
                      ? "bg-green-500"
                      : metrics.totals.overallMarginPct >= 10
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}>
                    <span className="text-white text-sm font-bold">%</span>
                  </div>
                </div>
                <div className="ml-4">
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Overall Margin
                  </dt>
                  <dd className="text-2xl font-semibold text-gray-900">
                    {formatPercent(metrics.totals.overallMarginPct)}
                  </dd>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chart */}
        {metrics && metrics.data.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">
              Margin Trends
            </h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={metrics.data}
                  margin={{
                    top: 20,
                    right: 30,
                    left: 20,
                    bottom: 5,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    fontSize={12}
                  />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tickFormatter={(value) => `CHF ${value}`}
                    fontSize={12}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(value) => `${value}%`}
                    fontSize={12}
                  />
                  <Tooltip
                    formatter={(value: any, name: string) => {
                      if (name === "Margin CHF") {
                        return [formatCurrency(value), name];
                      }
                      if (name === "Margin %") {
                        return [formatPercent(value), name];
                      }
                      if (name === "Sales") {
                        return [formatCurrency(value), name];
                      }
                      return [value, name];
                    }}
                    labelFormatter={(label) => `Date: ${formatDate(label)}`}
                  />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="marginChf"
                    fill="#3B82F6"
                    name="Margin CHF"
                    radius={[2, 2, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="marginPct"
                    stroke="#10B981"
                    strokeWidth={3}
                    name="Margin %"
                    dot={{ fill: "#10B981", strokeWidth: 2, r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* No Data Message */}
        {metrics && metrics.data.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-gray-400 text-6xl mb-4">📊</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No Margin Data Available
            </h3>
            <p className="text-gray-600">
              No orders with margin data found in the last {days} days.
              Margin data is automatically collected when orders are matched and synced.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
