// Cineby Stream Extractor
// Navigates to Cineby movie page, extracts the HLS stream URL via network interception
// Returns the direct stream URL for native playback in TvMate/VLC (supports pause/rewind!)

const { chromium } = require('playwright');
const { getMovie, getCinebyUrl } = require('./cineby-movies');

const DEBUG_PORT = process.env.CHROME_DEBUG_PORT || 9222;

// Cache for extracted stream URLs (they may expire, so cache with TTL)
const streamCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

class CinebyStreamer {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isExtracting = false;
    this.extractionQueue = [];
  }

  async connect() {
    if (this.browser) return;

    console.log('[cineby] Connecting to Chrome on port', DEBUG_PORT);
    this.browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
    const contexts = this.browser.contexts();
    const context = contexts[0];

    // Try to find existing Cineby tab or create new one
    const pages = context.pages();
    this.page = pages.find(p => p.url().includes('cineby.gd')) || pages[0];

    console.log('[cineby] Connected, current page:', this.page.url());
  }

  async disconnect() {
    if (this.browser) {
      this.browser.disconnect();
      this.browser = null;
      this.page = null;
    }
  }

  // Extract the HLS/MP4 stream URL from a Cineby movie page
  async extractStreamUrl(movieId) {
    const movie = getMovie(movieId);
    if (!movie) {
      throw new Error(`Movie not found: ${movieId}`);
    }

    // Check cache first
    const cached = streamCache.get(movieId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[cineby] Using cached stream URL for ${movie.title}`);
      return cached.url;
    }

    // Queue extraction if already in progress
    if (this.isExtracting) {
      return new Promise((resolve, reject) => {
        this.extractionQueue.push({ movieId, resolve, reject });
      });
    }

    this.isExtracting = true;

    try {
      await this.connect();

      const cinebyUrl = movie.cinebyUrl;
      console.log(`[cineby] Extracting stream URL for: ${movie.title}`);
      console.log(`[cineby] Navigating to: ${cinebyUrl}`);

      let streamUrl = null;

      // Set up network interception to capture the HLS/MP4 URL
      const streamPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for stream URL'));
        }, 30000);

        const handleRequest = (request) => {
          const url = request.url();

          // Look for HLS manifest (.m3u8) or direct video (.mp4)
          if (url.includes('.m3u8') && !url.includes('cineby.gd')) {
            console.log(`[cineby] Found HLS stream: ${url.substring(0, 100)}...`);
            clearTimeout(timeout);
            this.page.off('request', handleRequest);
            resolve(url);
          } else if (url.includes('.mp4') && url.includes('http') && !url.includes('poster')) {
            console.log(`[cineby] Found MP4 stream: ${url.substring(0, 100)}...`);
            clearTimeout(timeout);
            this.page.off('request', handleRequest);
            resolve(url);
          }
        };

        this.page.on('request', handleRequest);
      });

      // Navigate to the movie page
      await this.page.goto(cinebyUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // Wait for video player to load and click play if needed
      await this.page.waitForTimeout(2000);

      // Try to click play button if video isn't playing
      try {
        // Common play button selectors
        const playSelectors = [
          'button[aria-label="Play"]',
          '.play-button',
          '.vjs-big-play-button',
          '[class*="play"]',
          'video'
        ];

        for (const selector of playSelectors) {
          const element = await this.page.$(selector);
          if (element) {
            await element.click().catch(() => {});
            console.log(`[cineby] Clicked: ${selector}`);
            break;
          }
        }
      } catch (e) {
        console.log('[cineby] Could not find/click play button, video may auto-play');
      }

      // Wait for stream URL from network interception
      streamUrl = await streamPromise;

      // Cache the URL
      streamCache.set(movieId, {
        url: streamUrl,
        timestamp: Date.now(),
        title: movie.title
      });

      console.log(`[cineby] Successfully extracted stream for ${movie.title}`);

      return streamUrl;

    } catch (error) {
      console.error(`[cineby] Error extracting stream:`, error.message);
      throw error;
    } finally {
      this.isExtracting = false;

      // Process queue
      if (this.extractionQueue.length > 0) {
        const next = this.extractionQueue.shift();
        this.extractStreamUrl(next.movieId)
          .then(next.resolve)
          .catch(next.reject);
      }
    }
  }

  // Get cached stream URL if available
  getCachedUrl(movieId) {
    const cached = streamCache.get(movieId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.url;
    }
    return null;
  }

  // Clear cache for a movie
  clearCache(movieId) {
    if (movieId) {
      streamCache.delete(movieId);
    } else {
      streamCache.clear();
    }
  }

  // Get all cached entries
  getCacheStatus() {
    const entries = [];
    for (const [movieId, data] of streamCache) {
      entries.push({
        movieId,
        title: data.title,
        age: Math.round((Date.now() - data.timestamp) / 1000),
        expired: Date.now() - data.timestamp >= CACHE_TTL
      });
    }
    return entries;
  }
}

// Singleton instance
const cinebyStreamer = new CinebyStreamer();

module.exports = cinebyStreamer;
