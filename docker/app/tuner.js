const { spawn } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const FFmpegCapture = require('./ffmpeg-capture');
const { getChannel, getChannelUrl } = require('./channels');
const directvEpg = require('./directv-epg');

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

    // CDP connection health tracking
    this.lastConnectionCheck = Date.now();
    this.connectionHealthy = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

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

      // Set up black screen detection callback for auto-retune
      this.ffmpeg.setBlackScreenCallback(async (tunerId) => {
        console.log(`[tuner-${tunerId}] Black screen callback triggered, attempting auto-retune...`);
        await this.handleBlackScreen();
      });

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

    // Mark connection as healthy
    this.connectionHealthy = true;
    this.lastConnectionCheck = Date.now();
    this.reconnectAttempts = 0;

    // Set up disconnect handler
    this.browser.on('disconnected', () => {
      console.log(`[tuner-${this.id}] Browser disconnected! Will attempt reconnect on next operation.`);
      this.connectionHealthy = false;
      this.browser = null;
      this.page = null;
    });

    console.log(`[tuner-${this.id}] Playwright connected`);
  }

  // Check if the CDP connection is still healthy
  async checkConnectionHealth() {
    // Don't check too frequently (at most every 5 seconds)
    if (Date.now() - this.lastConnectionCheck < 5000) {
      return this.connectionHealthy;
    }

    this.lastConnectionCheck = Date.now();

    try {
      // Quick health check - try to get the page URL
      if (!this.browser || !this.page) {
        this.connectionHealthy = false;
        return false;
      }

      // Try a simple operation that will fail if connection is dead
      await this.page.evaluate(() => true);
      this.connectionHealthy = true;
      return true;
    } catch (err) {
      console.log(`[tuner-${this.id}] Connection health check failed: ${err.message}`);
      this.connectionHealthy = false;
      return false;
    }
  }

  // Attempt to reconnect to Chrome
  async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[tuner-${this.id}] Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      this.state = TunerState.ERROR;
      return false;
    }

    this.reconnectAttempts++;
    console.log(`[tuner-${this.id}] Attempting reconnect (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    try {
      // Clean up old browser connection if exists
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (e) {
          // Ignore - browser might already be dead
        }
        this.browser = null;
        this.page = null;
      }

      // Wait for Chrome to be available
      await this.waitForChrome();

      // Reconnect Playwright
      await this.connectPlaywright();

      console.log(`[tuner-${this.id}] Reconnected successfully!`);

      // Reset state to FREE if we were in error
      if (this.state === TunerState.ERROR) {
        this.state = TunerState.FREE;
        this.currentChannel = null;
      }

      return true;
    } catch (err) {
      console.error(`[tuner-${this.id}] Reconnect attempt ${this.reconnectAttempts} failed: ${err.message}`);

      // Wait before next attempt (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`[tuner-${this.id}] Waiting ${waitTime}ms before next reconnect attempt...`);
      await new Promise(r => setTimeout(r, waitTime));

      return false;
    }
  }

  // Ensure connection is healthy before operations, reconnect if needed
  async ensureConnection() {
    const healthy = await this.checkConnectionHealth();

    if (!healthy) {
      console.log(`[tuner-${this.id}] Connection unhealthy, attempting reconnect...`);
      const reconnected = await this.reconnect();

      if (!reconnected) {
        throw new Error('Failed to establish connection to Chrome');
      }
    }

    return true;
  }

  async tuneToChannel(channelId) {
    // Ensure CDP connection is healthy before tuning
    try {
      await this.ensureConnection();
    } catch (err) {
      console.error(`[tuner-${this.id}] Cannot tune - connection failed: ${err.message}`);
      this.state = TunerState.ERROR;
      throw err;
    }

    if (!this.page) {
      throw new Error('Tuner not started');
    }

    let channel = getChannel(channelId);
    if (!channel) {
      // Try EPG data for dynamically discovered channels (like locals)
      channel = directvEpg.getChannelByNumber(channelId);
    }
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

        // Priority 1: Try searchTerms first (most specific for channels with alternative names)
        if (searchTerms && searchTerms.length > 0) {
          for (const term of searchTerms) {
            const termLower = term.toLowerCase();
            for (const link of channelLinks) {
              const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
              if (ariaLabel.includes(termLower)) {
                link.scrollIntoView({ behavior: 'instant', block: 'center' });
                link.focus();
                link.click();
                link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
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
              link.scrollIntoView({ behavior: 'instant', block: 'center' });
              link.focus();
              link.click();
              link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
              return { clicked: true, method: `padded channel number ${paddedNumber} in "${ariaLabel}"` };
            }
          }
          // Also try non-padded but only if > 2 digits (to avoid matching "SHOWTIME 2")
          if (number.length >= 3 || parseInt(number) >= 100) {
            const numberPattern = ` ${number} `;
            for (const link of channelLinks) {
              const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
              if (ariaLabel.includes(numberPattern)) {
                link.scrollIntoView({ behavior: 'instant', block: 'center' });
                link.focus();
                link.click();
                link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                return { clicked: true, method: `channel number ${number} in "${ariaLabel}"` };
              }
            }
          }
        }

        // Priority 3: Try exact name match - check if aria-label ends with the name
        // or has the name as a word (not substring of another word)
        const exactName = name.toLowerCase();
        for (const link of channelLinks) {
          const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
          // Check if name appears at end of aria-label OR as whole word with space before it
          if (ariaLabel.endsWith(exactName) || ariaLabel.includes(' ' + exactName + ' ') || ariaLabel.includes(' ' + exactName)) {
            link.scrollIntoView({ behavior: 'instant', block: 'center' });
            link.focus();
            link.click();
            link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            return { clicked: true, method: `exact name "${exactName}" in "${ariaLabel}"` };
          }
        }

        // Priority 4 (last resort): Try first word of name
        // But ONLY if first word is unique enough (3+ chars and not common)
        const firstWord = name.split(' ')[0].toLowerCase();
        const commonWords = ['the', 'fox', 'nbc', 'cbs', 'abc', 'cnn', 'hbo', 'tbs', 'tnt', 'usa', 'amc', 'bet'];  // Skip common network prefixes
        if (firstWord.length >= 3 && !commonWords.includes(firstWord)) {
          for (const link of channelLinks) {
            const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
            if (ariaLabel.includes(firstWord)) {
              link.scrollIntoView({ behavior: 'instant', block: 'center' });
              link.focus();
              link.click();
              link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
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
                  link.scrollIntoView({ behavior: 'instant', block: 'center' });
                  link.focus();
                  link.click();
                  link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                  return { clicked: true, method: `scroll: channel ${number}` };
                }
              }
            }

            // Priority 2: Exact name - check if aria-label ends with name or has it as a whole word
            const exactName = name.toLowerCase();
            for (const link of channelLinks) {
              const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
              if (ariaLabel.endsWith(exactName) || ariaLabel.includes(' ' + exactName + ' ') || ariaLabel.includes(' ' + exactName)) {
                link.scrollIntoView({ behavior: 'instant', block: 'center' });
                link.focus();
                link.click();
                link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
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
                    link.scrollIntoView({ behavior: 'instant', block: 'center' });
                    link.focus();
                    link.click();
                    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
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

      // Check for "No upcoming airings" modal before looking for play button
      const noAirings = await this.checkNoUpcomingAirings();
      if (noAirings) {
        console.log(`[tuner-${this.id}] Channel ${channel.name} has no upcoming airings - playing placeholder`);
        // Close the modal first
        await this.closeNoAiringsModal();
        // Start placeholder video stream
        await this.startPlaceholderStream(channel.name);
        this.state = TunerState.STREAMING;
        console.log(`[tuner-${this.id}] Now streaming placeholder for ${channel.name}`);
        return true;
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

  async checkNoUpcomingAirings() {
    // Wait a moment for the modal to fully load
    await new Promise(r => setTimeout(r, 1000));

    try {
      const hasNoAirings = await this.page.evaluate(() => {
        // Look for "No upcoming airings" text in the page
        const bodyText = document.body.innerText || '';
        return bodyText.includes('No upcoming airings');
      });
      return hasNoAirings;
    } catch (e) {
      console.log(`[tuner-${this.id}] Error checking for no airings: ${e.message}`);
      return false;
    }
  }

  async closeNoAiringsModal() {
    try {
      // Try to close the modal by clicking the X button or pressing Escape
      await this.page.evaluate(() => {
        // Look for close button (X)
        const closeButtons = document.querySelectorAll('[aria-label="close"], [aria-label="Close"], button');
        for (const btn of closeButtons) {
          const text = btn.textContent || '';
          const ariaLabel = btn.getAttribute('aria-label') || '';
          if (text === '×' || text === 'X' || ariaLabel.toLowerCase().includes('close')) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      // Also try pressing Escape
      await this.page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`[tuner-${this.id}] Error closing modal: ${e.message}`);
    }
  }

  async startPlaceholderStream(channelName) {
    // Generate a placeholder video using FFmpeg with text overlay
    // This creates a test pattern with "No Upcoming Airings" message

    const placeholderText = `Channel: ${channelName}\\nNo Upcoming Airings\\nPlease change channel`;

    // Use FFmpeg to generate a test pattern with text
    // The FFmpegCapture class will handle the stream, but we need to use lavfi input instead of screen capture
    if (this.ffmpeg) {
      await this.ffmpeg.startPlaceholder(this.displayNum, placeholderText);
    }
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
      segmentMonitor: this.ffmpeg ? this.ffmpeg.getSegmentMonitorStatus() : null,
    };
  }

  getPlaylistPath() {
    return this.ffmpeg ? this.ffmpeg.getPlaylistPath() : null;
  }

  getSegmentPath(filename) {
    return this.ffmpeg ? this.ffmpeg.getSegmentPath(filename) : null;
  }

  // Add a client to receive MPEG-TS stream
  async pipeToClient(res) {
    if (this.ffmpeg) {
      // If FFmpeg was stopped (idle timeout), restart it
      if (!this.ffmpeg.isRunning) {
        console.log(`[tuner-${this.id}] FFmpeg not running, restarting for new client...`);
        await this.ffmpeg.start(this.displayNum);
      }
      this.ffmpeg.addClient(res);

      // Track client disconnect to update tuner client count
      res.on('close', () => {
        this.removeClient();
      });

      return true;
    }
    return false;
  }

  // Check if streaming is active
  isStreaming() {
    return this.ffmpeg && this.ffmpeg.isRunning;
  }

  // Handle black screen detection - auto-retune to the same channel
  async handleBlackScreen() {
    if (!this.currentChannel) {
      console.log(`[tuner-${this.id}] No current channel to retune to`);
      return;
    }

    const channel = this.currentChannel;
    console.log(`[tuner-${this.id}] Auto-retuning to ${channel} due to black screen...`);

    try {
      // Re-tune to the same channel (this will stop FFmpeg, navigate, and restart)
      await this.tuneToChannel(channel);
      console.log(`[tuner-${this.id}] Auto-retune to ${channel} completed successfully`);
    } catch (err) {
      console.error(`[tuner-${this.id}] Auto-retune failed: ${err.message}`);
      // Mark tuner as error so it can be recovered by tuner-manager
      this.state = TunerState.ERROR;
    }
  }

  // Get segment monitor status (for API/debugging)
  getSegmentMonitorStatus() {
    return this.ffmpeg ? this.ffmpeg.getSegmentMonitorStatus() : null;
  }
}

module.exports = { Tuner, TunerState };
