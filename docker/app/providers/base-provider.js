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
    this.streamCache = new Map();
    this.streamCacheTTL = 30 * 60 * 1000; // 30 minutes
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
   * @returns {string} - Modified playlist
   */
  rewritePlaylistUrls(playlist, proxyBase) {
    // Default: no rewriting needed
    // Override in provider if segment URLs need proxying
    return playlist;
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
   * Cache stream URL
   */
  cacheStreamUrl(contentId, url) {
    this.streamCache.set(contentId.toString(), {
      url,
      timestamp: Date.now()
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
        expired: Date.now() - data.timestamp >= this.streamCacheTTL
      });
    }
    return entries;
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
