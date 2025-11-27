const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH_STATE_PATH = path.join(__dirname, '../tve_directv_service/data/directv_state.json');

// Stealth scripts to inject
const STEALTH_SCRIPTS = `
  // Override webdriver detection
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true
  });

  // Delete automation indicators
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

  // Add Chrome runtime
  if (!window.chrome) {
    window.chrome = {};
  }
  window.chrome.runtime = {
    PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
    PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
    PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
    RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    connect: function() {},
    sendMessage: function() {},
    id: undefined
  };

  // Override permissions query
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // Spoof plugins to look like real Chrome
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ];
      plugins.refresh = () => {};
      return plugins;
    },
    configurable: true
  });

  // Spoof mimeTypes
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => {
      const mimeTypes = [
        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }
      ];
      return mimeTypes;
    },
    configurable: true
  });

  // Spoof languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true
  });

  // Override Notification permissions
  Object.defineProperty(Notification, 'permission', {
    get: () => 'default',
    configurable: true
  });

  // Make navigator.hardwareConcurrency realistic
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true
  });

  // Make navigator.deviceMemory realistic
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true
  });

  // Override WebGL vendor/renderer to look normal
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) {
      return 'Intel Inc.';
    }
    if (parameter === 37446) {
      return 'Intel Iris OpenGL Engine';
    }
    return getParameter.apply(this, arguments);
  };

  const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) {
      return 'Intel Inc.';
    }
    if (parameter === 37446) {
      return 'Intel Iris OpenGL Engine';
    }
    return getParameter2.apply(this, arguments);
  };

  // Remove Playwright/automation traces from Error stack
  const originalError = Error;
  Error = function(...args) {
    const error = new originalError(...args);
    const stack = error.stack;
    if (stack) {
      error.stack = stack.replace(/playwright|puppeteer|automation|webdriver/gi, 'chrome');
    }
    return error;
  };
  Error.prototype = originalError.prototype;
`;

async function launchPlayer() {
  console.log('[stealth-player] Starting Chrome with stealth mode...');

  // Check if auth state exists
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    console.error('[stealth-player] No auth state found at:', AUTH_STATE_PATH);
    console.log('[stealth-player] Please login first via the auth service.');
    process.exit(1);
  }

  const authState = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
  console.log(`[stealth-player] Loaded ${authState.cookies?.length || 0} cookies from auth state`);

  // Launch real Chrome with stealth args
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--start-maximized',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      '--ignore-certificate-errors-spki-list',
      // Additional stealth flags
      '--disable-features=IsolateOrigins,site-per-process',
      '--flag-switches-begin',
      '--flag-switches-end'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  // Create context with saved auth state and realistic fingerprint
  const context = await browser.newContext({
    storageState: authState,
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { longitude: -73.935242, latitude: 40.730610 },
    permissions: ['geolocation'],
    colorScheme: 'light',
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false
  });

  // Inject stealth scripts before any page loads
  await context.addInitScript(STEALTH_SCRIPTS);

  const page = await context.newPage();

  // Additional runtime stealth
  await page.addInitScript(() => {
    // Intercept and modify specific detection methods
    const originalToString = Function.prototype.toString;
    Function.prototype.toString = function() {
      if (this === navigator.permissions.query) {
        return 'function query() { [native code] }';
      }
      return originalToString.call(this);
    };
  });

  // Log console messages
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('DRM') || text.includes('Widevine') || text.includes('PlaybackError') || text.includes('bot') || text.includes('automation')) {
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
  console.log('[stealth-player] Chrome window is now open with stealth mode.');
  console.log('[stealth-player] Press Ctrl+C to close.');

  // Keep the browser open
  await new Promise(() => {});
}

launchPlayer().catch(err => {
  console.error('[stealth-player] Error:', err);
  process.exit(1);
});
