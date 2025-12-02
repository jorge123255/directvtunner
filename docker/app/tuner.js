const { spawn } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const FFmpegCapture = require('./ffmpeg-capture');
const { getChannel, getChannelUrl } = require('./channels');

// Tuner states
const TunerState = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  FREE: 'free',
  TUNING: 'tuning',
  STREAMING: 'streaming',
  ERROR: 'error',
};

class Tuner {
  constructor(id) {
    this.id = id;
    this.displayNum = config.baseDisplayNum + id;
    this.debugPort = config.baseDebugPort + id;
    this.state = TunerState.STOPPED;
    this.currentChannel = null;
    this.clients = 0;
    this.lastActivity = Date.now();

    // Processes
    this.xvfbProcess = null;
    this.chromeProcess = null;
    this.browser = null;
    this.page = null;
    this.ffmpeg = null;

    // Paths
    this.outputDir = path.join(config.hlsDir, `tuner${id}`);
    // Put tuner profiles in a separate directory to avoid recursive copy issues
    this.chromeProfileDir = path.join(path.dirname(config.chromeProfile), `chrome-tuner-profiles`, `tuner${id}`);
  }

  async start() {
    if (this.state !== TunerState.STOPPED) {
      console.log(`[tuner-${this.id}] Already started (state: ${this.state})`);
      return;
    }

    this.state = TunerState.STARTING;
    console.log(`[tuner-${this.id}] Starting...`);

    try {
      // In Docker, Chrome and Xvfb are managed by supervisor
      // We just need to connect to the existing Chrome instance
      if (config.getPlatform() === 'linux') {
        console.log(`[tuner-${this.id}] Docker mode - connecting to existing Chrome on port ${this.debugPort}`);
        // Wait for Chrome to be ready (managed by supervisor)
        await this.waitForChrome();
      } else {
        // On macOS, start our own Xvfb and Chrome
        await this.startXvfb();
        await this.startChrome();
      }

      // Connect Playwright
      await this.connectPlaywright();

      // Create FFmpeg capture instance
      this.ffmpeg = new FFmpegCapture(this.id, this.outputDir);

      this.state = TunerState.FREE;
      console.log(`[tuner-${this.id}] Ready (free)`);
    } catch (err) {
      console.error(`[tuner-${this.id}] Failed to start:`, err.message);
      this.state = TunerState.ERROR;
      await this.stop();
      throw err;
    }
  }

  async startXvfb() {
    console.log(`[tuner-${this.id}] Starting Xvfb on display :${this.displayNum}`);

    this.xvfbProcess = spawn('Xvfb', [
      `:${this.displayNum}`,
      '-screen', '0', `${config.resolution.width}x${config.resolution.height}x24`,
    ], {
      stdio: 'ignore',
      detached: true,
    });

    this.xvfbProcess.on('error', (err) => {
      console.error(`[tuner-${this.id}] Xvfb error:`, err.message);
    });

    // Wait for Xvfb to start
    await new Promise(r => setTimeout(r, 1000));
  }

