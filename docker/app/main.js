const { app, BrowserWindow, session, components } = require('electron');
const fetch = require('node-fetch');
const path = require('path');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:7070';

// Spoof as regular Chrome browser
const CHROME_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let mainWindow;

// Enable Widevine CDM and make Electron look like regular Chrome
app.commandLine.appendSwitch('no-verify-widevine-cdm');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('disable-site-isolation-trials');

app.whenReady().then(async () => {
  console.log('[dvr-player] Electron ready, waiting for Widevine CDM...');

  // Wait for Widevine CDM to be ready (CastLabs Electron specific)
  try {
    await components.whenReady();
    console.log('[dvr-player] Widevine CDM Status:', components.status());
  } catch (err) {
    console.error('[dvr-player] Widevine CDM failed to load:', err.message);
    console.log('[dvr-player] Continuing anyway - CDM may still work...');
  }

  // Fetch auth from Node.js service
  console.log(`[dvr-player] Fetching auth from ${AUTH_SERVICE_URL}/api/auth-session`);

  let authState;
  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/api/auth-session`);
    if (!response.ok) {
      throw new Error(`Auth service returned ${response.status}: ${await response.text()}`);
    }
    authState = await response.json();
    console.log(`[dvr-player] Got ${authState.cookies?.length || 0} cookies from auth service`);
  } catch (err) {
    console.error('[dvr-player] Failed to fetch auth:', err.message);
    console.log('[dvr-player] Make sure the auth service is running and you have logged in first.');
    console.log('[dvr-player] Run: curl -X POST http://localhost:7070/tve/directv/login -H "Content-Type: application/json" -d @/tmp/login.json');
    app.quit();
    return;
  }

  // Apply cookies to default session
  const ses = session.defaultSession;

  // Set User-Agent to look like regular Chrome
  ses.setUserAgent(CHROME_USER_AGENT);

  for (const cookie of authState.cookies || []) {
    try {
      // Playwright saves cookies in a slightly different format than Electron expects
      // Convert sameSite: Playwright uses "None"/"Lax"/"Strict", Electron uses "no_restriction"/"lax"/"strict"
      let sameSite = 'no_restriction';
      if (cookie.sameSite) {
        const ss = cookie.sameSite.toLowerCase();
        if (ss === 'none') sameSite = 'no_restriction';
        else if (ss === 'lax') sameSite = 'lax';
        else if (ss === 'strict') sameSite = 'strict';
      }

      const electronCookie = {
        url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure || false,
        httpOnly: cookie.httpOnly || false,
        sameSite: sameSite
      };

      // Add expiration if present
      if (cookie.expires && cookie.expires > 0) {
        electronCookie.expirationDate = cookie.expires;
      } else {
        // Set to 7 days from now if no expiration
        electronCookie.expirationDate = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
      }

      await ses.cookies.set(electronCookie);
    } catch (err) {
      console.warn(`[dvr-player] Failed to set cookie ${cookie.name}:`, err.message);
    }
  }

  console.log('[dvr-player] Auth cookies applied to session');

  // Apply localStorage if present (via webContents after page load)
  const localStorageOrigins = authState.origins || [];

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Enable DRM
      plugins: true
    }
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Apply localStorage after page loads
  mainWindow.webContents.on('did-finish-load', async () => {
    const url = mainWindow.webContents.getURL();
    console.log('[dvr-player] Page loaded:', url);

    // Find localStorage for this origin
    for (const origin of localStorageOrigins) {
      if (url.startsWith(origin.origin)) {
        console.log(`[dvr-player] Applying ${origin.localStorage?.length || 0} localStorage items for ${origin.origin}`);
        for (const item of origin.localStorage || []) {
          try {
            await mainWindow.webContents.executeJavaScript(
              `localStorage.setItem(${JSON.stringify(item.name)}, ${JSON.stringify(item.value)})`
            );
          } catch (err) {
            console.warn(`[dvr-player] Failed to set localStorage ${item.name}:`, err.message);
          }
        }
        break;
      }
    }
  });

  // Handle console messages - log all errors and DRM-related messages
  mainWindow.webContents.on('console-message', (event, level, message) => {
    // Level: 0=verbose, 1=info, 2=warning, 3=error
    if (level >= 2 || message.includes('Widevine') || message.includes('DRM') || message.includes('keySystem') || message.includes('EME') || message.includes('license') || message.includes('error') || message.includes('Error')) {
      const levelNames = ['verbose', 'info', 'warning', 'error'];
      console.log(`[dvr-player] [${levelNames[level] || level}] ${message}`);
    }
  });

  // Load DirecTV stream page
  const streamUrl = 'https://stream.directv.com/watchnow';
  console.log('[dvr-player] Loading:', streamUrl);
  mainWindow.loadURL(streamUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    // Re-create window if activated without one
  }
});
