// CinemaOS Provider - Main implementation
// Extends BaseProvider with CinemaOS-specific logic

const BaseProvider = require('../base-provider');
const { normalizeMovie } = require('../../shared/tmdb-utils');
const config = require('./config');

class CinemaOSProvider extends BaseProvider {
  constructor() {
    super(config);
  }

  /**
   * Get M3U8 URL patterns for CinemaOS
   */
  getM3u8Patterns() {
    return config.m3u8Patterns;
  }

  /**
   * Get M3U8 exclusion patterns (URLs to skip, e.g., DirecTV)
   */
  getM3u8ExcludePatterns() {
    return config.m3u8ExcludePatterns || [];
  }

  /**
   * Check if URL should be excluded from m3u8 capture
   */
  isExcludedUrl(url) {
    const excludePatterns = this.getM3u8ExcludePatterns();
    const lowerUrl = url.toLowerCase();
    return excludePatterns.some(pattern => lowerUrl.includes(pattern.toLowerCase()));
  }

  /**
   * Get proxy headers for CinemaOS requests
   */
  getProxyHeaders() {
    return {
      'Referer': 'https://cinemaos.live/',
      'Origin': 'https://cinemaos.live',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
  }

  /**
   * Fetch movie catalog from CinemaOS
   */
  async fetchCatalog(options = {}) {
    const { section = 'movies', pages = 3 } = options;

    let browser;
    let page;
    let createdPage = false;

    try {
      browser = await this.connectBrowser();
      const contexts = browser.contexts();
      const context = contexts[0];

      // Try to reuse existing CinemaOS page
      const existingPages = context.pages();
      page = existingPages.find(p => p.url().includes('cinemaos.live'));

      if (!page) {
        page = await context.newPage();
        createdPage = true;
      }

      // Navigate to movie section
      const sectionUrl = `${this.baseUrl}${config.sections[section]}`;
      await page.goto(sectionUrl, {
        waitUntil: 'networkidle',
        timeout: config.timeouts.navigation
      });

      this.log(`Navigated to ${sectionUrl}`);

      const allMovies = new Map();

      // Try to extract from __NEXT_DATA__ first
      const nextData = await this.extractNextData(page);
      if (nextData?.pageProps) {
        const pageMovies = nextData.pageProps.movies ||
                         nextData.pageProps.items ||
                         nextData.pageProps.results || [];

        for (const movie of pageMovies) {
          if (!allMovies.has(movie.id)) {
            allMovies.set(movie.id, this.normalizeMovie(movie));
          }
        }
        this.log(`Extracted ${allMovies.size} movies from __NEXT_DATA__`);
      }

      // Also try the API endpoint - fetch ALL pages until empty
      try {
        const apiMovies = await this.fetchFromApi(page);
        for (const movie of apiMovies) {
          if (!allMovies.has(movie.id)) {
            allMovies.set(movie.id, this.normalizeMovie(movie));
          }
        }
        this.log(`Total after API: ${allMovies.size} movies`);
      } catch (err) {
        this.logError('API fetch error:', err.message);
      }

      // Extract from DOM as fallback
      if (allMovies.size < 20) {
        const domMovies = await this.extractFromDom(page);
        for (const movie of domMovies) {
          if (movie.tmdbId && !allMovies.has(movie.tmdbId)) {
            allMovies.set(movie.tmdbId, movie);
          }
        }
        this.log(`Total after DOM: ${allMovies.size} movies`);
      }

      this.log(`Catalog complete: ${allMovies.size} movies`);
      return { movies: Array.from(allMovies.values()), tv: [] };

    } catch (error) {
      this.logError('Catalog fetch error:', error.message);
      throw error;
    } finally {
      if (createdPage && page) {
        try {
          await page.close();
        } catch (e) {
          // Page might already be closed
        }
      }
    }
  }

  /**
   * Fetch movies from CinemaOS API - fetches all categories and ALL pages until empty
   */
  async fetchFromApi(page, maxPagesPerCategory = null) {
    const movies = [];
    const categories = config.movieCategories || ['popularMovie'];
    const delay = config.requestDelay || 300;
    const maxPages = maxPagesPerCategory || 100; // Safety limit to prevent infinite loops

    for (const category of categories) {
      this.log(`Fetching category: ${category}`);
      let pageNum = 1;
      let categoryTotal = 0;

      while (pageNum <= maxPages) {
        try {
          const apiUrl = `${this.baseUrl}${config.api.tmdb}?requestID=${category}&language=${config.tmdbParams.language}&page=${pageNum}`;

          const apiData = await page.evaluate(async (url) => {
            const response = await fetch(url, {
              headers: {
                'Content-Type': 'application/json',
                'Accept': '*/*'
              }
            });
            if (!response.ok) return { results: [] };
            return response.json();
          }, apiUrl);

          const results = apiData.results || apiData.movies || [];

          // Stop if no more results for this category
          if (results.length === 0) {
            this.log(`  ${category}: completed at page ${pageNum - 1} (${categoryTotal} movies)`);
            break;
          }

          // Add category info to each movie
          for (const movie of results) {
            movie._category = category;
          }

          movies.push(...results);
          categoryTotal += results.length;

          this.log(`  ${category} page ${pageNum}: ${results.length} movies`);

          pageNum++;

          // Rate limiting
          await this.sleep(delay);

        } catch (err) {
          this.logError(`  ${category} page ${pageNum} error:`, err.message);
          break;
        }
      }
    }

    this.log(`Total from API: ${movies.length} movies (before dedup)`);
    return movies;
  }

  /**
   * Extract movies from DOM elements
   */
  async extractFromDom(page) {
    return page.evaluate(() => {
      const movies = [];
      const cards = document.querySelectorAll('a[href*="/movie/"]');

      cards.forEach(card => {
        const href = card.getAttribute('href');
        const match = href?.match(/\/movie\/(\d+)/);
        if (match) {
          const img = card.querySelector('img');
          movies.push({
            tmdbId: parseInt(match[1]),
            id: match[1],
            title: img?.alt || card.textContent?.trim() || '',
            poster: img?.src || null,
            provider: 'cinemaos'
          });
        }
      });

      return movies;
    });
  }

  /**
   * Check if URL matches ad patterns
   */
  isAdRequest(url) {
    const adPatterns = config.adBlockPatterns || [];
    const lowerUrl = url.toLowerCase();
    return adPatterns.some(pattern => lowerUrl.includes(pattern.toLowerCase()));
  }

  /**
   * Enable ad-blocking on a page via route interception
   */
  async enableAdBlocking(page) {
    let blockedCount = 0;

    await page.route('**/*', (route) => {
      const url = route.request().url();

      if (this.isAdRequest(url)) {
        blockedCount++;
        if (blockedCount <= 5) {
          this.log(`Blocked ad: ${url.substring(0, 60)}...`);
        } else if (blockedCount === 6) {
          this.log('(suppressing further ad block logs...)');
        }
        route.abort();
      } else {
        route.continue();
      }
    });

    this.log('Ad-blocking enabled');
    return () => blockedCount;
  }

  /**
   * Try to close any ad overlays/popups
   */
  async closeAdOverlays(page) {
    const closeSelectors = config.adCloseSelectors || [];
    let closedCount = 0;

    for (const selector of closeSelectors) {
      try {
        const elements = page.locator(selector);
        const count = await elements.count();

        for (let i = 0; i < count; i++) {
          try {
            const el = elements.nth(i);
            if (await el.isVisible({ timeout: 500 })) {
              await el.click({ timeout: 1000 });
              closedCount++;
              this.log(`Closed ad overlay: ${selector}`);
              await this.sleep(300);
            }
          } catch (e) {
            // Element not clickable or gone
          }
        }
      } catch (e) {
        // Selector failed
      }
    }

    return closedCount;
  }

  /**
   * Override interceptM3u8 to filter out DirecTV and other excluded URLs
   * Uses context-level handlers to capture requests from iframes
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

      // Check if URL matches m3u8 pattern AND is not excluded
      const isValidM3u8 = (url) => {
        // Check if URL matches any m3u8 pattern
        const matchesPattern = patterns.some(pattern => pattern.test(url));
        if (!matchesPattern) return false;

        // Check if URL should be excluded (e.g., DirecTV)
        if (this.isExcludedUrl(url)) {
          this.log(`[SKIP] Excluded m3u8 URL: ${url.substring(0, 80)}...`);
          return false;
        }

        return true;
      };

      // Check request URLs - context level (catches iframe requests)
      const requestHandler = (request) => {
        if (resolved) return;
        const url = request.url();
        if (isValidM3u8(url)) {
          this.log(`Found m3u8 via context request: ${url.substring(0, 100)}...`);
          cleanup();
          resolve(url);
        }
      };

      // Check response content-type - context level
      const responseHandler = async (response) => {
        if (resolved) return;
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        if ((contentType.includes('mpegurl') || contentType.includes('m3u8')) && !this.isExcludedUrl(url)) {
          this.log(`Found m3u8 via context content-type: ${url.substring(0, 100)}...`);
          cleanup();
          resolve(url);
        }
      };

      // Also check page-level for backwards compatibility
      const pageRequestHandler = (request) => {
        if (resolved) return;
        const url = request.url();
        if (isValidM3u8(url)) {
          this.log(`Found m3u8 via page request: ${url.substring(0, 100)}...`);
          cleanup();
          resolve(url);
        }
      };

      const pageResponseHandler = async (response) => {
        if (resolved) return;
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        if ((contentType.includes('mpegurl') || contentType.includes('m3u8')) && !this.isExcludedUrl(url)) {
          this.log(`Found m3u8 via page content-type: ${url.substring(0, 100)}...`);
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
   * Extract m3u8 stream URL for a movie
   */
  async extractStreamUrl(contentId, contentType = 'movie') {
    // Check in-memory cache
    const cached = this.getCachedStreamUrl(contentId);
    if (cached) {
      this.log(`Using cached stream for ${contentId}`);
      return cached;
    }

    let browser;
    let page;
    let createdPage = false;
    const allRequests = [];  // Declare here for access in catch block

    try {
      browser = await this.connectBrowser();
      const contexts = browser.contexts();
      const context = contexts[0];

      this.log(`Extracting stream for ${contentType}/${contentId}`);

      // Try to reuse existing CinemaOS page on the same movie
      const contentUrl = `${this.baseUrl}/${contentType}/${contentId}`;
      const existingPages = context.pages();
      page = existingPages.find(p => p.url().includes(`cinemaos.live/${contentType}/${contentId}`));

      if (page) {
        this.log(`Reusing existing page: ${page.url()}`);
      } else {
        // Try to reuse any CinemaOS page and navigate
        page = existingPages.find(p => p.url().includes('cinemaos.live'));
        if (page) {
          this.log(`Reusing CinemaOS page, navigating to ${contentId}`);
        } else {
          page = await context.newPage();
          createdPage = true;
          this.log('Created new page');
        }
      }

      // Enable ad-blocking BEFORE any navigation
      const getBlockedCount = await this.enableAdBlocking(page);

      // Monitor ALL network requests for debugging
      // Note: 'allRequests' and 'context' are already defined above

      // Log all requests from context (includes iframes)
      context.on('request', (request) => {
        const url = request.url();
        allRequests.push(url);
        // Log video-related requests
        if (url.includes('.m3u8') || url.includes('.ts') || url.includes('video') ||
            url.includes('stream') || url.includes('play') || url.includes('embed')) {
          this.log(`[DEBUG] Request: ${url.substring(0, 100)}`);
        }
      });

      // Also monitor page for iframes
      page.on('frameattached', (frame) => {
        this.log(`[DEBUG] Frame attached: ${frame.url()}`);
      });

      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) {
          this.log(`[DEBUG] Frame navigated: ${frame.url()}`);
        }
      });

