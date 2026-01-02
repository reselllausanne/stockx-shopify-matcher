/**
 * 🍪 EXPORT STOCKX COOKIES - Run this in Chrome DevTools Console
 * 
 * HOW TO USE:
 * 1. Open Chrome
 * 2. Login to https://pro.stockx.com/purchasing/orders
 * 3. Press F12 (open DevTools)
 * 4. Go to "Console" tab
 * 5. Copy-paste this ENTIRE script
 * 6. Press Enter
 * 7. Cookies will be copied to clipboard
 * 8. Paste into: stockx-cookies.json in your project root
 */

(function exportStockXCookies() {
  console.log("🍪 Exporting StockX cookies...");
  
  // Get all cookies from current domain
  const cookiesString = document.cookie;
  
  if (!cookiesString) {
    console.error("❌ No cookies found! Make sure you're logged in.");
    return;
  }
  
  // Parse cookies into Puppeteer format
  const cookies = cookiesString.split('; ').map(cookie => {
    const [name, ...valueParts] = cookie.split('=');
    return {
      name: name.trim(),
      value: valueParts.join('=').trim(),
      domain: '.stockx.com',  // Use domain that works for all StockX subdomains
      path: '/',
      expires: Date.now() / 1000 + (7 * 24 * 60 * 60), // 7 days from now
      httpOnly: false,
      secure: true,
      sameSite: 'Lax'
    };
  });
  
  console.log(`✅ Found ${cookies.length} cookies`);
  
  // Convert to JSON
  const cookiesJSON = JSON.stringify(cookies, null, 2);
  
  // Copy to clipboard
  navigator.clipboard.writeText(cookiesJSON).then(() => {
    console.log("✅ Cookies copied to clipboard!");
    console.log("📋 Now paste into: stockx-cookies.json");
    console.log("\n📝 Preview (first 3):");
    console.log(cookies.slice(0, 3).map(c => `  - ${c.name}`).join('\n'));
  }).catch(err => {
    console.error("❌ Failed to copy to clipboard:", err);
    console.log("\n📋 Copy this manually:");
    console.log(cookiesJSON);
  });
  
  return cookies;
})();

