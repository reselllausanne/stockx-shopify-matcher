/**
 * StockX Cookie Exporter
 * 
 * HOW TO USE:
 * 1. Open https://pro.stockx.com/purchasing/orders in Chrome/Firefox
 * 2. Make sure you're logged in
 * 3. Open Developer Tools (F12)
 * 4. Go to Console tab
 * 5. Paste this entire script and press Enter
 * 6. File will auto-download as stockx-cookies.json
 * 7. Move file to your project root
 */

(function exportStockXCookies() {
  console.log('🔐 StockX Cookie Exporter v1.0');
  console.log('─'.repeat(60));

  // Check if we're on the right domain
  if (!window.location.hostname.includes('stockx.com')) {
    console.error('❌ ERROR: You must run this on a stockx.com page!');
    console.log('Navigate to: https://pro.stockx.com/purchasing/orders');
    return;
  }

  // Get all cookies from document.cookie
  const cookieString = document.cookie;
  
  if (!cookieString || cookieString.trim() === '') {
    console.error('❌ ERROR: No cookies found!');
    console.log('Make sure you are logged in to StockX.');
    return;
  }

  // Parse cookies into array of objects
  const cookies = cookieString.split('; ').map(c => {
    const [name, ...valueParts] = c.split('=');
    const value = valueParts.join('='); // Handle values with = in them
    
    return {
      name: name,
      value: decodeURIComponent(value),
      domain: '.stockx.com', // Use wildcard domain for all subdomains
      path: '/',
      secure: true,
      httpOnly: false, // Can only access non-httpOnly cookies from JS
      sameSite: 'Lax'
    };
  });

  console.log(`✅ Found ${cookies.length} cookies`);
  console.log('📋 Cookie names:', cookies.map(c => c.name).join(', '));

  // Check for important cookies
  const importantCookies = ['_pxhd', 'stockx_session', 'stockx_jwt'];
  const foundImportant = importantCookies.filter(name => 
    cookies.some(c => c.name.includes(name))
  );
  
  if (foundImportant.length > 0) {
    console.log(`🎯 Found important cookies: ${foundImportant.join(', ')}`);
  } else {
    console.warn('⚠️ WARNING: No session cookies found. Are you logged in?');
  }

  // Pretty-print JSON
  const jsonString = JSON.stringify(cookies, null, 2);

  console.log('─'.repeat(60));
  console.log('📦 COPY THIS JSON (or use auto-downloaded file):');
  console.log('─'.repeat(60));
  console.log(jsonString);
  console.log('─'.repeat(60));

  // Auto-download as file
  try {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stockx-cookies.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('✅ File downloaded as stockx-cookies.json');
    console.log('📁 Move it to your project root:');
    console.log('   cp ~/Downloads/stockx-cookies.json /path/to/your/project/');
  } catch (error) {
    console.error('❌ Auto-download failed:', error.message);
    console.log('💡 Copy the JSON above manually and save as stockx-cookies.json');
  }

  console.log('─'.repeat(60));
  console.log('🚀 NEXT STEPS:');
  console.log('1. Move stockx-cookies.json to your project root');
  console.log('2. Run your Next.js app: npm run dev');
  console.log('3. Click "🍪 Via Cookies" button to test');
  console.log('─'.repeat(60));

})();
