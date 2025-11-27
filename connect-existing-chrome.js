const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// This script connects to an EXISTING Chrome browser instead of launching a new one
// This bypasses DirecTV's anti-bot detection since Chrome wasn't launched by automation
//
// Usage: node connect-existing-chrome.js [channel-url]
// Example: node connect-existing-chrome.js "https://stream.directv.com/watch/ESPN"

const AUTH_STATE_PATH = path.join(__dirname, '../tve_directv_service/data/directv_state.json');

// Get channel URL from command line or use default
const CHANNEL_URL = process.argv[2] || 'https://stream.directv.com/watchnow';

async function connectToChrome() {
  console.log('[connect-chrome] DirecTV Player - Chrome Remote Debugging Mode');
  console.log('[connect-chrome] Target URL:', CHANNEL_URL);
  console.log('[connect-chrome] ');
  console.log('[connect-chrome] Attempting to connect to localhost:9222...');

  try {
    // Connect to existing Chrome browser
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    console.log('[connect-chrome] Connected to Chrome!');

    // Get all contexts
    const contexts = browser.contexts();
    console.log(`[connect-chrome] Found ${contexts.length} contexts`);

    let context = contexts[0];
    if (!context) {
      // If no context, create one
      context = await browser.newContext();
    }

    // Load auth state cookies
    if (fs.existsSync(AUTH_STATE_PATH)) {
      const authState = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
      console.log(`[connect-chrome] Loading ${authState.cookies?.length || 0} cookies...`);

      // Add cookies directly
      for (const cookie of authState.cookies || []) {
        try {
          await context.addCookies([{
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'None',
            expires: cookie.expires || -1
          }]);
        } catch (err) {
          // Ignore cookie errors
        }
      }
      console.log('[connect-chrome] Cookies loaded.');
    }

    // Get or create a page
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    // Navigate to DirecTV channel
    console.log('[connect-chrome] Navigating to:', CHANNEL_URL);
    await page.goto(CHANNEL_URL, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    console.log('[connect-chrome] Page loaded:', page.url());
    console.log('[connect-chrome] Browser is now controlled. Press Ctrl+C to disconnect.');

    // Keep connection alive
    await new Promise(() => {});

  } catch (err) {
    if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
      console.log('[connect-chrome] Could not connect to Chrome on port 9222.');
      console.log('[connect-chrome] Use launch-directv.sh to start Chrome with remote debugging.');
    } else {
      console.error('[connect-chrome] Error:', err.message);
    }
    process.exit(1);
  }
}

connectToChrome();
