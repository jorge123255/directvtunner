const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH_STATE_PATH = path.join(__dirname, '../tve_directv_service/data/directv_state.json');

async function launchPlayer() {
  console.log('[chrome-player] Starting Chrome with Widevine support...');

  // Check if auth state exists
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    console.error('[chrome-player] No auth state found at:', AUTH_STATE_PATH);
    console.log('[chrome-player] Please login first via the auth service.');
    process.exit(1);
  }

  const authState = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
  console.log(`[chrome-player] Loaded ${authState.cookies?.length || 0} cookies from auth state`);

  // Launch real Chrome (not Chromium) - this has Widevine support
  const browser = await chromium.launch({
    channel: 'chrome',  // Use system Chrome
    headless: false,    // Must be visible for DRM
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--start-maximized'
    ]
  });

  // Create context with saved auth state
  const context = await browser.newContext({
    storageState: authState,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  // Log console messages
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('DRM') || msg.text().includes('Widevine') || msg.text().includes('PlaybackError')) {
      console.log(`[chrome-player] [${msg.type()}] ${msg.text()}`);
    }
  });

  // Navigate to DirecTV
  console.log('[chrome-player] Navigating to stream.directv.com...');
  await page.goto('https://stream.directv.com/watchnow', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('[chrome-player] Page loaded. Current URL:', page.url());
  console.log('[chrome-player] Chrome window is now open. You can interact with it manually.');
  console.log('[chrome-player] Press Ctrl+C to close.');

  // Keep the browser open
  await new Promise(() => {}); // Never resolves - keeps browser open
}

launchPlayer().catch(err => {
  console.error('[chrome-player] Error:', err);
  process.exit(1);
});