  async startChrome() {
    console.log(`[tuner-${this.id}] Starting Chrome on port ${this.debugPort}`);

    // Ensure parent directory exists
    const profileParent = path.dirname(this.chromeProfileDir);
    if (!fs.existsSync(profileParent)) {
      fs.mkdirSync(profileParent, { recursive: true });
    }

    // Copy base profile if this tuner's profile doesn't exist
    if (!fs.existsSync(this.chromeProfileDir)) {
      if (fs.existsSync(config.chromeProfile) && fs.statSync(config.chromeProfile).isDirectory()) {
        // Copy the base profile
        fs.cpSync(config.chromeProfile, this.chromeProfileDir, { recursive: true });
        console.log(`[tuner-${this.id}] Copied Chrome profile from ${config.chromeProfile}`);
      } else {
        fs.mkdirSync(this.chromeProfileDir, { recursive: true });
        console.log(`[tuner-${this.id}] Created new Chrome profile directory`);
      }
    }

    const args = [
      `--remote-debugging-port=${this.debugPort}`,
      `--user-data-dir=${this.chromeProfileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      `--window-size=${config.resolution.width},${config.resolution.height}`,
    ];

    // On Linux, set DISPLAY environment variable
    const env = { ...process.env };
    if (config.getPlatform() === 'linux') {
      env.DISPLAY = `:${this.displayNum}`;
    }

    this.chromeProcess = spawn(config.chromePath, args, {
      env,
      stdio: 'ignore',
      detached: true,
    });

    this.chromeProcess.on('error', (err) => {
      console.error(`[tuner-${this.id}] Chrome error:`, err.message);
    });

    this.chromeProcess.on('close', (code) => {
      console.log(`[tuner-${this.id}] Chrome exited with code ${code}`);
    });

    // Wait for Chrome to be ready
    await this.waitForChrome();
  }

  async waitForChrome() {
    const maxWait = 30000;
    const checkInterval = 500;
    let waited = 0;

    while (waited < maxWait) {
      try {
        const response = await fetch(`http://localhost:${this.debugPort}/json/version`);
        if (response.ok) {
          console.log(`[tuner-${this.id}] Chrome ready after ${waited}ms`);
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, checkInterval));
      waited += checkInterval;
    }

