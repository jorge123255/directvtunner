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
      // On Linux, start Xvfb virtual display
      if (config.getPlatform() === 'linux') {
        await this.startXvfb();
      }

      // Start Chrome with remote debugging
      await this.startChrome();

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
        await new Promise(r => setTimeout(r, 1000));
      }

      // Navigate to guide page to select channel
      const guideUrl = 'https://stream.directv.com/guide';
      const currentUrl = this.page.url();

      // Only navigate if not already on DirecTV
      if (!currentUrl.includes('stream.directv.com')) {
        console.log(`[tuner-${this.id}] Navigating to DirecTV guide...`);
        await this.page.goto(guideUrl, {
          waitUntil: 'domcontentloaded',  // Don't wait for networkidle - it takes forever
          timeout: 30000,
        });
        console.log(`[tuner-${this.id}] Waiting for guide to load...`);
        await new Promise(r => setTimeout(r, 8000));  // Give it time to render
      } else if (!currentUrl.includes('/guide')) {
        // On DirecTV but not on guide - navigate to guide
        console.log(`[tuner-${this.id}] Navigating to guide page...`);
        await this.page.goto(guideUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await new Promise(r => setTimeout(r, 5000));
      } else {
        console.log(`[tuner-${this.id}] Already on guide page`);
      }

      // Try to find and click the channel in the guide
      console.log(`[tuner-${this.id}] Searching for channel ${channel.name} (${channel.number})...`);

      // DirecTV guide uses aria-label like "view A3 New York 02 WCBS CBS"
      // Format: "view [number] [location] [callsign] [name]"
      // We'll search for the channel name or number in the aria-label

      const channelSelectors = [
        // By aria-label containing channel name (most reliable)
        `[aria-label*="${channel.name}"][role="link"]`,
        // By aria-label containing channel number
        `[aria-label*=" ${channel.number} "][role="link"]`,
        // By text content
        `text="${channel.name}"`,
        // By partial name (first word)
        `[aria-label*="${channel.name.split(' ')[0]}"][role="link"]`,
      ];

      let clicked = false;
      for (const selector of channelSelectors) {
        try {
          console.log(`[tuner-${this.id}] Trying selector: ${selector}`);
          const element = await this.page.$(selector);
          if (element) {
            console.log(`[tuner-${this.id}] Found channel with selector: ${selector}`);
            await element.click();
            clicked = true;
            break;
          }
        } catch (e) {
          console.log(`[tuner-${this.id}] Selector failed: ${e.message}`);
        }
      }

      if (!clicked) {
        // Try scrolling down the guide to find the channel
        console.log(`[tuner-${this.id}] Channel not visible, trying to scroll...`);

        // Scroll down the page a few times looking for the channel
        for (let i = 0; i < 10; i++) {
          await this.page.keyboard.press('PageDown');
          await new Promise(r => setTimeout(r, 500));

          const element = await this.page.$(`[aria-label*="${channel.name}"][role="link"]`);
          if (element) {
            console.log(`[tuner-${this.id}] Found channel after scrolling`);
            await element.click();
            clicked = true;
            break;
          }
        }
      }

      if (!clicked) {
        console.log(`[tuner-${this.id}] Could not find channel ${channel.name} in guide`);
      }

      // After clicking channel in guide, wait for the info panel to appear
      console.log(`[tuner-${this.id}] Waiting for channel info panel...`);
      await new Promise(r => setTimeout(r, 2000));

      // Click the play button - it has a background image with play icon
      console.log(`[tuner-${this.id}] Looking for play button...`);
      const playButtonSelectors = [
        // Play button with background image
        '[style*="play"]',
        '[style*="mt_play"]',
        // Common play button patterns
        '[aria-label*="Play"]',
        '[aria-label*="play"]',
        '[aria-label*="Watch"]',
        '[aria-label*="watch"]',
        // Class-based selectors for the div with play button
        'div[style*="mt_play_stroke"]',
      ];

      let playClicked = false;
      for (const selector of playButtonSelectors) {
        try {
          console.log(`[tuner-${this.id}] Trying play selector: ${selector}`);
          const playBtn = await this.page.$(selector);
          if (playBtn) {
            console.log(`[tuner-${this.id}] Found play button with selector: ${selector}`);
            await playBtn.click();
            playClicked = true;
            break;
          }
        } catch (e) {
          console.log(`[tuner-${this.id}] Play selector failed: ${e.message}`);
        }
      }

      // If selectors didn't work, try clicking by evaluating in page
      if (!playClicked) {
        console.log(`[tuner-${this.id}] Trying to find play button via page.evaluate...`);
        playClicked = await this.page.evaluate(() => {
          // Find element with play button background image
          const allDivs = document.querySelectorAll('div');
          for (const div of allDivs) {
            const style = div.getAttribute('style') || '';
            if (style.includes('mt_play') || style.includes('play_stroke')) {
              div.click();
              return true;
            }
          }
          // Also try aria-labels
          const playButtons = document.querySelectorAll('[aria-label*="Play"], [aria-label*="Watch"]');
          if (playButtons.length > 0) {
            playButtons[0].click();
            return true;
          }
          return false;
        });
      }

      if (playClicked) {
        console.log(`[tuner-${this.id}] Play button clicked!`);
      } else {
        console.log(`[tuner-${this.id}] Could not find play button`);
      }

      // Wait for channel to tune
      console.log(`[tuner-${this.id}] Waiting for channel to tune...`);
      await new Promise(r => setTimeout(r, config.channelSwitchDelay));

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

  async maximizeVideo() {
    try {
      // Try to find and maximize the video player
      await this.page.evaluate(() => {
        // Find video element
        const video = document.querySelector('video');
        if (video) {
          // Try to enter fullscreen
          if (video.requestFullscreen) {
            video.requestFullscreen().catch(() => {});
          }
          // Or make it fill the window
          video.style.position = 'fixed';
          video.style.top = '0';
          video.style.left = '0';
          video.style.width = '100vw';
          video.style.height = '100vh';
          video.style.zIndex = '9999';
        }
      });
    } catch {
      // Ignore errors - video maximization is optional
    }
  }

  async stop() {
    console.log(`[tuner-${this.id}] Stopping...`);

    // Stop FFmpeg
    if (this.ffmpeg) {
      this.ffmpeg.stop();
      this.ffmpeg = null;
    }

    // Disconnect Playwright
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }

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
    };
  }

  getPlaylistPath() {
    return this.ffmpeg ? this.ffmpeg.getPlaylistPath() : null;
  }

  getSegmentPath(filename) {
    return this.ffmpeg ? this.ffmpeg.getSegmentPath(filename) : null;
  }
}

module.exports = { Tuner, TunerState };
