// Cineby Catalog - Fetches movies from homepage + browse pages
// Includes browse page expansion for 500+ movies

const { normalizeMovie } = require('../../shared/tmdb-utils');
const config = require('./config');

class CinebyCatalog {
  constructor(provider) {
    this.provider = provider;
    this.config = config;
  }

  /**
   * Fetch movies from homepage __NEXT_DATA__
   */
  async fetchHomepage(page) {
    this.provider.log('Fetching homepage catalog...');

    const nextData = await this.provider.extractNextData(page);
    if (!nextData?.pageProps) {
      throw new Error('Could not extract __NEXT_DATA__ from homepage');
    }

    const movies = [];
    const seen = new Set();

    // Process genre sections
    if (nextData.pageProps.genreSections) {
      for (const section of nextData.pageProps.genreSections) {
        const sectionName = section.name?.charAt(0).toUpperCase() + section.name?.slice(1) || 'Genre';
        for (const movie of section.movies || []) {
          if (movie.mediaType === 'movie' && !seen.has(movie.id)) {
            seen.add(movie.id);
            movies.push(this.normalizeMovie(movie, sectionName));
          }
        }
      }
    }

    // Process trending sections
    if (nextData.pageProps.trendingSections) {
      for (const section of nextData.pageProps.trendingSections) {
        for (const movie of section.movies || []) {
          if (movie.mediaType === 'movie' && !seen.has(movie.id)) {
            seen.add(movie.id);
            movies.push(this.normalizeMovie(movie, 'Trending'));
          }
        }
      }
    }

    // Process default sections
    if (nextData.pageProps.defaultSections) {
      for (const section of nextData.pageProps.defaultSections) {
        const sectionName = section.name === 'trending' ? 'Trending' :
                          section.name === 'top_rated' ? 'Top Rated' : section.name;
        for (const movie of section.movies || []) {
          if (movie.mediaType === 'movie' && !seen.has(movie.id)) {
            seen.add(movie.id);
            movies.push(this.normalizeMovie(movie, sectionName));
          }
        }
      }
    }

    this.provider.log(`Fetched ${movies.length} movies from homepage`);
    return movies;
  }

  /**
   * Fetch movies from browse page API
   */
  async fetchBrowsePage(page, buildId) {
    this.provider.log('Fetching browse page catalog...');

    const browseUrl = `${this.config.baseUrl}${this.config.browse.getDataUrl(buildId, 'movie')}`;

    try {
      const browseData = await page.evaluate(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }, browseUrl);

      const movies = [];
      const items = browseData.pageProps?.initialMovies ||
                   browseData.pageProps?.items ||
                   browseData.pageProps?.movies || [];

      for (const movie of items) {
        if (movie.mediaType === 'movie') {
          movies.push(this.normalizeMovie(movie, 'Browse'));
        }
      }

      this.provider.log(`Fetched ${movies.length} movies from browse page`);
      return movies;

    } catch (err) {
      this.provider.logError('Browse page fetch error:', err.message);
      return [];
    }
  }

  /**
   * Fetch all genres via browse page with scrolling
   * This is the key function for catalog expansion (126 -> 500+ movies)
   */
  async fetchAllBrowseGenres(page, buildId, options = {}) {
    const { scrollsPerGenre = 3, requestDelay = 500 } = options;

    this.provider.log('Expanding catalog via browse genres...');
    const allMovies = new Map();

    // First, navigate to browse page to get initial data
    const browseUrl = `${this.config.baseUrl}/browse/movie`;
    await page.goto(browseUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Get fresh buildId from browse page
    const freshBuildId = await this.provider.getBuildId(page) || buildId;

    // Fetch base browse page data
    const baseUrl = `${this.config.baseUrl}/_next/data/${freshBuildId}/en/browse/movie.json?type=movie`;
    try {
      const baseData = await page.evaluate(async (url) => {
        const response = await fetch(url);
        if (!response.ok) return { pageProps: {} };
        return response.json();
      }, baseUrl);

      // Extract initial movies
      const initialMovies = baseData.pageProps?.initialMovies ||
                           baseData.pageProps?.items || [];

      for (const movie of initialMovies) {
        if (movie.mediaType === 'movie') {
          allMovies.set(movie.id, this.normalizeMovie(movie, 'Browse'));
        }
      }

      this.provider.log(`Initial browse: ${allMovies.size} movies`);

    } catch (err) {
      this.provider.logError('Base browse fetch error:', err.message);
    }

    // Try different sort options to get more movies
    for (const sortBy of this.config.browse.sortOptions) {
      try {
        const sortUrl = `${this.config.baseUrl}/_next/data/${freshBuildId}/en/browse/movie.json?type=movie&sort=${sortBy}`;

        const sortData = await page.evaluate(async (url) => {
          const response = await fetch(url);
          if (!response.ok) return { pageProps: {} };
          return response.json();
        }, sortUrl);

        const sortMovies = sortData.pageProps?.initialMovies ||
                          sortData.pageProps?.items || [];

        let newCount = 0;
        for (const movie of sortMovies) {
          if (movie.mediaType === 'movie' && !allMovies.has(movie.id)) {
            allMovies.set(movie.id, this.normalizeMovie(movie, sortBy.includes('vote') ? 'Top Rated' : 'Popular'));
            newCount++;
          }
        }

        this.provider.log(`Sort ${sortBy}: +${newCount} new (total: ${allMovies.size})`);
        await this.provider.sleep(requestDelay);

      } catch (err) {
        this.provider.logError(`Sort ${sortBy} error:`, err.message);
      }
    }

    // Simulate scrolling to trigger infinite scroll loading
    if (scrollsPerGenre > 0) {
      this.provider.log('Performing scroll loading...');

      for (let i = 0; i < scrollsPerGenre; i++) {
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await this.provider.sleep(1500);

        // Extract any newly loaded movies
        const newMovies = await page.evaluate(() => {
          const movieCards = document.querySelectorAll('[data-movie-id], [data-tmdb-id], a[href*="/movie/"]');
          const movies = [];

          movieCards.forEach(card => {
            const href = card.getAttribute('href');
            if (href && href.includes('/movie/')) {
              const match = href.match(/\/movie\/(\d+)/);
              if (match) {
                movies.push({
                  id: parseInt(match[1]),
                  title: card.querySelector('img')?.alt || '',
                  poster: card.querySelector('img')?.src || ''
                });
              }
            }
          });

          return movies;
        });

        let scrollNewCount = 0;
        for (const movie of newMovies) {
          if (movie.id && !allMovies.has(movie.id)) {
            allMovies.set(movie.id, {
              id: movie.id.toString(),
              tmdbId: movie.id,
              title: movie.title,
              poster: movie.poster,
              category: 'Browse',
              provider: 'cineby'
            });
            scrollNewCount++;
          }
        }

        if (scrollNewCount > 0) {
          this.provider.log(`Scroll ${i + 1}: +${scrollNewCount} new (total: ${allMovies.size})`);
        }
      }
    }

    this.provider.log(`Browse expansion complete: ${allMovies.size} total movies`);
    return Array.from(allMovies.values());
  }

  /**
   * Normalize movie data to standard format
   */
  normalizeMovie(apiMovie, source = 'Unknown') {
    const normalized = normalizeMovie(apiMovie, {
      provider: 'cineby',
      source
    });

    // Add Cineby-specific URL
    normalized.cinebyUrl = `${this.config.baseUrl}/movie/${normalized.tmdbId}`;

    return normalized;
  }
}

module.exports = CinebyCatalog;
