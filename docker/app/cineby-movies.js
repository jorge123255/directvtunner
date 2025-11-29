// Cineby Movie Catalog - Dynamic API Fetching
// Fetches movies from cineby.gd Next.js API via Chrome CDP
// URL format: https://www.cineby.gd/movie/{tmdb_id}

const { chromium } = require('playwright');

const DEBUG_PORT = process.env.CHROME_DEBUG_PORT || 9222;
const CINEBY_BASE = 'https://www.cineby.gd';

// Genre ID to name mapping (TMDB genre IDs)
const GENRE_MAP = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
};

// Cache for movie data
let moviesCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

// Fallback movies (used if API fails)
const fallbackMovies = [
  { id: 'elf', title: 'Elf', year: 2003, tmdbId: 10719, category: 'Holiday' },
  { id: 'home-alone', title: 'Home Alone', year: 1990, tmdbId: 771, category: 'Holiday' },
  { id: 'john-wick', title: 'John Wick', year: 2014, tmdbId: 245891, category: 'Action' },
  { id: 'inception', title: 'Inception', year: 2010, tmdbId: 27205, category: 'Sci-Fi' },
  { id: 'the-matrix', title: 'The Matrix', year: 1999, tmdbId: 603, category: 'Sci-Fi' },
];

// Build Cineby URL from TMDB ID
function getCinebyUrl(tmdbId, mediaType = 'movie') {
  return `${CINEBY_BASE}/${mediaType}/${tmdbId}`;
}

// Convert API movie to internal format
function convertApiMovie(apiMovie, section = 'Trending') {
  const year = apiMovie.release_date ? parseInt(apiMovie.release_date.split('-')[0]) : null;
  const slugId = apiMovie.id.toString();

  // Determine category from genre_ids or section
  let category = section;
  if (apiMovie.genre_ids && apiMovie.genre_ids.length > 0) {
    const primaryGenre = GENRE_MAP[apiMovie.genre_ids[0]];
    if (primaryGenre) category = primaryGenre;
  }

  return {
    id: slugId,
    title: apiMovie.title || apiMovie.name,
    year,
    tmdbId: apiMovie.id,
    category,
    description: apiMovie.description || '',
    rating: apiMovie.rating || 0,
    poster: apiMovie.poster || null,
    backdrop: apiMovie.image || null,
    mediaType: apiMovie.mediaType || 'movie',
    cinebyUrl: getCinebyUrl(apiMovie.id, apiMovie.mediaType || 'movie')
  };
}

// Fetch movies from Cineby API using Chrome CDP
async function fetchMoviesFromApi() {
  console.log('[cineby] Fetching movies from Cineby API...');

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
    const contexts = browser.contexts();
    const context = contexts[0];
    const pages = context.pages();
    const page = pages.find(p => p.url().includes('cineby.gd')) || pages[0];

    console.log('[cineby] Connected to Chrome, fetching API data...');

    // Fetch the Next.js data API from within the browser context
    const apiData = await page.evaluate(async () => {
      try {
        // First, get the build ID from the page's __NEXT_DATA__
        const nextDataScript = document.getElementById('__NEXT_DATA__');
        let buildId = null;

        if (nextDataScript) {
          const nextData = JSON.parse(nextDataScript.textContent);
          buildId = nextData.buildId;
        }

        if (!buildId) {
          // Fallback: fetch homepage and extract build ID
          const homeRes = await fetch('https://www.cineby.gd');
          const homeHtml = await homeRes.text();
          const match = homeHtml.match(/"buildId"\s*:\s*"([^"]+)"/);
          if (match) buildId = match[1];
        }

        if (!buildId) {
          throw new Error('Could not determine Next.js build ID');
        }

        // Fetch the homepage data
        const dataUrl = `https://www.cineby.gd/_next/data/${buildId}/en.json`;
        const response = await fetch(dataUrl);
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        return await response.json();
      } catch (err) {
        return { error: err.message };
      }
    });

    // Don't close browser - it's a shared CDP connection

    if (apiData.error) {
      throw new Error(apiData.error);
    }

    const movies = [];
    const seen = new Set();

    // Process genre sections
    if (apiData.pageProps?.genreSections) {
      for (const section of apiData.pageProps.genreSections) {
        const sectionName = section.name.charAt(0).toUpperCase() + section.name.slice(1);
        for (const movie of section.movies || []) {
          if (movie.mediaType === 'movie' && !seen.has(movie.id)) {
            seen.add(movie.id);
            movies.push(convertApiMovie(movie, sectionName));
          }
        }
      }
    }

    // Process trending sections
    if (apiData.pageProps?.trendingSections) {
      for (const section of apiData.pageProps.trendingSections) {
        for (const movie of section.movies || []) {
          if (movie.mediaType === 'movie' && !seen.has(movie.id)) {
            seen.add(movie.id);
            movies.push(convertApiMovie(movie, 'Trending'));
          }
        }
      }
    }

    // Process default sections
    if (apiData.pageProps?.defaultSections) {
      for (const section of apiData.pageProps.defaultSections) {
        const sectionName = section.name === 'trending' ? 'Trending' :
                          section.name === 'top_rated' ? 'Top Rated' : section.name;
        for (const movie of section.movies || []) {
          if (movie.mediaType === 'movie' && !seen.has(movie.id)) {
            seen.add(movie.id);
            movies.push(convertApiMovie(movie, sectionName));
          }
        }
      }
    }

    console.log(`[cineby] Fetched ${movies.length} movies from API`);
    return movies;

  } catch (error) {
    console.error('[cineby] Error fetching from API:', error.message);
    return null;
  }
}

