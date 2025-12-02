// Cineby Provider - Main implementation
// Extends BaseProvider with Cineby-specific logic

const BaseProvider = require('../base-provider');
const CinebyCatalog = require('./catalog');
const config = require('./config');

class CinebyProvider extends BaseProvider {
  constructor() {
    super(config);
    this.catalog = new CinebyCatalog(this);
  }

  /**
   * Get M3U8 URL patterns for Cineby CDNs
   */
  getM3u8Patterns() {
    return config.m3u8Patterns;
  }

  /**
   * Get proxy headers for Cineby requests
   */
  getProxyHeaders() {
    return {
      'Referer': 'https://www.cineby.gd/',
      'Origin': 'https://www.cineby.gd',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
  }

  /**
   * Fetch movie catalog from Cineby
   * @param {Object} options
   * @param {boolean} options.expandBrowse - Expand via browse page (default: true)
   * @param {number} options.scrollsPerGenre - Scrolls for infinite load
   */
  async fetchCatalog(options = {}) {
    const { expandBrowse = true, scrollsPerGenre = 3 } = options;

    let browser;
    let page;
    let createdPage = false;

    try {
      browser = await this.connectBrowser();
      const contexts = browser.contexts();
      const context = contexts[0];

      // Try to reuse existing Cineby page
      const pages = context.pages();
      page = pages.find(p => p.url().includes('cineby.gd'));

      if (!page) {
        page = await context.newPage();
        createdPage = true;
        await page.goto(this.baseUrl, {
          waitUntil: 'networkidle',
          timeout: config.timeouts.navigation
        });
      }

      // Get buildId for API requests
      const buildId = await this.getBuildId(page);
      if (!buildId) {
        this.log('Warning: Could not get buildId, fetching homepage only');
      }

      // Fetch homepage movies
      let movies = await this.catalog.fetchHomepage(page);

      // Expand via browse page if enabled
      if (expandBrowse && buildId) {
        const browseMovies = await this.catalog.fetchAllBrowseGenres(page, buildId, {
          scrollsPerGenre
        });

        // Merge, deduplicating by TMDB ID
        const movieMap = new Map(movies.map(m => [m.tmdbId, m]));
        for (const movie of browseMovies) {
          if (!movieMap.has(movie.tmdbId)) {
            movieMap.set(movie.tmdbId, movie);
          }
        }
        movies = Array.from(movieMap.values());
      }

      this.log(`Catalog complete: ${movies.length} movies`);
      return { movies, tv: [] };

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

    try {
      browser = await this.connectBrowser();
      const contexts = browser.contexts();
      const context = contexts[0];
      page = await context.newPage();

      this.log(`Extracting stream for ${contentType}/${contentId}`);

      // Set up network interception
      const m3u8Promise = this.interceptM3u8(page, config.timeouts.m3u8Capture);

      // Navigate to content page with auto-play
      const contentUrl = `${this.baseUrl}/${contentType}/${contentId}?play=true`;
      await page.goto(contentUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.timeouts.navigation
      });

      // Try to click play button if video doesn't auto-start
      try {
        for (const selector of config.playButtonSelectors) {
          const playButton = page.locator(selector).first();
          if (await playButton.isVisible({ timeout: config.timeouts.playButton })) {
            this.log('Clicking play button');
            await playButton.click();
            break;
          }
        }
      } catch (e) {
        // Play button might not exist or video auto-started
        this.log('No play button found or video auto-playing');
      }

      // Wait for m3u8 URL
      const m3u8Url = await m3u8Promise;
      this.log(`Stream captured: ${m3u8Url.substring(0, 80)}...`);

      // Cache the URL
      this.cacheStreamUrl(contentId, m3u8Url);

      return m3u8Url;

    } catch (error) {
      this.logError(`Stream extraction failed for ${contentId}:`, error.message);
      throw error;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Page might already be closed
        }
      }
    }
  }

  /**
   * Rewrite playlist URLs to route through proxy
   */
  rewritePlaylistUrls(playlist, proxyBase, contentId = null, baseStreamUrl = null) {
    // Cineby uses relative URLs that need to be proxied
    // Pattern: /raindust78.online/file2/xyz.ts

    let rewritten = playlist;
    const cidParam = contentId ? `?cid=${contentId}` : '';

    for (const pattern of config.segmentPatterns) {
      rewritten = rewritten.replace(pattern, (match, segment) => {
        // Build full URL and encode for proxy
        const fullUrl = segment.startsWith('http') ? segment :
                       segment.startsWith('/') ? `https:/${segment}` : segment;
        const encoded = Buffer.from(fullUrl).toString('base64url');
        return `${proxyBase}/segment/${encoded}${cidParam}`;
      });
    }

    return rewritten;
  }

  /**
   * Get content URL on Cineby
   */
  getContentUrl(contentId, contentType = 'movie') {
    return `${this.baseUrl}/${contentType}/${contentId}`;
  }
}

module.exports = CinebyProvider;
