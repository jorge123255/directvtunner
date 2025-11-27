const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

async function launchPlayer() {
  console.log('[chrome-player] Starting Chrome with your user profile...');

  // Path to Chrome user data directory on macOS
  const userDataDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');

  console.log('[chrome-player] Using Chrome profile at:', userDataDir);

  // Launch Chrome with persistent context (your actual profile)
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--profile-directory=Default'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: null  // Use default viewport
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  // Log console messages
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('PlaybackError') || text.includes('DRM')) {
      console.log(`[chrome-player] [${msg.type()}] ${text}`);
    }
  });

  // Navigate to DirecTV
  console.log('[chrome-player] Navigating to stream.directv.com...');
  await page.goto('https://stream.directv.com/watchnow', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('[chrome-player] Page loaded. URL:', page.url());
  console.log('[chrome-player] Using your real Chrome profile - should work like normal Chrome.');
  console.log('[chrome-player] Press Ctrl+C to close.');

  // Keep browser open
  await new Promise(() => {});
}

launchPlayer().catch(err => {
  console.error('[chrome-player] Error:', err.message);
  process.exit(1);
});