    throw new Error(`Chrome did not start within ${maxWait}ms`);
  }

  async connectPlaywright() {
    console.log(`[tuner-${this.id}] Connecting Playwright to Chrome...`);

    this.browser = await chromium.connectOverCDP(`http://localhost:${this.debugPort}`);

    // Get existing context or create new one
    const contexts = this.browser.contexts();
    const context = contexts[0] || await this.browser.newContext();

    // Get existing page or create new one
    const pages = context.pages();
    this.page = pages[0] || await context.newPage();

    console.log(`[tuner-${this.id}] Playwright connected`);

    // Set up Chicago locals interception
    await this.setupChicagoInterception();
  }

  async setupChicagoInterception() {
    if (this.chicagoInterceptorSetUp) return;

    const { CHICAGO_CLIENT_CONTEXT, CHICAGO_LOCALS } = require('./chicago-locals');

    console.log(`[tuner-${this.id}] Setting up Chicago locals API interception...`);

    // Debug: Log all requests to find DRM license URL
    this.page.on('request', request => {
      const url = request.url();
      if (url.includes('drm') || url.includes('license') || url.includes('widevine') ||
          url.includes('playback') || url.includes('dtvcdn')) {
        console.log(`[tuner-${this.id}] [REQUEST] ${request.method()} ${url}`);
      }
    });

    this.page.on('response', response => {
      const url = response.url();
      if (url.includes('drm') || url.includes('license') || url.includes('widevine') ||
          url.includes('playback') || url.includes('dtvcdn')) {
        console.log(`[tuner-${this.id}] [RESPONSE] ${response.status()} ${url}`);
      }
    });

    // Intercept allchannels API response and modify it
    await this.page.route('**/api.cld.dtvce.com/**/allchannels**', async (route) => {
      const request = route.request();

      // Add Chicago DMA header
      const headers = {
        ...request.headers(),
        'x-client-context': CHICAGO_CLIENT_CONTEXT
      };

      try {
        // Fetch with modified headers
        const response = await route.fetch({ headers });
        const json = await response.json();

        // Inject Chicago locals
        if (json.channelInfoList) {
          json.channelInfoList = this.injectChicagoLocals(json.channelInfoList);
        }

        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body: JSON.stringify(json)
        });

        console.log(`[tuner-${this.id}] Injected Chicago locals into channel list`);
      } catch (err) {
        console.log(`[tuner-${this.id}] Interception fetch error: ${err.message}`);
        // Continue with original request if interception fails
        await route.continue();
      }
    });

    // Intercept Widevine DRM license requests and add Chicago location headers
    await this.page.route('**/dtv-drm.prod.dtvcdn.com/**', async (route) => {
      const request = route.request();
      console.log(`[tuner-${this.id}] Intercepting DRM license request: ${request.url()}`);

      // Add Chicago geo headers to bypass location check
      const headers = {
        ...request.headers(),
        'x-dtv-edgescape': 'IL:CICERO:60804',  // Illinois, Cicero zip code (Chicago area)
        'x-client-context': CHICAGO_CLIENT_CONTEXT,
        'x-forwarded-for': '73.159.0.1',  // Chicago area IP range
      };

      try {
        const response = await route.fetch({ headers });
        const body = await response.body();

        console.log(`[tuner-${this.id}] DRM license response: ${response.status()}`);

        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body: body
        });
      } catch (err) {
        console.log(`[tuner-${this.id}] DRM interception error: ${err.message}`);
        await route.continue();
      }
    });

    // Also intercept playback API requests
    await this.page.route('**/api.cld.dtvce.com/**/playback/**', async (route) => {
      const request = route.request();
      console.log(`[tuner-${this.id}] Intercepting playback API: ${request.url()}`);

      const headers = {
        ...request.headers(),
        'x-dtv-edgescape': 'IL:CICERO:60804',
        'x-client-context': CHICAGO_CLIENT_CONTEXT,
      };

      try {
        const response = await route.fetch({ headers });
        const body = await response.body();

        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body: body
        });
      } catch (err) {
        console.log(`[tuner-${this.id}] Playback API interception error: ${err.message}`);
        await route.continue();
      }
    });

    this.chicagoInterceptorSetUp = true;
    console.log(`[tuner-${this.id}] Chicago locals interception ready (including DRM license)`);
  }

  injectChicagoLocals(channelList) {
    const { CHICAGO_LOCALS } = require('./chicago-locals');

    // Build lookup for NY -> Chicago replacement
    const replacementMap = {};
    for (const ch of CHICAGO_LOCALS) {
      for (const nyCall of ch.replacesNY || []) {
        replacementMap[nyCall.toUpperCase()] = ch;
      }
    }

    let replaced = 0;
    const result = channelList.map(channel => {
      const replacement = replacementMap[channel.callSign?.toUpperCase()];
      if (replacement) {
        console.log(`[tuner-${this.id}] Replacing ${channel.callSign} -> ${replacement.callSign} (ccid: ${replacement.ccid})`);
        replaced++;
        return {
          ...channel,
          callSign: replacement.callSign,
          ccid: replacement.ccid,
          channelName: replacement.channelName
        };
      }
      return channel;
    });

    console.log(`[tuner-${this.id}] Replaced ${replaced} NY locals with Chicago locals`);
    return result;
  }

  /**
   * Check if a channel is a Chicago local that needs special handling
   */
  isChicagoLocal(channel) {
    const chicagoIds = ['wbbm', 'wmaq', 'wls', 'wfld'];
    return chicagoIds.includes(channel.id?.toLowerCase()) && channel.ccid;
  }

  async tuneToChannel(channelId) {
    if (!this.page) {
      throw new Error('Tuner not started');
    }

    const channel = getChannel(channelId);
    if (!channel) {
      throw new Error(`Unknown channel: ${channelId}`);
    }

    console.log(`[tuner-${this.id}] Tuning to ${channel.name} (ch ${channel.number})...`);
    this.state = TunerState.TUNING;
    this.currentChannel = channelId;
    this.lastActivity = Date.now();

    try {
      // Stop current FFmpeg if running
      if (this.ffmpeg && this.ffmpeg.isRunning) {
        this.ffmpeg.stop();
        await new Promise(r => setTimeout(r, 500));  // Reduced from 1000ms
      }

      // Chicago locals now go through normal guide flow
      // The API interception replaces NY locals with Chicago CCIDs in the channel list
      // so when we click channel 2 (CBS) it loads WBBM instead of WCBS
      if (this.isChicagoLocal(channel)) {
        console.log(`[tuner-${this.id}] Chicago local channel: ${channel.name} - using guide flow with API interception`);
      }

      // Navigate to guide page to select channel
      const guideUrl = 'https://stream.directv.com/guide';
      const currentUrl = this.page.url();

      // Only navigate if not already on DirecTV
      if (!currentUrl.includes('stream.directv.com')) {
        console.log(`[tuner-${this.id}] Navigating to DirecTV guide...`);
        await this.page.goto(guideUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        // Wait for guide grid to appear instead of fixed timeout
        await this.waitForGuideReady();
      } else if (!currentUrl.includes('/guide')) {
        // On DirecTV but not on guide - navigate to guide
        console.log(`[tuner-${this.id}] Navigating to guide page...`);
        await this.page.goto(guideUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await this.waitForGuideReady();
      } else {
        console.log(`[tuner-${this.id}] Already on guide page`);
        // Brief wait for any overlays to clear
        await new Promise(r => setTimeout(r, 500));
      }

      // Try to find and click the channel in the guide
      console.log(`[tuner-${this.id}] Searching for channel ${channel.name} (${channel.number})...`);

      // DirecTV guide uses aria-label like "view A3 New York 02 WCBS CBS"
      // Format: "view [number] [location] [callsign] [name]"
      // We'll search for the channel name or number in the aria-label using case-insensitive JS matching

      // Use JavaScript evaluation for case-insensitive, flexible matching
      // Priority: 1) channel number, 2) exact name/searchTerms, 3) first word (last resort)
      let clicked = await this.page.evaluate((channelInfo) => {
        const { name, number, searchTerms } = channelInfo;
        const allLinks = Array.from(document.querySelectorAll('[role="link"]'));

        // Filter to only channel links
        const channelLinks = allLinks.filter(link => {
          const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
          return ariaLabel.startsWith('view');
        });

        // Priority 1: Try searchTerms first (most specific for Chicago locals like WBBM, WMAQ)
        if (searchTerms && searchTerms.length > 0) {
          for (const term of searchTerms) {
            const termLower = term.toLowerCase();
            for (const link of channelLinks) {
              const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
              if (ariaLabel.includes(termLower)) {
                link.click();
                return { clicked: true, method: `searchTerm "${termLower}" in "${ariaLabel}"` };
              }
            }
          }
        }

        // Priority 2: Try to match by channel number with leading zero (for local channels like 02, 05)
        if (number) {
          const paddedNumber = number.padStart(2, '0');
          const paddedPattern = ` ${paddedNumber} `;
          for (const link of channelLinks) {
            const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
            if (ariaLabel.includes(paddedPattern)) {
              link.click();
              return { clicked: true, method: `padded channel number ${paddedNumber} in "${ariaLabel}"` };
            }
          }
          // Also try non-padded but only if > 2 digits (to avoid matching "SHOWTIME 2")
          if (number.length >= 3 || parseInt(number) >= 100) {
            const numberPattern = ` ${number} `;
            for (const link of channelLinks) {
              const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
              if (ariaLabel.includes(numberPattern)) {
                link.click();
                return { clicked: true, method: `channel number ${number} in "${ariaLabel}"` };
              }
            }
          }
        }

        // Priority 3: Try exact name match
        const exactName = name.toLowerCase();
        for (const link of channelLinks) {
          const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
          if (ariaLabel.includes(exactName)) {
            link.click();
            return { clicked: true, method: `exact name "${exactName}" in "${ariaLabel}"` };
          }
        }

        // Priority 4 (last resort): Try first word of name
        // But ONLY if first word is unique enough (longer than 3 chars and not common)
        const firstWord = name.split(' ')[0].toLowerCase();
        const commonWords = ['the', 'fox', 'nbc', 'cbs', 'abc', 'cnn'];  // Skip common network prefixes
        if (firstWord.length > 3 && !commonWords.includes(firstWord)) {
          for (const link of channelLinks) {
            const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
            if (ariaLabel.includes(firstWord)) {
              link.click();
              return { clicked: true, method: `first word "${firstWord}" in "${ariaLabel}"` };
            }
          }
        }

        return { clicked: false };
      }, { name: channel.name, number: channel.number, searchTerms: channel.searchTerms || [] });

      if (clicked.clicked) {
        console.log(`[tuner-${this.id}] Found channel: ${clicked.method}`);
      } else {
        // Try scrolling down the guide to find the channel
        console.log(`[tuner-${this.id}] Channel not visible, trying to scroll...`);

        // Scroll down the page a few times looking for the channel
        for (let i = 0; i < 15; i++) {
          await this.page.keyboard.press('PageDown');
          await new Promise(r => setTimeout(r, 400));

          const found = await this.page.evaluate((channelInfo) => {
            const { name, number, searchTerms } = channelInfo;
            const allLinks = Array.from(document.querySelectorAll('[role="link"]'));
            const channelLinks = allLinks.filter(link => {
              const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
              return ariaLabel.startsWith('view');
            });

            // Priority 1: Channel number
            if (number) {
              const numberPattern = ` ${number} `;
              for (const link of channelLinks) {
                const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
                if (ariaLabel.includes(numberPattern)) {
                  link.click();
                  return { clicked: true, method: `scroll: channel ${number}` };
                }
              }
            }

            // Priority 2: Exact name
            const exactName = name.toLowerCase();
            for (const link of channelLinks) {
              const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
              if (ariaLabel.includes(exactName)) {
                link.click();
                return { clicked: true, method: `scroll: exact name "${exactName}"` };
              }
            }

            // Priority 3: searchTerms
            if (searchTerms && searchTerms.length > 0) {
              for (const term of searchTerms) {
                const termLower = term.toLowerCase();
                for (const link of channelLinks) {
                  const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
                  if (ariaLabel.includes(termLower)) {
                    link.click();
                    return { clicked: true, method: `scroll: searchTerm "${termLower}"` };
                  }
                }
              }
            }

            return { clicked: false };
          }, { name: channel.name, number: channel.number, searchTerms: channel.searchTerms || [] });

          if (found.clicked) {
            console.log(`[tuner-${this.id}] Found channel after scrolling: ${found.method}`);
            clicked = found;
            break;
          }
        }
      }

      if (!clicked.clicked) {
        console.log(`[tuner-${this.id}] Could not find channel ${channel.name} in guide`);
      }

      // Wait for play button to appear and click it (smart wait instead of fixed delay)
      console.log(`[tuner-${this.id}] Looking for play button...`);
      const playClicked = await this.waitForAndClickPlayButton();

      if (playClicked) {
        console.log(`[tuner-${this.id}] Play button clicked!`);
      } else {
        console.log(`[tuner-${this.id}] Could not find play button`);
      }

      // Wait for video element to be playing
      console.log(`[tuner-${this.id}] Waiting for video to start playing...`);
      const videoReady = await this.waitForVideoPlaying();

      if (!videoReady) {
        console.log(`[tuner-${this.id}] Video not detected, proceeding anyway after timeout`);
      }

      // Try to maximize video
      await this.maximizeVideo();

      // Start FFmpeg capture
      await this.ffmpeg.start(this.displayNum);

      this.state = TunerState.STREAMING;
      console.log(`[tuner-${this.id}] Now streaming ${channel.name}`);

      return true;
    } catch (err) {
      console.error(`[tuner-${this.id}] Failed to tune to ${channelId}:`, err.message);
      this.state = TunerState.ERROR;
      this.currentChannel = null;
      throw err;
    }
  }

  async waitForAndClickPlayButton() {
    const maxWait = 8000;  // 8 seconds max for play button to appear
    const checkInterval = 300;
    let waited = 0;

    while (waited < maxWait) {
      try {
        // Try to find and click play button in the channel info modal
        const result = await this.page.evaluate(() => {
          // Method 1: Look for the play button in the "On Now" section of the modal
          // The play button is typically a circular button with play icon next to show info

          // Find buttons/divs with role="button" that might be play buttons
          const buttons = document.querySelectorAll('[role="button"]');
          for (const btn of buttons) {
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            // Look for play-related aria labels
            if (ariaLabel.includes('play') || ariaLabel.includes('watch') || ariaLabel.includes('tune')) {
              btn.click();
              return { clicked: true, method: 'aria-label: ' + ariaLabel };
            }
          }

          // Method 2: Look for SVG play icon (triangle in circle)
          const svgs = document.querySelectorAll('svg');
          for (const svg of svgs) {
            const parent = svg.closest('[role="button"], button, [onclick], [class*="play"]');
            if (parent) {
              // Check if this SVG might be a play icon (has path elements typical of play)
              const paths = svg.querySelectorAll('path, polygon');
              if (paths.length > 0) {
                const svgHtml = svg.outerHTML.toLowerCase();
                if (svgHtml.includes('play') || svgHtml.includes('polygon')) {
                  parent.click();
                  return { clicked: true, method: 'svg-play-icon' };
                }
              }
            }
          }

          // Method 3: Look for the "On Now" row which typically has the play button
          // Find elements containing "On Now" text
          const onNowElements = Array.from(document.querySelectorAll('*')).filter(el =>
            el.textContent && el.textContent.trim() === 'On Now'
          );
          for (const onNow of onNowElements) {
            // Look for clickable elements near "On Now"
            const parent = onNow.closest('[class*="row"], [class*="item"], div');
            if (parent) {
              const clickable = parent.querySelector('[role="button"], button, [class*="play"]');
              if (clickable) {
                clickable.click();
                return { clicked: true, method: 'on-now-row' };
              }
            }
          }

          // Method 4: Click on the first program row in the modal (contains play button)
          const modal = document.querySelector('[class*="modal"], [class*="dialog"], [class*="panel"], [role="dialog"]');
          if (modal) {
            // Look for the first clickable program entry
            const programRows = modal.querySelectorAll('[role="button"], [role="link"]');
            for (const row of programRows) {
              const text = row.textContent || '';
              // Skip if it's an X/close button
              if (text.includes('×') || text.length < 3) continue;
              // Click on program rows that have time info (like "5:00 - 6:00p")
              if (text.match(/\d+:\d+/) || text.includes('On Now')) {
                row.click();
                return { clicked: true, method: 'program-row' };
              }
            }
          }

          // Method 5: Old fallback - look for mt_play in style
          const allDivs = document.querySelectorAll('div');
          for (const div of allDivs) {
            const style = div.getAttribute('style') || '';
            if (style.includes('mt_play') || style.includes('play_stroke')) {
              div.click();
              return { clicked: true, method: 'mt_play-style' };
            }
          }

          return { clicked: false };
        });

        if (result.clicked) {
          console.log(`[tuner-${this.id}] Play button found and clicked after ${waited}ms (method: ${result.method})`);
          return true;
        }
      } catch (e) {
        console.log(`[tuner-${this.id}] Play button search error: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, checkInterval));
      waited += checkInterval;
    }

    console.log(`[tuner-${this.id}] Play button not found after ${maxWait}ms`);
    return false;
  }

  async waitForGuideReady() {
    const maxWait = 10000;  // 10 seconds max
    const checkInterval = 300;
    let waited = 0;

    console.log(`[tuner-${this.id}] Waiting for guide grid to load...`);

    while (waited < maxWait) {
      try {
        // Check if any channel links are visible in the guide
        const hasChannels = await this.page.evaluate(() => {
          const links = document.querySelectorAll('[role="link"][aria-label*="view"]');
          return links.length > 0;
        });

        if (hasChannels) {
          console.log(`[tuner-${this.id}] Guide ready after ${waited}ms`);
          return true;
        }
      } catch (e) {
        // Page might still be loading
      }

      await new Promise(r => setTimeout(r, checkInterval));
      waited += checkInterval;
    }

    console.log(`[tuner-${this.id}] Guide wait timed out after ${maxWait}ms, proceeding anyway`);
    return false;
  }

  async waitForVideoPlaying() {
    const maxWait = 15000;  // 15 seconds max
    const checkInterval = 500;
    let waited = 0;
    let playAttempted = false;

    while (waited < maxWait) {
      try {
        const videoState = await this.page.evaluate(() => {
          const video = document.querySelector('video');
          if (!video) return { found: false };
          return {
            found: true,
            readyState: video.readyState,
            paused: video.paused,
            currentTime: video.currentTime,
            duration: video.duration,
            playing: !video.paused && video.readyState >= 3 && video.currentTime > 0,
          };
        });

        if (videoState.playing) {
          console.log(`[tuner-${this.id}] Video playing! (readyState: ${videoState.readyState}, currentTime: ${videoState.currentTime.toFixed(2)}s)`);
          return true;
        }

        // If video is ready but paused, try to play it
        if (videoState.found && videoState.readyState >= 3 && videoState.paused && !playAttempted) {
          console.log(`[tuner-${this.id}] Video ready but paused, attempting to play...`);
          playAttempted = true;
          await this.page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
              video.muted = false;
              video.play().catch(() => {});
            }
          });
        }

        if (videoState.found) {
          // Consider video "playing" if readyState is 4 (enough data) even if paused
          // because DirecTV might show paused but still be streaming
          if (videoState.readyState >= 4) {
            console.log(`[tuner-${this.id}] Video ready (readyState: ${videoState.readyState}), proceeding...`);
            return true;
          }
          console.log(`[tuner-${this.id}] Video found but not ready yet (readyState: ${videoState.readyState}, paused: ${videoState.paused}, time: ${videoState.currentTime})`);
        }
      } catch (e) {
        // Page might be navigating
      }

      await new Promise(r => setTimeout(r, checkInterval));
      waited += checkInterval;
    }

    console.log(`[tuner-${this.id}] Video detection timed out after ${maxWait}ms`);
    return false;
  }

  async maximizeVideo() {
    try {
      console.log(`[tuner-${this.id}] Maximizing video and unmuting...`);

      // First, unmute the video by clicking the volume button if muted
      try {
        const unmuteBtn = await this.page.$('[aria-label="unmute"]');
        if (unmuteBtn) {
          console.log(`[tuner-${this.id}] Found unmute button, clicking...`);
          await unmuteBtn.click();
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        console.log(`[tuner-${this.id}] Could not unmute: ${e.message}`);
      }

      // Click the fullscreen button on the DirecTV player
      // Use short timeout and force to avoid long retries
      try {
        const fullscreenBtn = await this.page.$('[aria-label="full screen"]');
        if (fullscreenBtn) {
          console.log(`[tuner-${this.id}] Found fullscreen button, clicking...`);
          await fullscreenBtn.click({ timeout: 3000, force: true });
          await new Promise(r => setTimeout(r, 500));
        } else {
          // Try alternate selector
          const resizeBtn = await this.page.$('.player-button__resize');
          if (resizeBtn) {
            console.log(`[tuner-${this.id}] Found resize button, clicking...`);
            await resizeBtn.click({ timeout: 3000, force: true });
            await new Promise(r => setTimeout(r, 500));
          }
        }
      } catch (e) {
        // Fullscreen click failed - not critical, CSS injection will handle it
        console.log(`[tuner-${this.id}] Fullscreen click skipped (video CSS will handle it)`);
      }

      // Hide the controls overlay and any browser chrome via CSS injection
      await this.page.evaluate(() => {
        // Hide the DirecTV player controls
        const style = document.createElement('style');
        style.textContent = `
          .controls__top, .controls__bottom, .controls__center,
          .controls__go-previous, .content-info, .video-player-seekbar__wrapper,
          [class*="controls"] {
            opacity: 0 !important;
            pointer-events: none !important;
          }
          video {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 9999 !important;
            object-fit: contain !important;
          }
        `;
        document.head.appendChild(style);

        // Also try to unmute via the video element directly
        const video = document.querySelector('video');
        if (video) {
          video.muted = false;
          video.volume = 1.0;
        }
      });

      // Press F11 for browser fullscreen (works in kiosk mode)
      await this.page.keyboard.press('F11');

      console.log(`[tuner-${this.id}] Video maximized`);
    } catch (e) {
      console.log(`[tuner-${this.id}] Maximize error: ${e.message}`);
    }
  }

  async stop() {
    console.log(`[tuner-${this.id}] Stopping...`);

    // Stop FFmpeg
    if (this.ffmpeg) {
      this.ffmpeg.stop();
      this.ffmpeg = null;
    }

    // Disconnect Playwright (but don't close browser in Docker mode)
    if (this.browser) {
      if (config.getPlatform() === 'linux') {
        // In Docker, just disconnect - don't close the browser
        await this.browser.close().catch(() => {});
      } else {
        await this.browser.close().catch(() => {});
      }
      this.browser = null;
      this.page = null;
    }

    // Only kill Chrome/Xvfb if we started them (non-Docker mode)
    if (config.getPlatform() !== 'linux') {
      // Kill Chrome
      if (this.chromeProcess) {
        this.chromeProcess.kill('SIGTERM');
        this.chromeProcess = null;
      }

      // Kill Xvfb
      if (this.xvfbProcess) {
        this.xvfbProcess.kill('SIGTERM');
        this.xvfbProcess = null;
      }
    }

    this.state = TunerState.STOPPED;
    this.currentChannel = null;
    this.clients = 0;

    console.log(`[tuner-${this.id}] Stopped`);
  }

  addClient() {
    this.clients++;
    this.lastActivity = Date.now();
    console.log(`[tuner-${this.id}] Client added (total: ${this.clients})`);
  }

  removeClient() {
    this.clients = Math.max(0, this.clients - 1);
    this.lastActivity = Date.now();
    console.log(`[tuner-${this.id}] Client removed (total: ${this.clients})`);
  }

  isIdle() {
    return this.clients === 0 && (Date.now() - this.lastActivity) > config.idleTimeout;
  }

  getStatus() {
    return {
      id: this.id,
      state: this.state,
      channel: this.currentChannel,
      clients: this.clients,
      lastActivity: this.lastActivity,
      debugPort: this.debugPort,
      stream: this.ffmpeg ? this.ffmpeg.getStats() : null,
    };
  }

  getPlaylistPath() {
    return this.ffmpeg ? this.ffmpeg.getPlaylistPath() : null;
  }

  getSegmentPath(filename) {
    return this.ffmpeg ? this.ffmpeg.getSegmentPath(filename) : null;
  }

  // Add a client to receive MPEG-TS stream
  pipeToClient(res) {
    if (this.ffmpeg) {
      this.ffmpeg.addClient(res);
      return true;
    }
    return false;
  }

  // Check if streaming is active
  isStreaming() {
    return this.ffmpeg && this.ffmpeg.isRunning;
  }

  /**
   * Tune to a Chicago local channel using direct watch URL
   * This bypasses the guide and navigates directly to the channel stream
   */
  async tuneToChicagoChannel(channel) {
    const watchUrl = `https://stream.directv.com/watch/channel/${channel.ccid}`;
    console.log(`[tuner-${this.id}] Navigating to Chicago watch URL: ${watchUrl}`);

    try {
      // Navigate directly to the watch URL
      await this.page.goto(watchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for video to start playing
      console.log(`[tuner-${this.id}] Waiting for Chicago channel video to load...`);
      const videoReady = await this.waitForVideoPlaying();

      if (!videoReady) {
        // Check if there's a geo-restriction error message
        const errorMessage = await this.page.evaluate(() => {
          // Look for common error messages
          const errorSelectors = [
            '[class*="error"]',
            '[class*="message"]',
            '[role="alert"]',
            '.toast-message',
          ];
          for (const selector of errorSelectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent) {
              const text = el.textContent.toLowerCase();
              if (text.includes('not available') || text.includes('can\'t be streamed') ||
                  text.includes('location') || text.includes('geo')) {
                return el.textContent.trim();
              }
            }
          }
          // Also check the entire body for these phrases
          const bodyText = document.body?.innerText || '';
          if (bodyText.toLowerCase().includes('can\'t be streamed here')) {
            return 'This program can\'t be streamed here';
          }
          return null;
        });

        if (errorMessage) {
          console.log(`[tuner-${this.id}] Geo-restriction detected: ${errorMessage}`);
          throw new Error(`Chicago channel blocked: ${errorMessage}`);
        }

        console.log(`[tuner-${this.id}] Video not detected, proceeding anyway`);
      }

      // Maximize video
      await this.maximizeVideo();

      // Start FFmpeg capture
      await this.ffmpeg.start(this.displayNum);

      this.state = TunerState.STREAMING;
      console.log(`[tuner-${this.id}] Now streaming Chicago channel: ${channel.name}`);

      return true;
    } catch (err) {
      console.error(`[tuner-${this.id}] Failed to tune to Chicago channel:`, err.message);
      this.state = TunerState.ERROR;
      this.currentChannel = null;
      throw err;
    }
  }
}

module.exports = { Tuner, TunerState };
