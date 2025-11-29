// Cineby Stream Extractor - Browser-based Network Interception
// Uses Playwright to connect to existing Chrome, navigate to movie, and capture m3u8 URL
// The m3u8 URL is requested AFTER client-side decryption happens

const { chromium } = require('playwright');
const { getMovie } = require('./cineby-movies');

const DEBUG_PORT = process.env.CHROME_DEBUG_PORT || 9222;
const CINEBY_BASE = 'https://www.cineby.gd';

// Cache for extracted stream URLs
const streamCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Pattern to match m3u8 URLs from Cineby's CDN
const M3U8_PATTERNS = [
  /tasteful-wire\.workers\.dev.*\.m3u8/,
  /cloudspark.*\.m3u8/,
  /megafiles\.store.*\.m3u8/,
  /\.m3u8(\?|$)/,
];

// Extract stream URL by navigating to movie page and intercepting m3u8 request
async function extractStreamUrl(movieId) {
  // Try to get movie from catalog
  let movie = getMovie(movieId);
  let tmdbId = movieId;
  let movieTitle = `TMDB:${movieId}`;

  if (movie) {
    tmdbId = movie.tmdbId;
    movieTitle = movie.title;
  }

  // Check cache first
  const cached = streamCache.get(tmdbId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[cineby] Using cached stream URL for ${movieTitle}`);
    return cached.url;
  }

  console.log(`[cineby] Extracting stream URL for: ${movieTitle} (TMDB: ${tmdbId})`);

  let browser;
  let page;
  let m3u8Url = null;

  try {
    // Connect to existing Chrome instance via CDP
    browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
    const contexts = browser.contexts();
    const context = contexts[0];

    // Create a new page for movie extraction
    page = await context.newPage();

    console.log(`[cineby] Created new page for movie extraction`);

    // Set up network interception to capture m3u8 URL
    const m3u8Promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for m3u8 URL (30s)'));
      }, 30000);

      page.on('request', (request) => {
        const url = request.url();

        // Check if this is an m3u8 request
        for (const pattern of M3U8_PATTERNS) {
          if (pattern.test(url)) {
            console.log(`[cineby] Found m3u8: ${url.substring(0, 100)}...`);
            clearTimeout(timeout);
            resolve(url);
            return;
          }
        }
      });

      // Also check responses for m3u8 content-type
      page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        if (contentType.includes('mpegurl') || contentType.includes('m3u8')) {
          console.log(`[cineby] Found m3u8 via content-type: ${url.substring(0, 100)}...`);
          clearTimeout(timeout);
          resolve(url);
        }
      });
    });

    // Navigate to movie page with ?play=true to auto-start playback
    const movieUrl = `${CINEBY_BASE}/movie/${tmdbId}?play=true`;
    console.log(`[cineby] Navigating to: ${movieUrl}`);

    await page.goto(movieUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    // Click the play button if it exists (in case auto-play didn't work)
    try {
      const playButton = page.locator('#ButtonPlay, [data-testid="play-button"], button:has-text("Play")').first();
      if (await playButton.isVisible({ timeout: 3000 })) {
        console.log(`[cineby] Clicking play button`);
        await playButton.click();
      }
    } catch (e) {
      // Play button might not exist or video might auto-play
      console.log(`[cineby] No play button found or already playing`);
    }

    // Wait for m3u8 URL to be captured
    m3u8Url = await m3u8Promise;

    console.log(`[cineby] Successfully captured m3u8 URL`);

    // Cache the URL
    streamCache.set(tmdbId, {
      url: m3u8Url,
      timestamp: Date.now(),
      title: movieTitle
    });

    return m3u8Url;

  } catch (error) {
    console.error(`[cineby] Error extracting stream:`, error.message);
    throw error;
  } finally {
    // Close the page we created
    if (page) {
      try {
        await page.close();
        console.log(`[cineby] Closed extraction page`);
      } catch (e) {
        // Page might already be closed
      }
    }
    // Don't close browser - it's shared CDP connection
  }
}

// Alternative extraction using existing page (for when there's already a Chrome with Cineby open)
async function extractStreamUrlFromExistingPage(movieId) {
  let movie = getMovie(movieId);
  let tmdbId = movieId;
  let movieTitle = `TMDB:${movieId}`;

  if (movie) {
    tmdbId = movie.tmdbId;
    movieTitle = movie.title;
  }

  // Check cache first
  const cached = streamCache.get(tmdbId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[cineby] Using cached stream URL for ${movieTitle}`);
    return cached.url;
  }

  console.log(`[cineby] Extracting via existing page for: ${movieTitle} (TMDB: ${tmdbId})`);

  let browser;

  try {
    browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
    const contexts = browser.contexts();
    const context = contexts[0];
    const pages = context.pages();

    // Find an existing Cineby page
    let page = pages.find(p => p.url().includes('cineby.gd'));

    if (!page) {
      // Fall back to creating a new page
      console.log(`[cineby] No existing Cineby page found, creating new one`);
      return extractStreamUrl(movieId);
    }

    console.log(`[cineby] Using existing Cineby page: ${page.url()}`);

    // Set up network interception
    const m3u8Promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for m3u8 URL (30s)'));
      }, 30000);

      const handler = (request) => {
        const url = request.url();
        for (const pattern of M3U8_PATTERNS) {
          if (pattern.test(url)) {
            console.log(`[cineby] Found m3u8: ${url.substring(0, 100)}...`);
            clearTimeout(timeout);
            page.off('request', handler);
            resolve(url);
            return;
          }
        }
      };

      page.on('request', handler);
    });

    // Navigate to the movie
    const movieUrl = `${CINEBY_BASE}/movie/${tmdbId}?play=true`;
    console.log(`[cineby] Navigating to: ${movieUrl}`);

    await page.goto(movieUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    // Try to click play button
    try {
      const playButton = page.locator('#ButtonPlay, [data-testid="play-button"], button:has-text("Play")').first();
      if (await playButton.isVisible({ timeout: 3000 })) {
        console.log(`[cineby] Clicking play button`);
        await playButton.click();
      }
    } catch (e) {
      console.log(`[cineby] No play button found or already playing`);
    }

    // Wait for m3u8
    const m3u8Url = await m3u8Promise;

    // Cache it
    streamCache.set(tmdbId, {
      url: m3u8Url,
      timestamp: Date.now(),
      title: movieTitle
    });

    return m3u8Url;

  } catch (error) {
    console.error(`[cineby] Error extracting stream:`, error.message);
    throw error;
  }
}

// Get cached stream URL if available
function getCachedUrl(movieId) {
  const movie = getMovie(movieId);
  const tmdbId = movie ? movie.tmdbId : movieId;

  const cached = streamCache.get(tmdbId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.url;
  }
  return null;
}

// Clear cache for a movie
function clearCache(movieId) {
  if (movieId) {
    const movie = getMovie(movieId);
    const tmdbId = movie ? movie.tmdbId : movieId;
    streamCache.delete(tmdbId);
  } else {
    streamCache.clear();
  }
}

// Get all cached entries
function getCacheStatus() {
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

module.exports = {
  extractStreamUrl,
  extractStreamUrlFromExistingPage,
  getCachedUrl,
  clearCache,
  getCacheStatus
};