// Get movies (with caching)
async function getMoviesWithCache() {
  // Check cache
  if (moviesCache && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return moviesCache;
  }

  // Try to fetch from API
  const apiMovies = await fetchMoviesFromApi();

  if (apiMovies && apiMovies.length > 0) {
    moviesCache = apiMovies;
    cacheTimestamp = Date.now();
    return apiMovies;
  }

  // Return cached data even if expired, or fallback
  if (moviesCache) {
    console.log('[cineby] Using expired cache');
    return moviesCache;
  }

  console.log('[cineby] Using fallback movie list');
  return fallbackMovies.map(m => ({
    ...m,
    cinebyUrl: getCinebyUrl(m.tmdbId)
  }));
}

// Synchronous access to current movies (may return empty if not loaded)
function getMoviesSync() {
  if (moviesCache) return moviesCache;
  return fallbackMovies.map(m => ({
    ...m,
    cinebyUrl: getCinebyUrl(m.tmdbId)
  }));
}

// Get all movies (async)
async function getAllMovies() {
  return await getMoviesWithCache();
}

// Get movie by ID (TMDB ID as string)
function getMovie(movieId) {
  const movies = getMoviesSync();
  const movie = movies.find(m => m.id === movieId || m.tmdbId.toString() === movieId);
  return movie || null;
}

// Search movies by title
function searchMovies(query) {
  const movies = getMoviesSync();
  const q = query.toLowerCase();
  return movies.filter(m => m.title.toLowerCase().includes(q));
}

// Get movies by category
function getMoviesByCategory(category) {
  const movies = getMoviesSync();
  return movies.filter(m => m.category === category);
}

// Get all categories
function getCategories() {
  const movies = getMoviesSync();
  return [...new Set(movies.map(m => m.category))];
}

// Generate M3U entries for Cineby movies
function generateCinebyM3U(host) {
  const movies = getMoviesSync();
  let m3u = '';

  for (const movie of movies) {
    const logo = movie.poster || '';
    m3u += `#EXTINF:-1 tvg-id="cineby-${movie.id}" tvg-name="${movie.title}" tvg-logo="${logo}" group-title="Cineby - ${movie.category}",${movie.title}${movie.year ? ` (${movie.year})` : ''}\n`;
    m3u += `http://${host}/cineby/${movie.id}/stream\n`;
  }

  return m3u;
}

// Refresh cache manually
async function refreshCache() {
  cacheTimestamp = null;
  return await getMoviesWithCache();
}

// Initialize cache on module load (async, non-blocking)
(async () => {
  try {
    await getMoviesWithCache();
    console.log('[cineby] Movie cache initialized');
  } catch (err) {
    console.log('[cineby] Could not pre-load movie cache, will load on first request');
  }
})();

module.exports = {
  getAllMovies,
  getMovie,
  searchMovies,
  getMoviesByCategory,
  getCategories,
  generateCinebyM3U,
  getCinebyUrl,
  refreshCache
};
