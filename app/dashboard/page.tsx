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
import { formatMoneyCHF, formatPercent, toNumberSafe } from "@/app/utils/numbers";

type DateMode = "locked" | "booked";

interface DailyRow {
  date: string;
  bookedSalesChf: number;
  lockedSalesChf: number;
  lockedMarginChf: number;
  lockedMarginPct: number;
  adsSpendChf: number;
  netAfterAdsChf: number;
  coveragePct: number;
  uncoveredSalesChf: number;
  uncoveredCount: number;
  bookedOrderCount: number;
  lockedOrderCount: number;
}

interface DailyMetrics {
  rows: DailyRow[];
  totals: {
    bookedSalesChf: number;
    lockedSalesChf: number;
    lockedMarginChf: number;
    lockedMarginPct: number;
    adsSpendChf: number;
    netAfterAdsChf: number;
    coveragePct: number;
    uncoveredSalesChf: number;
    uncoveredCount: number;
  };
  metadata: {
    dateMode: DateMode;
    startDate: string;
    endDate: string;
    range: number;
  };
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(30);
  const [dateMode, setDateMode] = useState<DateMode>("locked"); // DEFAULT: locked
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    fetchMetrics();
  }, [range, dateMode]);

  const syncShopifyOrders = async () => {
    try {
      setSyncing(true);
      // Sync orders from start of current year (2026-01-01)
      const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
      const response = await fetch("/api/sync/shopify-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: startOfYear }),
      });
      const data = await response.json();
      
      if (response.ok) {
        alert(`✅ Synced ${data.synced} Shopify orders from ${startOfYear}!`);
        fetchMetrics(); // Refresh metrics after sync
      } else {
        alert(`❌ Sync failed: ${data.error}`);
      }
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const clearAllOrders = async () => {
    // Double confirmation for safety
    const confirmed = window.confirm(
      "⚠️ WARNING: This will delete ALL Shopify orders and order matches!\n\n" +
      "This action cannot be undone.\n\n" +
      "This will clear:\n" +
      "  • All synced Shopify orders\n" +
      "  • All supplier order matches\n\n" +
      "It will KEEP:\n" +
      "  • Expenses\n" +
      "  • Ads Spend\n" +
      "  • Variable Costs\n\n" +
      "Are you sure you want to continue?"
    );

    if (!confirmed) {
      return;
    }

    // Second confirmation
    const doubleConfirm = window.confirm(
      "⚠️ LAST CHANCE!\n\n" +
      "You are about to delete all orders and matches.\n" +
      "This is irreversible.\n\n" +
      "Click OK to proceed, or Cancel to abort."
    );

    if (!doubleConfirm) {
      return;
    }

    try {
      setClearing(true);
      const response = await fetch("/api/db/clear-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      
      if (response.ok) {
        alert(
          `✅ Database cleared!\n\n` +
          `Deleted:\n` +
          `  • ${data.deleted.shopifyOrders} Shopify orders\n` +
          `  • ${data.deleted.orderMatches} order matches\n\n` +
          `Next: Click "Sync Orders (From Jan 1)" to start fresh!`
        );
        fetchMetrics(); // Refresh metrics (will show empty)
      } else {
        alert(`❌ Clear failed: ${data.error}`);
      }
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`);
    } finally {
      setClearing(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/metrics/daily?range=${range}&dateMode=${dateMode}`);
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

  if (loading && !metrics) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const totals = metrics?.totals;
  const isDataIncomplete = totals && totals.coveragePct < 100;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">🔒 Locked Margin Dashboard</h1>
          <p className="text-gray-600">Real COGS-based margin (not Shopify estimates) • Coverage tracking • Uncovered exposure</p>
          
          {/* Navigation */}
          <nav className="flex flex-wrap gap-3 mt-4">
            <a
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors font-medium"
            >
              🏠 Orders
            </a>
            <span className="text-gray-900 font-bold py-2 px-3 bg-blue-100 rounded-md">
              📊 Dashboard (Current)
            </span>
            <a
              href="/expenses"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
            >
              💰 Expenses
            </a>
            <a
              href="/financial"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-medium"
            >
              📈 Financial Overview
            </a>
          </nav>
        </div>

        {/* Date Mode Toggle */}
        <div className="mb-6 flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">Date Mode:</span>
          <div className="inline-flex rounded-md shadow-sm">
            <button
              onClick={() => setDateMode("locked")}
              className={`px-4 py-2 text-sm font-medium rounded-l-md border ${
                dateMode === "locked"
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              🔒 Locked (Cost Known)
            </button>
            <button
              onClick={() => setDateMode("booked")}
              className={`px-4 py-2 text-sm font-medium rounded-r-md border-t border-r border-b ${
                dateMode === "booked"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              📦 Booked (Sell Date)
            </button>
          </div>
          <span className="text-xs text-gray-500">
            {dateMode === "locked" ? "(When margin became calculable - DEFAULT)" : "(When order was sold on Shopify)"}
          </span>
        </div>

        {/* Period Selector */}
        <div className="mb-6 flex gap-2">
          {[1, 7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                range === d
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-300"
              }`}
            >
              {d === 1 ? "Today" : `Last ${d} days`}
            </button>
          ))}
          <button
            onClick={clearAllOrders}
            disabled={clearing || syncing}
            className="ml-auto px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title="Clear all Shopify orders and order matches (keeps expenses, ads spend, etc.)"
          >
            {clearing ? "⏳ Clearing..." : "🗑️ Clear All Orders"}
          </button>
          <button
            onClick={syncShopifyOrders}
            disabled={syncing || clearing}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title="Sync all Shopify orders from the start of the year (2026-01-01)"
          >
            {syncing ? "⏳ Syncing..." : "🔄 Sync Orders (From Jan 1)"}
          </button>
          <button
            onClick={fetchMetrics}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-medium"
          >
            🔄 Refresh Metrics
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 font-medium">Error: {error}</p>
          </div>
        )}

        {/* Coverage Warning */}
        {isDataIncomplete && totals && (
          <div className="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">
                  Partial Margin ({totals.coveragePct.toFixed(1)}% Coverage)
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p><strong>Uncovered exposure:</strong> CHF {totals.uncoveredSalesChf.toFixed(2)} ({totals.uncoveredCount} orders without supplier cost)</p>
                  <p className="mt-1">Real margin only calculable when supplier cost is known. Uncovered sales = risk/incomplete data.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        {totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {/* Row 1: Core Metrics */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Booked Sales</div>
              <div className="text-2xl font-bold text-blue-600">
                {formatMoneyCHF(totals.bookedSalesChf)}
              </div>
              <div className="text-xs text-gray-500 mt-1">All Shopify sales</div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Locked Sales</div>
              <div className="text-2xl font-bold text-purple-600">
                {formatMoneyCHF(totals.lockedSalesChf)}
              </div>
              <div className="text-xs text-gray-500 mt-1">With known COGS</div>
                </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-green-200">
              <div className="text-sm text-gray-600 mb-1">🔒 Locked Margin</div>
              <div className="text-2xl font-bold text-green-600">
                {formatMoneyCHF(totals.lockedMarginChf)}
              </div>
              <div className="text-xs text-gray-500 mt-1">{formatPercent(totals.lockedMarginPct)} real margin</div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Ads Spend</div>
              <div className="text-2xl font-bold text-orange-600">
                {formatMoneyCHF(totals.adsSpendChf)}
              </div>
              <div className="text-xs text-gray-500 mt-1">Marketing costs</div>
            </div>

            {/* Row 2: Derived & Coverage */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-emerald-200">
              <div className="text-sm text-gray-600 mb-1">Net After Ads</div>
              <div className={`text-2xl font-bold ${totals.netAfterAdsChf >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatMoneyCHF(totals.netAfterAdsChf)}
              </div>
              <div className="text-xs text-gray-500 mt-1">Locked margin - ads</div>
            </div>

            <div className={`p-6 rounded-lg shadow-sm border-2 ${
              totals.coveragePct >= 90 ? 'border-green-300 bg-green-50' : 'border-yellow-300 bg-yellow-50'
            }`}>
              <div className="text-sm text-gray-600 mb-1">Coverage</div>
              <div className={`text-2xl font-bold ${totals.coveragePct >= 90 ? 'text-green-600' : 'text-yellow-600'}`}>
                {totals.coveragePct.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">Reliability</div>
                </div>

            <div className={`p-6 rounded-lg shadow-sm border ${
              totals.uncoveredCount > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
            }`}>
              <div className="text-sm text-gray-600 mb-1">Uncovered</div>
              <div className={`text-2xl font-bold ${totals.uncoveredCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {formatMoneyCHF(totals.uncoveredSalesChf)}
              </div>
              <div className="text-xs text-gray-500 mt-1">{totals.uncoveredCount} orders</div>
            </div>

              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Period</div>
              <div className="text-2xl font-bold text-gray-900">
                {range} days
              </div>
              <div className="text-xs text-gray-500 mt-1">{dateMode} mode</div>
            </div>
          </div>
        )}

        {/* Daily Chart */}
        {metrics && metrics.rows.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8">
            <h2 className="text-xl font-semibold mb-4">📈 Daily Locked Margin & Coverage</h2>
                <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={metrics.rows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                  tick={{ fontSize: 11 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                    <Tooltip
                      formatter={(value: any, name?: string) => {
                    const label = name || "";
                    if (label.includes("Chf") || label.includes("CHF") || label.includes("Sales")) {
                      return [formatMoneyCHF(value), label];
                    }
                    if (label.includes("%") || label.includes("Coverage")) {
                      return [`${Number(value).toFixed(1)}%`, label];
                    }
                    return [value, label];
                  }}
                    />
                    <Legend />
                <Bar yAxisId="left" dataKey="lockedMarginChf" fill="#10b981" name="Locked Margin CHF" />
                <Bar yAxisId="left" dataKey="adsSpendChf" fill="#f97316" name="Ads Spend CHF" />
                <Bar yAxisId="left" dataKey="uncoveredSalesChf" fill="#ef4444" name="Uncovered Sales CHF" />
                    <Line
                      yAxisId="right"
                      type="monotone"
                  dataKey="coveragePct"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  name="Coverage %"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
        )}

        {/* Daily Table */}
        {metrics && metrics.rows.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold">📅 Daily Locked Margin Details</h2>
            </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Booked Sales</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Locked Sales</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">🔒 Locked Margin</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin %</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ads</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Coverage</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Uncovered</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                  {metrics.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">
                        {new Date(row.date).toLocaleDateString('de-CH')}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-600">
                        CHF {row.bookedSalesChf.toFixed(2)}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-purple-600 font-medium">
                        CHF {row.lockedSalesChf.toFixed(2)}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-green-600 font-bold">
                        CHF {row.lockedMarginChf.toFixed(2)}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                        {row.lockedMarginPct.toFixed(1)}%
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-orange-600">
                        CHF {row.adsSpendChf.toFixed(2)}
                          </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-sm text-right font-bold ${
                        row.netAfterAdsChf >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        CHF {row.netAfterAdsChf.toFixed(2)}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          row.coveragePct >= 90 
                            ? 'bg-green-100 text-green-800'
                            : row.coveragePct >= 70
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {row.coveragePct.toFixed(0)}%
                        </span>
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                        {row.uncoveredCount > 0 ? (
                          <span className="text-red-600 font-medium">
                            CHF {row.uncoveredSalesChf.toFixed(2)}
                            <span className="text-xs text-gray-500 ml-1">({row.uncoveredCount})</span>
                              </span>
                            ) : (
                          <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                  ))}
                  </tbody>
                </table>
            </div>
              </div>
            )}

        {/* Empty State */}
        {metrics && metrics.rows.length === 0 && (
          <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-200 text-center">
            <p className="text-gray-600 mb-4">No data available for selected period</p>
            <p className="text-sm text-gray-500">
              Go to the <a href="/" className="text-blue-600 hover:underline">main page</a> to match orders
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
