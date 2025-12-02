// Base Provider - Abstract class for all VOD streaming site providers
// All providers (Cineby, CinemaOS, etc.) must extend this class

const { chromium } = require('playwright');

class BaseProvider {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.features = config.features || ['movies'];
    this.debugPort = process.env.CHROME_DEBUG_PORT || 9222;

    // M3U8 URL patterns to match during network interception
    this.m3u8Patterns = config.m3u8Patterns || [/\.m3u8(\?|$)/];

    // Stream URL cache (in-memory, short TTL)
    // Note: Upstream URLs expire after ~2 mins, so keep cache TTL very short
    this.streamCache = new Map();
    this.streamCacheTTL = 90 * 1000; // 90 seconds (upstream expires at ~2 mins)

    // Proactive refresh settings
    this.refreshInterval = 60 * 1000;      // Refresh URLs every 60s (before 2min expiry)
    this.inactivityTimeout = 5 * 60 * 1000; // Stop refreshing after 5min no activity
  }

  // ========== Required Methods (must be overridden) ==========

  /**
   * Fetch movie/TV catalog from the site
   * @param {Object} options - Provider-specific options
   * @returns {Promise<{movies: Array, tv: Array}>}
   */
  async fetchCatalog(options = {}) {
    throw new Error(`${this.id}: fetchCatalog() must be implemented`);
  }

  /**
   * Extract m3u8 stream URL for a content item
   * @param {string} contentId - TMDB ID or provider-specific ID
   * @param {string} contentType - 'movie' or 'tv'
   * @returns {Promise<string>} - m3u8 URL
   */
  async extractStreamUrl(contentId, contentType = 'movie') {
    throw new Error(`${this.id}: extractStreamUrl() must be implemented`);
  }

  // ========== Optional Methods (can be overridden) ==========

  /**
   * Get HTTP headers to use when proxying requests to this site
   */
  getProxyHeaders() {
    return {
      'Referer': `${this.baseUrl}/`,
      'Origin': this.baseUrl,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
  }

  /**
   * Get M3U8 URL patterns for network interception
   */
  getM3u8Patterns() {
    return this.m3u8Patterns;
  }

  /**
   * Rewrite playlist URLs to route through our proxy
   * @param {string} playlist - Original m3u8 playlist content
   * @param {string} proxyBase - Base URL for proxy (e.g., http://host:port/vod/cineby)
   * @param {string} contentId - Content ID for header lookup
   * @param {string} baseStreamUrl - Base URL of the original stream (for resolving relative paths)
   * @returns {string} - Modified playlist
   */
  rewritePlaylistUrls(playlist, proxyBase, contentId = null, baseStreamUrl = null) {
    // Default: rewrite all URLs to go through our segment proxy
    const lines = playlist.split('\n');
    const rewritten = lines.map(line => {
      const trimmed = line.trim();

      // Skip comment lines and empty lines
      if (trimmed.startsWith('#') || trimmed === '') {
        return line;
      }

      let fullUrl = trimmed;

      // If it's a relative path, make it absolute
      if (trimmed.startsWith('/') && baseStreamUrl) {
        // Extract origin from baseStreamUrl
        try {
          const urlObj = new URL(baseStreamUrl);
          fullUrl = `${urlObj.origin}${trimmed}`;
        } catch (e) {
          // If can't parse, try prepending https
          fullUrl = `https:/${trimmed}`;
        }
      } else if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        // Relative path without leading slash - resolve relative to stream URL
        if (baseStreamUrl) {
          const lastSlash = baseStreamUrl.lastIndexOf('/');
          fullUrl = baseStreamUrl.substring(0, lastSlash + 1) + trimmed;
        } else {
          return line; // Can't resolve, leave as-is
        }
      }

      // Encode and proxy the full URL
      const encoded = Buffer.from(fullUrl).toString('base64url');
      const cidParam = contentId ? `?cid=${contentId}` : '';
      return `${proxyBase}/segment/${encoded}${cidParam}`;
    });

    return rewritten.join('\n');
  }

  /**
   * Build URL to content page on this site
   */
  getContentUrl(contentId, contentType = 'movie') {
    return `${this.baseUrl}/${contentType}/${contentId}`;
  }

  // ========== Shared Helper Methods ==========

  /**
   * Connect to Chrome browser via CDP
   */
  async connectBrowser() {
    return chromium.connectOverCDP(`http://localhost:${this.debugPort}`);
  }

  /**
   * Get or create a page in the browser context
   */
  async getPage(browser, options = {}) {
    const { reuseExisting = false, urlMatch = null } = options;

    const contexts = browser.contexts();
    const context = contexts[0];

    if (reuseExisting && urlMatch) {
      const pages = context.pages();
      const existingPage = pages.find(p => p.url().includes(urlMatch));
      if (existingPage) {
        console.log(`[${this.id}] Reusing existing page: ${existingPage.url()}`);
        return { page: existingPage, created: false };
      }
    }

    const page = await context.newPage();
    return { page, created: true };
  }

  /**
   * Set up network interception to capture m3u8 URLs
   * Uses context-level handlers to capture requests from iframes too
   * @param {Page} page - Playwright page object
   * @param {number} timeout - Max time to wait (ms)
   * @returns {Promise<string>} - Captured m3u8 URL
   */
  async interceptM3u8(page, timeout = 30000) {
    const patterns = this.getM3u8Patterns();
    const context = page.context();
    let resolved = false;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          reject(new Error(`Timeout waiting for m3u8 URL (${timeout}ms)`));
        }
      }, timeout);

      const cleanup = () => {
        resolved = true;
        clearTimeout(timeoutId);
        context.off('request', requestHandler);
        context.off('response', responseHandler);
        page.off('request', pageRequestHandler);
        page.off('response', pageResponseHandler);
      };

      // Check request URLs - context level (catches iframe requests)
      const requestHandler = (request) => {
        if (resolved) return;
        const url = request.url();
        for (const pattern of patterns) {
          if (pattern.test(url)) {
            console.log(`[${this.id}] Found m3u8 via context request: ${url.substring(0, 100)}...`);
            cleanup();
            resolve(url);
            return;
          }
        }
      };

      // Check response content-type - context level
      const responseHandler = async (response) => {
        if (resolved) return;
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        if (contentType.includes('mpegurl') || contentType.includes('m3u8')) {
          console.log(`[${this.id}] Found m3u8 via context content-type: ${url.substring(0, 100)}...`);
          cleanup();
          resolve(url);
        }
      };

      // Also check page-level for backwards compatibility
      const pageRequestHandler = (request) => {
        if (resolved) return;
        const url = request.url();
        for (const pattern of patterns) {
          if (pattern.test(url)) {
            console.log(`[${this.id}] Found m3u8 via page request: ${url.substring(0, 100)}...`);
            cleanup();
            resolve(url);
            return;
          }
        }
      };

      const pageResponseHandler = async (response) => {
        if (resolved) return;
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        if (contentType.includes('mpegurl') || contentType.includes('m3u8')) {
          console.log(`[${this.id}] Found m3u8 via page content-type: ${url.substring(0, 100)}...`);
          cleanup();
          resolve(url);
        }
      };

      // Listen on both context (for iframes) and page level
      context.on('request', requestHandler);
      context.on('response', responseHandler);
      page.on('request', pageRequestHandler);
      page.on('response', pageResponseHandler);
    });
  }

  /**
   * Extract __NEXT_DATA__ from a Next.js page
   */
  async extractNextData(page) {
    return page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      if (script) {
        return JSON.parse(script.textContent);
      }
      return null;
    });
  }

  /**
   * Get buildId from Next.js page
   */
  async getBuildId(page) {
    const nextData = await this.extractNextData(page);
    return nextData?.buildId || null;
  }

  // ========== Stream Cache Methods ==========

  /**
   * Get cached stream URL
   */
  getCachedStreamUrl(contentId) {
    const cached = this.streamCache.get(contentId.toString());
    if (cached && Date.now() - cached.timestamp < this.streamCacheTTL) {
      return cached.url;
    }
    return null;
  }

  /**
   * Cache stream URL with proactive refresh support
   */
  cacheStreamUrl(contentId, url) {
    const key = contentId.toString();
    const existing = this.streamCache.get(key);

    // Preserve refresh timer if already running
    this.streamCache.set(key, {
      url,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      refreshTimer: existing?.refreshTimer || null,
      isRefreshing: false,
      contentType: existing?.contentType || 'movie'
    });
  }

  /**
   * Clear stream cache
   */
  clearStreamCache(contentId = null) {
    if (contentId) {
      this.streamCache.delete(contentId.toString());
    } else {
      this.streamCache.clear();
    }
  }

  /**
   * Get stream cache status
   */
  getStreamCacheStatus() {
    const entries = [];
    for (const [id, data] of this.streamCache) {
      entries.push({
        contentId: id,
        age: Math.round((Date.now() - data.timestamp) / 1000),
        expired: Date.now() - data.timestamp >= this.streamCacheTTL,
        refreshing: !!data.refreshTimer
      });
    }
    return entries;
  }

  // ========== Proactive URL Refresh Methods ==========

  /**
   * Start background refresh for an active stream
   * Prevents URL expiration by proactively fetching fresh URLs
   */
  startStreamRefresh(contentId, contentType = 'movie') {
    const key = contentId.toString();
    const entry = this.streamCache.get(key);

    if (!entry) {
      console.log(`[${this.id}] Cannot start refresh - no cache entry for ${contentId}`);
      return;
    }

    if (entry.refreshTimer) {
      // Already refreshing, just update last accessed time
      entry.lastAccessed = Date.now();
      return;
    }

    console.log(`[${this.id}] Starting proactive refresh for ${contentId}`);
    entry.contentType = contentType;
    entry.lastAccessed = Date.now();

    entry.refreshTimer = setInterval(async () => {
      const currentEntry = this.streamCache.get(key);
      if (!currentEntry) {
        this.stopStreamRefresh(contentId);
        return;
      }

      // Check if still active (accessed within inactivityTimeout)
      const timeSinceAccess = Date.now() - currentEntry.lastAccessed;
      if (timeSinceAccess > this.inactivityTimeout) {
        console.log(`[${this.id}] Stream ${contentId} inactive for ${Math.round(timeSinceAccess / 1000)}s, stopping refresh`);
        this.stopStreamRefresh(contentId);
        return;
      }

      // Check if URL is old enough to need refresh
      const urlAge = Date.now() - currentEntry.timestamp;
      if (urlAge > this.refreshInterval && !currentEntry.isRefreshing) {
        currentEntry.isRefreshing = true;
        try {
          console.log(`[${this.id}] Proactively refreshing URL for ${contentId} (age: ${Math.round(urlAge / 1000)}s)...`);
          // Clear cache to force fresh extraction
          const savedEntry = { ...currentEntry };
          this.clearStreamCache(contentId);
          const freshUrl = await this.extractStreamUrl(contentId, savedEntry.contentType);
          // Re-cache with fresh URL but preserve timer
          this.cacheStreamUrl(contentId, freshUrl);
          const newEntry = this.streamCache.get(key);
          if (newEntry) {
            newEntry.refreshTimer = savedEntry.refreshTimer;
            newEntry.contentType = savedEntry.contentType;
          }
          console.log(`[${this.id}] URL refreshed successfully for ${contentId}`);
        } catch (err) {
          console.error(`[${this.id}] Proactive refresh failed for ${contentId}:`, err.message);
          // Don't clear cache on refresh failure - keep using existing URL
        }
        const updatedEntry = this.streamCache.get(key);
        if (updatedEntry) {
          updatedEntry.isRefreshing = false;
        }
      }
    }, 15000); // Check every 15 seconds
  }

  /**
   * Stop background refresh for a stream
   */
  stopStreamRefresh(contentId) {
    const key = contentId.toString();
    const entry = this.streamCache.get(key);
    if (entry?.refreshTimer) {
      clearInterval(entry.refreshTimer);
      entry.refreshTimer = null;
      console.log(`[${this.id}] Stopped proactive refresh for ${contentId}`);
    }
  }

  /**
   * Mark stream as accessed (extends refresh lifetime)
   * Call this on every segment request to keep the stream "alive"
   */
  touchStream(contentId) {
    const key = contentId.toString();
    const entry = this.streamCache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
    }
  }

  /**
   * Get current stream URL (with touch)
   * Use this instead of getCachedStreamUrl for segment requests
   */
  getActiveStreamUrl(contentId) {
    const key = contentId.toString();
    const entry = this.streamCache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.url;
    }
    return null;
  }

  /**
   * Attempt urgent URL refresh (when current URL fails)
   * Returns the new URL or null if refresh fails
   */
  async urgentRefresh(contentId, contentType = 'movie') {
    const key = contentId.toString();
    const entry = this.streamCache.get(key);

    if (entry?.isRefreshing) {
      console.log(`[${this.id}] Urgent refresh requested but already refreshing ${contentId}`);
      // Wait for current refresh to complete
      await this.sleep(2000);
      return this.streamCache.get(key)?.url || null;
    }

    console.log(`[${this.id}] Urgent refresh triggered for ${contentId}`);

    // IMPORTANT: Clear cache first to force fresh extraction
    this.clearStreamCache(contentId);

    try {
      const freshUrl = await this.extractStreamUrl(contentId, contentType);
      this.cacheStreamUrl(contentId, freshUrl);
      console.log(`[${this.id}] Urgent refresh successful for ${contentId}`);
      return freshUrl;
    } catch (err) {
      console.error(`[${this.id}] Urgent refresh failed for ${contentId}:`, err.message);
      return null;
    }
  }

  // ========== Utility Methods ==========

  /**
   * Log message with provider prefix
   */
  log(message, ...args) {
    console.log(`[${this.id}] ${message}`, ...args);
  }

  /**
   * Log error with provider prefix
   */
  logError(message, ...args) {
    console.error(`[${this.id}] ${message}`, ...args);
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BaseProvider;
