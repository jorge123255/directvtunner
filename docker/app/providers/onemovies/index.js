// 1movies.bz Provider - Main implementation
// Extends BaseProvider with 1movies-specific logic

const BaseProvider = require('../base-provider');
const config = require('./config');

class OneMoviesProvider extends BaseProvider {
  constructor() {
    super(config);
  }

  /**
   * Get M3U8 URL patterns
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
   * Get proxy headers for 1movies requests
   */
  getProxyHeaders() {
    return {
      'Referer': 'https://1movies.bz/',
      'Origin': 'https://1movies.bz',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
    };
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
   * Fetch movie catalog from 1movies.bz
   * Uses genre pages for pagination
   */
  async fetchCatalog(options = {}) {
    const { genres = config.genres, pagesPerGenre = config.pagesPerGenre } = options;

    let browser;
    let page;
    let createdPage = false;

    try {
      browser = await this.connectBrowser();
      const contexts = browser.contexts();
      const context = contexts[0];

      // Try to reuse existing 1movies page
      const existingPages = context.pages();
      page = existingPages.find(p => p.url().includes('1movies.bz'));

      if (!page) {
        page = await context.newPage();
        createdPage = true;
      }

      // Enable ad-blocking
      await this.enableAdBlocking(page);

      const allMovies = new Map();

      // Fetch from homepage first
      try {
        this.log('Fetching homepage...');
        await page.goto(`${this.baseUrl}/home`, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeouts.navigation
        });
        await this.sleep(2000);

        const homeMovies = await this.extractMoviesFromPage(page);
        for (const movie of homeMovies) {
          if (movie.slug && !allMovies.has(movie.slug)) {
            allMovies.set(movie.slug, movie);
          }
        }
        this.log(`Homepage: ${homeMovies.length} movies, total: ${allMovies.size}`);
      } catch (err) {
        this.logError('Homepage fetch error:', err.message);
      }

      // Fetch from genre pages
      for (const genre of genres) {
        this.log(`Fetching genre: ${genre}`);

        for (let pageNum = 1; pageNum <= pagesPerGenre; pageNum++) {
          try {
            const genreUrl = pageNum === 1
              ? `${this.baseUrl}/genre/${genre}`
              : `${this.baseUrl}/genre/${genre}?page=${pageNum}`;

            await page.goto(genreUrl, {
              waitUntil: 'domcontentloaded',
              timeout: config.timeouts.navigation
            });
            await this.sleep(1000);

            const pageMovies = await this.extractMoviesFromPage(page);

            if (pageMovies.length === 0) {
              this.log(`  ${genre} page ${pageNum}: empty, stopping`);
              break;
            }

            let newCount = 0;
            for (const movie of pageMovies) {
              if (movie.slug && !allMovies.has(movie.slug)) {
                movie.genre = genre;
                allMovies.set(movie.slug, movie);
                newCount++;
              }
            }

            this.log(`  ${genre} page ${pageNum}: ${pageMovies.length} movies (${newCount} new), total: ${allMovies.size}`);

            // Rate limiting
            await this.sleep(config.requestDelay);

          } catch (err) {
            this.logError(`  ${genre} page ${pageNum} error:`, err.message);
            break;
          }
        }
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
   * Extract movies from current page DOM
   */
  async extractMoviesFromPage(page) {
    return page.evaluate(() => {
      const movies = [];

      // Movie cards typically have links like /watch/movie-{slug}
      const cards = document.querySelectorAll('a[href*="/watch/movie-"]');

      cards.forEach(card => {
        const href = card.getAttribute('href');
        const match = href?.match(/\/watch\/movie-(.+)/);

        if (match) {
          const slug = match[1];
          const img = card.querySelector('img');
          const titleEl = card.querySelector('.film-name, .title, h3, h4') || card;

          movies.push({
            slug: slug,
            title: titleEl.textContent?.trim() || img?.alt || slug.replace(/-/g, ' '),
            poster: img?.src || img?.getAttribute('data-src') || null,
            url: href,
            provider: 'onemovies'
          });
        }
      });

      return movies;
    });
  }

  /**
   * Extract m3u8 stream URL for a movie
   * 1movies uses slug-based URLs: /watch/movie-{slug}
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
    const allRequests = [];

    try {
      browser = await this.connectBrowser();
      const contexts = browser.contexts();
      const context = contexts[0];

      this.log(`Extracting stream for ${contentType}/${contentId}`);

      // Build content URL - contentId should be the slug
      const contentUrl = `${this.baseUrl}/watch/movie-${contentId}`;

      // Try to reuse existing 1movies page on the same movie
      const existingPages = context.pages();
      page = existingPages.find(p => p.url().includes(`1movies.bz/watch/movie-${contentId}`));

      if (page) {
        this.log(`Reusing existing page: ${page.url()}`);
      } else {
        page = existingPages.find(p => p.url().includes('1movies.bz'));
        if (page) {
          this.log('Reusing 1movies page, navigating...');
        } else {
          page = await context.newPage();
          createdPage = true;
          this.log('Created new page');
        }
      }

      // Enable ad-blocking BEFORE any navigation
      const getBlockedCount = await this.enableAdBlocking(page);

      // Monitor network requests for debugging
      context.on('request', (request) => {
        const url = request.url();
        allRequests.push(url);
        if (url.includes('.m3u8') || url.includes('video') ||
            url.includes('stream') || url.includes('play') || url.includes('embed')) {
          this.log(`[DEBUG] Request: ${url.substring(0, 100)}`);
        }
      });

      page.on('frameattached', (frame) => {
        this.log(`[DEBUG] Frame attached: ${frame.url()}`);
      });

      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) {
          this.log(`[DEBUG] Frame navigated: ${frame.url()}`);
        }
      });

      // Set up network interception BEFORE navigation
      const m3u8Promise = this.interceptM3u8(page, config.timeouts.m3u8Capture);

      // Navigate to watch page if not already there
      if (!page.url().includes(`/watch/movie-${contentId}`)) {
        await page.goto(contentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeouts.navigation
        });
        await this.sleep(2000);
      }

      // Close ad overlays
      await this.closeAdOverlays(page);

      // Try to click server/source buttons
      let serverClicked = false;
      for (const selector of config.serverSelectors) {
        try {
          const server = page.locator(selector).first();
          if (await server.isVisible({ timeout: config.timeouts.serverSelect })) {
            this.log(`Clicking server: ${selector}`);
            await server.click();
            serverClicked = true;
            await this.sleep(1000);
            break;
          }
        } catch (e) {
          // Server not found
        }
      }

      // Try to click play buttons
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
            // Button not found
          }
        }

        if (buttonClicked) break;

        if (attempt < 2) {
          this.log(`Play button not found, attempt ${attempt + 1}, closing ads...`);
          await this.closeAdOverlays(page);
          await this.sleep(1000);
        }
      }

      if (!buttonClicked && !serverClicked) {
        this.log('No play/server button found, waiting for auto-play or iframe');
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
      if (allRequests.length > 0) {
        this.log(`[DEBUG] Total requests made: ${allRequests.length}`);
        const last20 = allRequests.slice(-20);
        this.log(`[DEBUG] Last ${last20.length} requests:`);
        last20.forEach((url, i) => {
          this.log(`[DEBUG]   ${i + 1}. ${url.substring(0, 120)}`);
        });
      }
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
   * Get content URL on 1movies.bz
   */
  getContentUrl(contentId, contentType = 'movie') {
    return `${this.baseUrl}/watch/movie-${contentId}`;
  }
}

module.exports = OneMoviesProvider;
