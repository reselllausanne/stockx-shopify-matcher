# ⏰ Cron Job Setup Guide

## Quick Start: Running Workers Automatically

### Option 1: Local Cron (macOS/Linux)

#### 1. Get your StockX token

```bash
# In browser DevTools (Network tab), copy the Authorization header from any StockX API call
# Example: "Bearer eyJhbGc..."
```

#### 2. Create a shell script

Create `/Users/theomanzinali/Code scrapping price /scripts/sync-workers.sh`:

```bash
#!/bin/bash

# Configuration
APP_URL="http://localhost:3000"
STOCKX_TOKEN="Bearer YOUR_TOKEN_HERE"  # Replace with your token

# Sync new orders
curl -X POST "$APP_URL/api/sync/new-orders" \
  -H "Content-Type: application/json" \
  -d "{\"stockxToken\":\"$STOCKX_TOKEN\"}" \
  >> /tmp/stockx-sync.log 2>&1

# Check status updates (every 30 min only)
MINUTE=$(date +%M)
if [ $((10#$MINUTE % 30)) -eq 0 ]; then
  curl -X POST "$APP_URL/api/sync/status-check" \
    -H "Content-Type: application/json" \
    -d "{\"stockxToken\":\"$STOCKX_TOKEN\"}" \
    >> /tmp/stockx-status.log 2>&1
fi
```

Make it executable:

```bash
chmod +x "/Users/theomanzinali/Code scrapping price /scripts/sync-workers.sh"
```

#### 3. Add to crontab

```bash
crontab -e
```

Add these lines:

```cron
# Sync new orders every 5 minutes
*/5 * * * * /Users/theomanzinali/Code\ scrapping\ price\ /scripts/sync-workers.sh
```

Save and exit (`:wq` in vim).

#### 4. Verify cron is running

```bash
crontab -l
tail -f /tmp/stockx-sync.log
```

---

### Option 2: pm2 (Node.js Process Manager)

#### 1. Install pm2

```bash
npm install -g pm2
```

#### 2. Create worker script

Create `/Users/theomanzinali/Code scrapping price /scripts/worker.js`:

```javascript
const https = require('https');

const APP_URL = 'http://localhost:3000';
const STOCKX_TOKEN = 'Bearer YOUR_TOKEN_HERE'; // Replace

function callAPI(endpoint, name) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ stockxToken: STOCKX_TOKEN });
    const url = new URL(endpoint, APP_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    
    const req = (url.protocol === 'https:' ? https : require('http')).request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`[${new Date().toISOString()}] ${name}:`, body.substring(0, 200));
        resolve();
      });
    });
    
    req.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] ${name} ERROR:`, error);
      reject(error);
    });
    
    req.write(data);
    req.end();
  });
}

async function syncNewOrders() {
  await callAPI('/api/sync/new-orders', 'SYNC');
}

async function checkStatus() {
  await callAPI('/api/sync/status-check', 'STATUS');
}

// Run sync every 5 minutes
setInterval(syncNewOrders, 5 * 60 * 1000);

// Run status check every 30 minutes
setInterval(checkStatus, 30 * 60 * 1000);

// Initial runs
syncNewOrders();
setTimeout(checkStatus, 10000); // After 10 seconds

console.log('[WORKER] Started. Sync every 5min, Status check every 30min.');
```

#### 3. Start with pm2

```bash
cd "/Users/theomanzinali/Code scrapping price "
pm2 start scripts/worker.js --name "stockx-worker"
pm2 save
pm2 startup  # Enable auto-start on reboot
```

#### 4. Monitor

```bash
pm2 logs stockx-worker
pm2 status
```

---

### Option 3: GitHub Actions (Cloud-based)

#### 1. Create workflow file

Create `.github/workflows/sync-stockx.yml`:

```yaml
name: Sync StockX Orders

