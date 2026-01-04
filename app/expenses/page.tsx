"use client";

import { useState, useEffect } from "react";

export default function ExpensesPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Form state
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [isBusiness, setIsBusiness] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [catRes, accRes, expRes] = await Promise.all([
        fetch('/api/expenses/categories'),
        fetch('/api/expenses/accounts'),
        fetch('/api/expenses?from=2024-01-01')
      ]);
      
      const [catData, accData, expData] = await Promise.all([
        catRes.json(),
        accRes.json(),
        expRes.json()
      ]);
      
      setCategories(catData.categories || []);
      setAccounts(accData.accounts || []);
      setExpenses(expData.expenses || []);
      
      if (catData.categories?.length > 0) setCategoryId(catData.categories[0].id);
      if (accData.accounts?.length > 0) setAccountId(accData.accounts[0].id);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          amount: parseFloat(amount),
          categoryId,
          accountId,
          note: note || null,
          isBusiness,
          currencyCode: 'CHF'
        })
      });
      
      if (res.ok) {
        alert('✅ Expense added!');
        setAmount("");
        setNote("");
        loadData();
      } else {
        const error = await res.json();
        alert('Error: ' + (error.error || 'Failed to add expense'));
      }
    } catch (error) {
      console.error('Error adding expense:', error);
      alert('Error adding expense');
    } finally {
      setLoading(false);
    }
  }

  const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const businessTotal = expenses.filter(e => e.isBusiness).reduce((sum, e) => sum + e.amount, 0);
  const personalTotal = expenses.filter(e => !e.isBusiness).reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">💰 Personal Expenses</h1>
          <p className="text-gray-600 mt-2">Track your daily expenses and business costs</p>
          
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
            <span className="text-gray-900 font-bold py-2 px-3 bg-green-100 rounded-md">
              💰 Expenses (Current)
            </span>
            <a
              href="/financial"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-medium"
            >
              📈 Financial Overview
            </a>
          </nav>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Total Expenses</div>
            <div className="text-2xl font-bold text-gray-900">CHF {total.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">{expenses.length} transactions</div>
          </div>
          <div className="bg-blue-50 p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-blue-700">Business</div>
            <div className="text-2xl font-bold text-blue-900">CHF {businessTotal.toFixed(2)}</div>
          </div>
          <div className="bg-green-50 p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-green-700">Personal</div>
            <div className="text-2xl font-bold text-green-900">CHF {personalTotal.toFixed(2)}</div>
          </div>
        </div>

        {/* Quick Google Ads Entry */}
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 p-6 rounded-lg shadow mb-8">
          <h3 className="text-lg font-bold text-red-900 mb-3">📢 Quick Google Ads Entry</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (CHF)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                id="adsAmount"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500"
              />
            </div>
            <button
              onClick={async () => {
                const input = document.getElementById('adsAmount') as HTMLInputElement;
                const amt = parseFloat(input.value);
                if (!amt || amt <= 0) {
                  alert('Please enter a valid amount');
                  return;
                }
                
                const adsCat = categories.find(c => c.name === 'Marketing & Ads');
                const defaultAcc = accounts[0];
                
                if (!adsCat) {
                  alert('Marketing & Ads category not found');
                  return;
                }
                
                const res = await fetch('/api/expenses', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    date: new Date().toISOString().split('T')[0],
                    amount: amt,
                    categoryId: adsCat.id,
                    accountId: defaultAcc.id,
                    note: 'Google Ads',
                    isBusiness: true,
                    currencyCode: 'CHF'
                  })
                });
                
                if (res.ok) {
                  alert('✅ Google Ads expense added!');
                  input.value = '';
                  loadData();
                } else {
                  alert('Error adding expense');
                }
              }}
              className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium"
            >
              💸 Add Google Ads
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Add Expense Form */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-900 mb-4">➕ Add New Expense</h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (CHF)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.type === 'BUSINESS' ? '🏢' : '👤'} {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Account</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      💳 {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Description..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isBusiness"
                  checked={isBusiness}
                  onChange={(e) => setIsBusiness(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="isBusiness" className="ml-2 block text-sm text-gray-900">
                  Mark as Business Expense
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
              >
                {loading ? 'Adding...' : '✅ Add Expense'}
              </button>
            </form>
          </div>

          {/* Recent Expenses List */}
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">📋 Recent Expenses</h2>
              <button
                onClick={() => {
                  // Generate CSV
                  const header = 'Date,Amount,Category,Account,Note,Type\n';
                  const rows = expenses.map(e => 
                    `${new Date(e.date).toLocaleDateString()},${e.amount.toFixed(2)},${e.category.name},${e.account.name},"${e.note || ''}",${e.isBusiness ? 'Business' : 'Personal'}`
                  ).join('\n');
                  const csv = header + rows;
                  
                  // Download
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `expenses-${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium text-sm"
              >
                📥 Export CSV
              </button>
            </div>
            
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {expenses.slice(0, 50).map((exp) => (
                <div key={exp.id} className="border border-gray-200 rounded-md p-3 hover:bg-gray-50">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">
                        {exp.category.name}
                        {exp.isBusiness && <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">Business</span>}
                      </div>
                      {exp.note && <div className="text-sm text-gray-600">{exp.note}</div>}
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(exp.date).toLocaleDateString()} • {exp.account.name}
                      </div>
                    </div>
                    <div className="text-lg font-bold text-gray-900">
                      CHF {exp.amount.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
              
              {expenses.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  No expenses yet. Add your first one! 👆
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