      // Set up network interception BEFORE navigation/click
      const m3u8Promise = this.interceptM3u8(page, config.timeouts.m3u8Capture);

      // Navigate if not already on the content page
      if (!page.url().includes(`/${contentType}/${contentId}`)) {
        await page.goto(contentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeouts.navigation
        });
        // Wait a bit for the page to settle
        await this.sleep(2000);
      }

      // Try to close any ad overlays
      await this.closeAdOverlays(page);

      // Try to click watch/play button - with retry after closing ads
      let buttonClicked = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const selector of config.playButtonSelectors) {
          try {
            const button = page.locator(selector).first();
            if (await button.isVisible({ timeout: config.timeouts.playButton })) {
              this.log(`Clicking: ${selector}`);
              await button.click();
              buttonClicked = true;
              break;
            }
          } catch (e) {
            // Button not found, try next
          }
        }

        if (buttonClicked) break;

        // If button not clicked, try closing ads again and retry
        if (attempt < 2) {
          this.log(`Play button not found, attempt ${attempt + 1}, closing ads...`);
          await this.closeAdOverlays(page);
          await this.sleep(1000);
        }
      }

      if (!buttonClicked) {
        this.log('No play button found, waiting for auto-play or iframe');
      }

      // Wait for m3u8 URL
      const m3u8Url = await m3u8Promise;
      this.log(`Stream captured: ${m3u8Url.substring(0, 80)}...`);

      // Log stats
      const blockedCount = getBlockedCount();
      this.log(`Blocked ${blockedCount} ad requests`);
      this.log(`Total requests observed: ${allRequests.length}`);

      // Cache the URL
      this.cacheStreamUrl(contentId, m3u8Url);

      return m3u8Url;

    } catch (error) {
      this.logError(`Stream extraction failed for ${contentId}:`, error.message);
      // Dump debug info on failure
      if (allRequests && allRequests.length > 0) {
        this.log(`[DEBUG] Total requests made: ${allRequests.length}`);
        // Log last 20 requests
        const last20 = allRequests.slice(-20);
        this.log(`[DEBUG] Last ${last20.length} requests:`);
        last20.forEach((url, i) => {
          this.log(`[DEBUG]   ${i + 1}. ${url.substring(0, 120)}`);
        });
      }
      throw error;
    } finally {
      // Only close if we created a new page
      if (createdPage && page) {
        try {
          await page.close();
        } catch (e) {
          // Page might already be closed
        }
      }
    }
  }

  /**
   * Normalize movie data to standard format
   */
  normalizeMovie(apiMovie) {
    // Map category to human-readable name
    const categoryNames = {
      'popularMovie': 'Popular',
      'latestMovie': 'Latest',
      'topRatedMovie': 'Top Rated',
      'upcomingMovie': 'Upcoming'
    };

    const normalized = normalizeMovie(apiMovie, {
      provider: 'cinemaos',
      source: 'API',
      category: categoryNames[apiMovie._category] || apiMovie._category || 'Unknown'
    });

    // Add CinemaOS-specific URL
    normalized.cinemaosUrl = `${this.baseUrl}/movie/${normalized.tmdbId}`;

    return normalized;
  }

  /**
   * Get content URL on CinemaOS
   */
  getContentUrl(contentId, contentType = 'movie') {
    return `${this.baseUrl}/${contentType}/${contentId}`;
  }
}

module.exports = CinemaOSProvider;
