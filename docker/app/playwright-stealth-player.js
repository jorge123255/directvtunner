const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Use the stealth plugin
chromium.use(StealthPlugin());

const AUTH_STATE_PATH = path.join(__dirname, '../tve_directv_service/data/directv_state.json');

async function launchPlayer() {
  console.log('[stealth-player] Starting Chrome with playwright-extra stealth plugin...');

  // Check if auth state exists
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    console.error('[stealth-player] No auth state found at:', AUTH_STATE_PATH);
    console.log('[stealth-player] Please login first via the auth service.');
    process.exit(1);
  }

  const authState = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
  console.log(`[stealth-player] Loaded ${authState.cookies?.length || 0} cookies from auth state`);

  // Launch real Chrome with stealth
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized'
    ]
  });

  // Create context with saved auth state
  const context = await browser.newContext({
    storageState: authState,
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });

  const page = await context.newPage();

  // Log console messages
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('DRM') || text.includes('Widevine') || text.includes('PlaybackError') || text.includes('bot')) {
      console.log(`[stealth-player] [${msg.type()}] ${text}`);
    }
  });

  // Navigate to DirecTV
  console.log('[stealth-player] Navigating to stream.directv.com...');
  await page.goto('https://stream.directv.com/watchnow', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  console.log('[stealth-player] Page loaded. Current URL:', page.url());
  console.log('[stealth-player] Press Ctrl+C to close.');

  // Keep the browser open
  await new Promise(() => {});
}

launchPlayer().catch(err => {
  console.error('[stealth-player] Error:', err);
  process.exit(1);
});
