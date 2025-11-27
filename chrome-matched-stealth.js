const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Stealth scripts matching EXACT fingerprint from manual capture
const STEALTH_SCRIPTS = `
  // Match exact Chrome 142 on M3 Max fingerprint

  // Override webdriver - CRITICAL
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true
  });

  // Delete all CDP/automation indicators
  const cdcKeys = Object.keys(window).filter(k => k.startsWith('cdc_') || k.startsWith('$cdc'));
  cdcKeys.forEach(key => delete window[key]);

  // Chrome runtime - must exist
  if (!window.chrome) window.chrome = {};
  window.chrome.runtime = {
    connect: function() {},
    sendMessage: function() {},
    onMessage: { addListener: function() {} },
    id: undefined
  };

  // Match exact hardware - M3 Max has 14 cores, 8GB visible memory
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 14,
    configurable: true
  });

  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true
  });

  // Match exact platform
  Object.defineProperty(navigator, 'platform', {
    get: () => 'MacIntel',
    configurable: true
  });

  // Match languages exactly
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true
  });

  Object.defineProperty(navigator, 'language', {
    get: () => 'en-US',
    configurable: true
  });

  // Max touch points = 0 for desktop Mac
  Object.defineProperty(navigator, 'maxTouchPoints', {
    get: () => 0,
    configurable: true
  });

  // Plugins - Chrome has 5 default plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 }
      ];
      plugins.refresh = () => {};
      plugins.item = (i) => plugins[i];
      plugins.namedItem = (name) => plugins.find(p => p.name === name);
      return plugins;
    },
    configurable: true
  });

  // WebGL - match exact M3 Max renderer
  const getParameterProto = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Google Inc. (Apple)';
    if (param === 37446) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)';
    if (param === 7936) return 'WebKit';
    if (param === 7937) return 'WebKit WebGL';
    return getParameterProto.call(this, param);
  };

  const getParameter2Proto = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Google Inc. (Apple)';
    if (param === 37446) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)';
    if (param === 7936) return 'WebKit';
    if (param === 7937) return 'WebKit WebGL';
    return getParameter2Proto.call(this, param);
  };

  // Permissions query
  const originalQuery = navigator.permissions?.query;
  if (originalQuery) {
    navigator.permissions.query = (params) => {
      if (params.name === 'notifications') {
        return Promise.resolve({ state: 'default', onchange: null });
      }
      return originalQuery.call(navigator.permissions, params);
    };
  }

  // Override Notification
  if (typeof Notification !== 'undefined') {
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
      configurable: true
    });
  }

  // Screen properties matching macOS
  Object.defineProperty(screen, 'colorDepth', { get: () => 30 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 30 });

  // Disable automation-related CSS
  const style = document.createElement('style');
  style.textContent = '.automation-indicator { display: none !important; }';
  document.head?.appendChild(style);

  console.log('[stealth] Fingerprint matched to M3 Max Chrome 142');
`;

const AUTH_STATE_PATH = path.join(__dirname, '../tve_directv_service/data/directv_state.json');

async function launchPlayer() {
  console.log('[matched-stealth] Starting Chrome with exact fingerprint match...');

  if (!fs.existsSync(AUTH_STATE_PATH)) {
    console.error('[matched-stealth] No auth state found');
    process.exit(1);
  }

  const authState = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
  console.log(`[matched-stealth] Loaded ${authState.cookies?.length || 0} cookies`);

  // Launch with exact Chrome 142 user agent
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--start-maximized'
    ],
    ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection']
  });

  const context = await browser.newContext({
    storageState: authState,
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    // Match exact user agent from capture
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Chicago', // Central time
    colorScheme: 'light',
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false
  });

  // Inject stealth BEFORE page loads
  await context.addInitScript(STEALTH_SCRIPTS);

  const page = await context.newPage();

  // Add extra runtime patches
  await page.addInitScript(() => {
    // Patch Function.prototype.toString to hide our overrides
    const nativeToString = Function.prototype.toString;
    const myFuncs = new Set();

    Function.prototype.toString = function() {
      if (myFuncs.has(this)) {
        return 'function () { [native code] }';
      }
      return nativeToString.call(this);
    };
    myFuncs.add(Function.prototype.toString);
  });

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('DRM') || text.includes('Widevine') ||
        text.includes('PlaybackError') || text.includes('stealth')) {
      console.log(`[matched-stealth] [${msg.type()}] ${text}`);
    }
  });

  console.log('[matched-stealth] Navigating to DirecTV...');
  await page.goto('https://stream.directv.com/watchnow', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  console.log('[matched-stealth] Page loaded:', page.url());
  console.log('[matched-stealth] Press Ctrl+C to close.');

  // Keep open
  await new Promise(() => {});
}

launchPlayer().catch(err => {
  console.error('[matched-stealth] Error:', err);
  process.exit(1);
});
