"use client";

import { useState, useEffect } from "react";
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const VAT_RATE = 0.023; // 2.3% TVA on all sales

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7c7c'];

export default function FinancialOverviewPage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  
  // Data states
  const [salesData, setSalesData] = useState<any[]>([]);
  const [expensesData, setExpensesData] = useState<any[]>([]);
  const [expensesByCategory, setExpensesByCategory] = useState<any[]>([]);
  const [dailyFinancials, setDailyFinancials] = useState<any[]>([]);
  
  // Summary stats
  const [totalSales, setTotalSales] = useState(0);
  const [totalCosts, setTotalCosts] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [totalVAT, setTotalVAT] = useState(0);
  const [finalMargin, setFinalMargin] = useState(0);

  useEffect(() => {
    loadData();
  }, [days]);

  async function loadData() {
    setLoading(true);
    try {
      const from = new Date();
      from.setDate(from.getDate() - days);
      const fromStr = from.toISOString().split('T')[0];

      // Fetch all data in parallel
      const [salesRes, expensesRes, expenseSummaryRes] = await Promise.all([
        fetch(`/api/metrics/margin?days=${days}`),
        fetch(`/api/expenses?from=${fromStr}`),
        fetch(`/api/expenses/summary?from=${fromStr}`)
      ]);

      const [salesJson, expensesJson, expenseSummaryJson] = await Promise.all([
        salesRes.json(),
        expensesRes.json(),
        expenseSummaryRes.json()
      ]);

      // Process sales data
      const sales = salesJson.data || [];
      const totalRev = sales.reduce((sum: number, d: any) => sum + d.sales, 0);
      const totalSupplierCost = sales.reduce((sum: number, d: any) => sum + (d.sales - d.marginChf), 0);
      const vatAmount = totalRev * VAT_RATE;

      setSalesData(sales);
      setTotalSales(totalRev);
      setTotalCosts(totalSupplierCost);
      setTotalVAT(vatAmount);

      // Process expenses data
      const expensesList = expensesJson.expenses || [];
      const totalExp = expensesList.reduce((sum: number, e: any) => sum + e.amount, 0);
      setExpensesData(expensesList);
      setTotalExpenses(totalExp);

      // Expenses by category
      const catSummary = expenseSummaryJson.categorySummary || [];
      setExpensesByCategory(catSummary);

      // Calculate daily financials
      const dailyMap = new Map<string, any>();

      // Add sales data
      sales.forEach((day: any) => {
        dailyMap.set(day.date, {
          date: day.date,
          sales: day.sales,
          costs: day.sales - day.marginChf,
          expenses: 0,
          vat: day.sales * VAT_RATE,
          margin: 0
        });
      });

      // Add expenses data (group by day)
      const dailyExpenses = new Map<string, number>();
      expensesList.forEach((exp: any) => {
        const date = new Date(exp.date).toISOString().split('T')[0];
        dailyExpenses.set(date, (dailyExpenses.get(date) || 0) + exp.amount);
      });

      dailyExpenses.forEach((amount, date) => {
        const existing = dailyMap.get(date) || {
          date,
          sales: 0,
          costs: 0,
          expenses: 0,
          vat: 0,
          margin: 0
        };
        existing.expenses = amount;
        dailyMap.set(date, existing);
      });

      // Calculate final margin for each day
      const dailyArray = Array.from(dailyMap.values()).map(d => {
        d.margin = d.sales - d.costs - d.expenses - d.vat;
        return d;
      }).sort((a, b) => a.date.localeCompare(b.date));

      setDailyFinancials(dailyArray);

      // Calculate overall final margin
      const finalMarg = totalRev - totalSupplierCost - totalExp - vatAmount;
      setFinalMargin(finalMarg);

    } catch (error) {
      console.error('Error loading financial data:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading financial data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">📈 Financial Overview</h1>
          <p className="text-gray-600">Complete profit & loss analysis with expenses & VAT</p>
          
          {/* Navigation */}
          <nav className="flex flex-wrap gap-3 mt-4">
            <a
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors font-medium"
            >
              🏠 Orders
            </a>
            <a
              href="/dashboard"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              📊 Dashboard
            </a>
            <a
              href="/expenses"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
            >
              💰 Expenses
            </a>
            <span className="text-gray-900 font-bold py-2 px-3 bg-purple-100 rounded-md">
              📈 Financial (Current)
            </span>
          </nav>
        </div>

        {/* Period Selector */}
        <div className="mb-6 flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                days === d
                  ? "bg-purple-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              Last {d} days
            </button>
          ))}
          <button
            onClick={loadData}
            className="ml-auto px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-medium"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Total Sales</div>
            <div className="text-2xl font-bold text-blue-600">CHF {totalSales.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">Gross revenue</div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Supplier Costs</div>
            <div className="text-2xl font-bold text-orange-600">-CHF {totalCosts.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">Supplier purchases</div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Expenses</div>
            <div className="text-2xl font-bold text-red-600">-CHF {totalExpenses.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">Ads, fees, etc.</div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">VAT (2.3%)</div>
            <div className="text-2xl font-bold text-purple-600">-CHF {totalVAT.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">Tax on sales</div>
          </div>
          
          <div className={`p-6 rounded-lg shadow ${finalMargin >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="text-sm font-medium text-gray-500">Final Margin</div>
            <div className={`text-2xl font-bold ${finalMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              CHF {finalMargin.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {totalSales > 0 ? `${((finalMargin / totalSales) * 100).toFixed(1)}%` : '0%'} margin
            </div>
          </div>
        </div>

        {/* Daily P&L Chart */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">📊 Daily Profit & Loss</h2>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={dailyFinancials}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip 
                formatter={(value: any) => `CHF ${Number(value).toFixed(2)}`}
                contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}
              />
              <Legend />
              <Bar dataKey="sales" name="Sales" fill="#3b82f6" />
              <Bar dataKey="costs" name="Costs" fill="#f97316" />
              <Bar dataKey="expenses" name="Expenses" fill="#ef4444" />
              <Bar dataKey="vat" name="VAT" fill="#a855f7" />
              <Line type="monotone" dataKey="margin" name="Final Margin" stroke="#10b981" strokeWidth={3} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Expenses by Category */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-900 mb-4">💸 Expenses by Category</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={expensesByCategory}
                  dataKey="total"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={(entry) => `${entry.category}: CHF ${entry.total.toFixed(0)}`}
                >
                  {expensesByCategory.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => `CHF ${Number(value).toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-4 space-y-2">
              {expensesByCategory.slice(0, 5).map((cat, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">{cat.category}</span>
                  <span className="font-medium">CHF {cat.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-900 mb-4">📋 Financial Breakdown</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-blue-50 rounded">
                <span className="font-medium text-gray-700">💰 Total Sales</span>
                <span className="text-lg font-bold text-blue-600">CHF {totalSales.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="font-medium text-gray-700">📦 Supplier Costs</span>
                <span className="text-lg font-bold text-orange-600">- CHF {totalCosts.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="font-medium text-gray-700">💸 Business Expenses</span>
                <span className="text-lg font-bold text-red-600">- CHF {totalExpenses.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="font-medium text-gray-700">🏛️ VAT (2.3%)</span>
                <span className="text-lg font-bold text-purple-600">- CHF {totalVAT.toFixed(2)}</span>
              </div>
              
              <div className="border-t-2 border-gray-300 pt-3 mt-3"></div>
              
              <div className={`flex justify-between items-center p-4 rounded ${
                finalMargin >= 0 ? 'bg-green-50' : 'bg-red-50'
              }`}>
                <span className="font-bold text-gray-900 text-lg">= Net Profit</span>
                <span className={`text-2xl font-bold ${
                  finalMargin >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  CHF {finalMargin.toFixed(2)}
                </span>
              </div>
              
              <div className="text-center text-sm text-gray-600 mt-2">
                Margin: {totalSales > 0 ? ((finalMargin / totalSales) * 100).toFixed(2) : '0'}%
              </div>
            </div>
          </div>
        </div>

        {/* Daily Details Table */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold text-gray-900 mb-4">📅 Daily Financial Details</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Costs</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Expenses</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">VAT</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dailyFinancials.map((day, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(day.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-600 font-medium">
                      CHF {day.sales.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-600">
                      -CHF {day.costs.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600">
                      -CHF {day.expenses.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-purple-600">
                      -CHF {day.vat.toFixed(2)}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${
                      day.margin >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      CHF {day.margin.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