on:
  schedule:
    # Every 5 minutes
    - cron: '*/5 * * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  sync-new-orders:
    runs-on: ubuntu-latest
    steps:
      - name: Sync new orders
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/sync/new-orders \
            -H "Content-Type: application/json" \
            -d '{"stockxToken":"${{ secrets.STOCKX_TOKEN }}"}'

  check-status:
    runs-on: ubuntu-latest
    if: github.event.schedule == '0 */30 * * *' # Every 30 minutes
    steps:
      - name: Check status updates
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/sync/status-check \
            -H "Content-Type: application/json" \
            -d '{"stockxToken":"${{ secrets.STOCKX_TOKEN }}"}'
```

#### 2. Add secrets in GitHub

Go to your repo → Settings → Secrets → Actions:

- `APP_URL`: `https://your-app.vercel.app` (or your production URL)
- `STOCKX_TOKEN`: `Bearer eyJhbGc...`

#### 3. Enable Actions

Go to Actions tab → Enable workflows

---

### Option 4: Manual Dashboard Buttons (No Automation)

If you prefer manual control:

1. Open the dashboard: `http://localhost:3000`
2. Click **"🔄 Sync New Orders"** when you want to check for new orders
3. Click **"✅ Check Status Updates"** when you want to refresh statuses

---

## 🔒 Security Notes

### Never commit tokens!

Add to `.gitignore`:

```
.env
.env.local
scripts/*.sh
```

### Token expiration

StockX tokens typically expire after 24-48 hours. When a sync fails with 401:

1. Open StockX in browser
2. Open DevTools → Network tab
3. Copy new `Authorization` header
4. Update your cron script or environment variable

### Recommended: Token refresh script

Create `scripts/refresh-token.sh`:

```bash
#!/bin/bash

# This script extracts the latest StockX token from browser
# (requires manual browser open + DevTools copy)

echo "Open StockX in browser, then:"
echo "1. Open DevTools (F12)"
echo "2. Go to Network tab"
echo "3. Refresh page"
echo "4. Click any 'gateway' request"
echo "5. Copy the 'Authorization' header value"
echo ""
read -p "Paste token here: " TOKEN

# Update worker script
sed -i "" "s|STOCKX_TOKEN=.*|STOCKX_TOKEN=\"$TOKEN\"|" scripts/sync-workers.sh

echo "✅ Token updated in scripts/sync-workers.sh"
```

---

## 📊 Monitoring

### Check logs

```bash
# Sync logs
tail -f /tmp/stockx-sync.log

# Status check logs
tail -f /tmp/stockx-status.log

# pm2 logs
pm2 logs stockx-worker

# Next.js server logs
cd "/Users/theomanzinali/Code scrapping price "
npm run dev
```

### Dashboard stats

Visit `http://localhost:3000` to see:
- Last sync result
- Last status check result
- All stored matches
- Confidence distribution

---

## 🐛 Troubleshooting

### Cron not running

```bash
# Check cron service (macOS)
sudo launchctl list | grep cron

# Check cron logs
tail -f /var/log/cron.log
```

### pm2 process died

```bash
pm2 restart stockx-worker
pm2 logs --err
```

### Token expired

```bash
# Update token in script
nano scripts/sync-workers.sh
# or
./scripts/refresh-token.sh
```

### App not running

```bash
cd "/Users/theomanzinali/Code scrapping price "
npm run dev
```

---

## ✅ Recommended Setup (for continuous operation)

**Best practice: pm2 + local cron**

1. Run Next.js app with pm2:
   ```bash
   pm2 start npm --name "stockx-app" -- run dev
   pm2 save
   ```

2. Run worker with pm2:
   ```bash
   pm2 start scripts/worker.js --name "stockx-worker"
   pm2 save
   ```

3. Enable auto-start on reboot:
   ```bash
   pm2 startup
   ```

4. Monitor:
   ```bash
   pm2 monit
   ```

This ensures:
- ✅ App restarts on crash
- ✅ Auto-start on system reboot
- ✅ Centralized logging
- ✅ Low resource usage

---

**Questions?** Check `AUTO_SYNC_ARCHITECTURE.md` for full technical details.


