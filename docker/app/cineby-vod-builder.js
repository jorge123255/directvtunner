// Cineby VOD Builder - Batch extracts m3u8 URLs and builds VOD playlist
// Fetches all movies from API, extracts stream URLs, and saves with full metadata

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEBUG_PORT = process.env.CHROME_DEBUG_PORT || 9222;
const CINEBY_BASE = 'https://www.cineby.gd';
const VOD_CACHE_FILE = path.join(__dirname, 'vod-cache.json');

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

// M3U8 URL patterns to intercept
const M3U8_PATTERNS = [
  /tasteful-wire\.workers\.dev.*\.m3u8/,
  /daring-look\.workers\.dev.*\.m3u8/,
  /cloudspark.*\.m3u8/,
  /megafiles\.store.*\.m3u8/,
  /\.m3u8(\?|$)/,
];

// VOD cache
let vodCache = {
  lastUpdate: null,
  movies: [],
  extractedStreams: {} // tmdbId -> { url, extractedAt, ... }
};

// Load cache from disk
function loadCache() {
  try {
    if (fs.existsSync(VOD_CACHE_FILE)) {
      const data = fs.readFileSync(VOD_CACHE_FILE, 'utf8');
      vodCache = JSON.parse(data);
      console.log(`[vod-builder] Loaded cache with ${vodCache.movies.length} movies, ${Object.keys(vodCache.extractedStreams).length} extracted streams`);
    }
  } catch (err) {
    console.error('[vod-builder] Error loading cache:', err.message);
  }
}

// Save cache to disk
function saveCache() {
  try {
    fs.writeFileSync(VOD_CACHE_FILE, JSON.stringify(vodCache, null, 2));
    console.log(`[vod-builder] Saved cache with ${vodCache.movies.length} movies`);
  } catch (err) {
    console.error('[vod-builder] Error saving cache:', err.message);
  }
}

// Genre tabs available on Cineby homepage (visible in UI)
const GENRE_TABS = [
  'Most popular', 'Most rating', 'Most recent',
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary',
  'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music',
  'Mystery', 'Romance', 'Sci-Fi', 'TV Movie', 'Thriller', 'War', 'Western'
];

// Fetch all movies from Cineby using Chrome CDP browser navigation
// Navigates to homepage, clicks each genre tab, and extracts movies from DOM/NEXT_DATA
async function fetchAllMoviesFromApi(options = {}) {
  const { browseGenres = true, scrollsPerGenre = 3 } = options;

  console.log('[vod-builder] Fetching all movies from Cineby via browser navigation...');

  let browser;
  let page;
  let createdNewPage = false;

  try {
    browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
    const contexts = browser.contexts();
    const context = contexts[0];
    const pages = context.pages();

    // Find existing Cineby page or create new one
    page = pages.find(p => p.url().includes('cineby.gd'));

    if (!page) {
      console.log('[vod-builder] No Cineby page found, creating new tab...');
      page = await context.newPage();
      createdNewPage = true;
    }

    // Navigate to Cineby homepage
    console.log('[vod-builder] Navigating to Cineby homepage...');
    await page.goto('https://www.cineby.gd', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('[vod-builder] Cineby homepage loaded');

    // Wait for page to fully render
    await page.waitForTimeout(2000);

    const allMovies = new Map(); // Use Map to dedupe by tmdbId

    // Helper to extract movies from current page state
    const extractMoviesFromPage = async (source) => {
      return await page.evaluate((src) => {
        const movies = [];

        // Method 1: Extract from __NEXT_DATA__ (most reliable)
        const nextDataScript = document.getElementById('__NEXT_DATA__');
        if (nextDataScript) {
          try {
            const nextData = JSON.parse(nextDataScript.textContent);
            const pageProps = nextData.props?.pageProps || {};

            // Extract from various section types
            const extractFromSections = (sections) => {
              if (!sections) return;
              for (const section of sections) {
                if (section.movies) {
                  for (const movie of section.movies) {
                    if (movie.mediaType === 'movie') {
                      movies.push({
                        id: movie.id,
                        title: movie.title || movie.name,
                        release_date: movie.release_date,
                        genre_ids: movie.genre_ids || [],
                        mediaType: movie.mediaType,
                        poster: movie.poster,
                        image: movie.image,
                        rating: movie.rating,
                        description: movie.description,
                        _source: src
                      });
                    }
                  }
                }
              }
            };

            extractFromSections(pageProps.genreSections);
            extractFromSections(pageProps.trendingSections);
            extractFromSections(pageProps.defaultSections);

            // Also check for direct movies array (genre pages)
            if (pageProps.movies) {
              for (const movie of pageProps.movies) {
                if (movie.mediaType === 'movie') {
                  movies.push({
                    id: movie.id,
                    title: movie.title || movie.name,
                    release_date: movie.release_date,
                    genre_ids: movie.genre_ids || [],
                    mediaType: movie.mediaType,
                    poster: movie.poster,
                    image: movie.image,
                    rating: movie.rating,
                    description: movie.description,
                    _source: src
                  });
                }
              }
            }
          } catch (e) {
            console.log('[vod-builder] Error parsing __NEXT_DATA__:', e.message);
          }
        }

        // Method 2: Scrape from DOM as fallback
        if (movies.length === 0) {
          const movieCards = document.querySelectorAll('a[href^="/movie/"]');
          for (const card of movieCards) {
            const href = card.getAttribute('href');
            const match = href.match(/\/movie\/(\d+)/);
            if (match) {
              const tmdbId = parseInt(match[1]);
              const img = card.querySelector('img');
              const title = img?.alt || card.textContent?.trim() || `Movie ${tmdbId}`;
              movies.push({
                id: tmdbId,
                title,
                mediaType: 'movie',
                poster: img?.src || null,
                _source: src
              });
            }
          }
        }

        return movies;
      }, source);
    };

    // Extract movies from homepage
    console.log('[vod-builder] Extracting movies from homepage...');
    const homeMovies = await extractMoviesFromPage('Homepage');
    for (const movie of homeMovies) {
      allMovies.set(movie.id, movie);
    }
    console.log(`[vod-builder] Homepage: ${homeMovies.length} movies (total unique: ${allMovies.size})`);

    // Browse each genre tab if enabled
    if (browseGenres) {
      // Find all genre tab buttons
      const genreTabs = await page.evaluate(() => {
        const tabs = [];
        // Look for tab buttons in the tab bar
        const tabContainer = document.querySelector('.flex.overflow-x-auto') ||
                            document.querySelector('[class*="tab"]') ||
                            document.querySelector('nav');

        if (tabContainer) {
          const buttons = tabContainer.querySelectorAll('button, a');
          for (const btn of buttons) {
            const text = btn.textContent?.trim();
            if (text && text.length > 0 && text.length < 30) {
              tabs.push(text);
            }
          }
        }

        // Also look for visible genre links/buttons
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
          const text = btn.textContent?.trim();
          if (text && ['Action', 'Comedy', 'Drama', 'Horror', 'Thriller', 'Sci-Fi',
                       'Adventure', 'Animation', 'Crime', 'Documentary', 'Family',
                       'Fantasy', 'History', 'Music', 'Mystery', 'Romance', 'War', 'Western',
                       'Most popular', 'Most rating', 'Most recent'].includes(text)) {
            if (!tabs.includes(text)) tabs.push(text);
          }
        }

        return tabs;
      });

      console.log(`[vod-builder] Found ${genreTabs.length} genre tabs: ${genreTabs.join(', ')}`);

      // Click each genre tab and extract movies
      for (const genreName of genreTabs) {
        try {
          console.log(`[vod-builder] Clicking genre tab: ${genreName}`);

          // Click the genre tab button
          const clicked = await page.evaluate((name) => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
              if (btn.textContent?.trim() === name) {
                btn.click();
                return true;
              }
            }
            return false;
          }, genreName);

          if (!clicked) {
            console.log(`[vod-builder] Could not find tab button for: ${genreName}`);
            continue;
          }

          // Wait for content to load
          await page.waitForTimeout(1500);

          // Scroll to load more movies (infinite scroll)
          for (let scroll = 0; scroll < scrollsPerGenre; scroll++) {
            await page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(1000);
          }

          // Extract movies from this genre
          const genreMovies = await extractMoviesFromPage(genreName);
          let newCount = 0;
          for (const movie of genreMovies) {
            if (!allMovies.has(movie.id)) {
              allMovies.set(movie.id, movie);
              newCount++;
            }
          }
          console.log(`[vod-builder] ${genreName}: ${genreMovies.length} movies (${newCount} new, total unique: ${allMovies.size})`);

          // Scroll back to top for next tab
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(500);

        } catch (e) {
          console.log(`[vod-builder] Error processing genre ${genreName}:`, e.message);
        }
      }
    }

    // Convert Map to array and format movies
    const movies = [];
    for (const [tmdbId, movie] of allMovies) {
      const genreNames = (movie.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean);
      const year = movie.release_date ? parseInt(movie.release_date.split('-')[0]) : null;
      movies.push({
        tmdbId: movie.id,
        title: movie.title || movie.name,
        year,
        releaseDate: movie.release_date || null,
        genreIds: movie.genre_ids || [],
        genres: genreNames,
        mediaType: movie.mediaType || 'movie',
        poster: movie.poster || null,
        backdrop: movie.image || null,
        rating: movie.rating || 0,
        description: movie.description || '',
        section: movie._source || 'Unknown',
        cinebyUrl: `${CINEBY_BASE}/movie/${movie.id}`
      });
    }

    // Close page if we created it
    if (createdNewPage && page) {
      try {
        await page.close();
        console.log('[vod-builder] Closed temporary Cineby tab');
      } catch (e) {
        // Page might already be closed
      }
    }

    console.log(`[vod-builder] Fetched ${movies.length} total unique movies via browser navigation`);
    return movies;

  } catch (error) {
    console.error('[vod-builder] Error fetching from Cineby:', error.message);
    return null;
  }
}

// Extract m3u8 URL for a single movie
async function extractStreamForMovie(browser, movie, timeout = 35000) {
  let page;

  try {
    const contexts = browser.contexts();
    const context = contexts[0];

    // Create a new page for extraction
    page = await context.newPage();

    console.log(`[vod-builder] Extracting stream for: ${movie.title} (${movie.tmdbId})`);

    // Set up network interception to capture m3u8 URL
    const m3u8Promise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for m3u8 URL'));
      }, timeout);

      page.on('request', (request) => {
        const url = request.url();
        for (const pattern of M3U8_PATTERNS) {
          if (pattern.test(url)) {
            console.log(`[vod-builder] Found m3u8 for ${movie.title}: ${url.substring(0, 80)}...`);
            clearTimeout(timeoutId);
            resolve(url);
            return;
          }
        }
      });

      // Also check responses for m3u8 content-type
      page.on('response', async (response) => {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('mpegurl') || contentType.includes('m3u8')) {
          const url = response.url();
          console.log(`[vod-builder] Found m3u8 via content-type for ${movie.title}: ${url.substring(0, 80)}...`);
          clearTimeout(timeoutId);
          resolve(url);
        }
      });
    });

    // Navigate to movie page with ?play=true to auto-start playback
    const movieUrl = `${CINEBY_BASE}/movie/${movie.tmdbId}?play=true`;

    await page.goto(movieUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    // Click the play button if it exists
    try {
      const playButton = page.locator('#ButtonPlay, [data-testid="play-button"], button:has-text("Play")').first();
      if (await playButton.isVisible({ timeout: 3000 })) {
        console.log(`[vod-builder] Clicking play button for ${movie.title}`);
        await playButton.click();
      }
    } catch (e) {
      // Play button might not exist or video might auto-play
    }

    // Wait for m3u8 URL
    const m3u8Url = await m3u8Promise;

    return {
      success: true,
      url: m3u8Url,
      extractedAt: Date.now()
    };

  } catch (error) {
    console.error(`[vod-builder] Error extracting ${movie.title}:`, error.message);
    return {
      success: false,
      error: error.message,
      extractedAt: Date.now()
    };
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

// Batch extract streams for all movies
async function batchExtractStreams(movies, options = {}) {
  const {
    concurrency = 1,  // Extract one at a time to avoid overwhelming the browser
    delayBetween = 3000,  // Delay between extractions (ms)
    skipCached = true,  // Skip movies that already have cached streams
    maxAge = 24 * 60 * 60 * 1000  // Max age for cached streams (24 hours)
  } = options;

  console.log(`[vod-builder] Starting batch extraction for ${movies.length} movies`);

  let browser;
  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    streams: {}
  };

  try {
    browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);

    for (let i = 0; i < movies.length; i++) {
      const movie = movies[i];

      // Check if we should skip this movie
      if (skipCached) {
        const cached = vodCache.extractedStreams[movie.tmdbId];
        if (cached && cached.success && (Date.now() - cached.extractedAt) < maxAge) {
          console.log(`[vod-builder] Skipping ${movie.title} (cached)`);
          results.skipped++;
          results.streams[movie.tmdbId] = cached;
          continue;
        }
      }

      console.log(`[vod-builder] Processing ${i + 1}/${movies.length}: ${movie.title}`);

      const result = await extractStreamForMovie(browser, movie);
      results.streams[movie.tmdbId] = result;

      if (result.success) {
        results.success++;
        // Update cache immediately
        vodCache.extractedStreams[movie.tmdbId] = result;
        saveCache();
      } else {
        results.failed++;
      }

      // Delay between extractions
      if (i < movies.length - 1) {
        await new Promise(r => setTimeout(r, delayBetween));
      }
    }

  } catch (error) {
    console.error('[vod-builder] Batch extraction error:', error.message);
  }

  console.log(`[vod-builder] Batch extraction complete: ${results.success} success, ${results.failed} failed, ${results.skipped} skipped`);
  return results;
}

// Build full VOD playlist with metadata
async function buildVodPlaylist(host) {
  console.log('[vod-builder] Building VOD playlist...');

  // Ensure we have movies
  if (!vodCache.movies || vodCache.movies.length === 0) {
    const movies = await fetchAllMoviesFromApi();
    if (movies) {
      vodCache.movies = movies;
      vodCache.lastUpdate = Date.now();
      saveCache();
    }
  }

  let m3u = '#EXTM3U\n';
  m3u += '# Cineby VOD Playlist\n';
  m3u += `# Generated: ${new Date().toISOString()}\n`;
  m3u += `# Total Movies: ${vodCache.movies.length}\n`;
  m3u += `# Extracted Streams: ${Object.keys(vodCache.extractedStreams).filter(k => vodCache.extractedStreams[k].success).length}\n\n`;

  // Group movies by genre
  const byGenre = {};

  for (const movie of vodCache.movies) {
    const stream = vodCache.extractedStreams[movie.tmdbId];

    // Skip movies without extracted streams
    if (!stream || !stream.success) continue;

    // Use first genre or 'Other'
    const genre = movie.genres[0] || 'Other';
    if (!byGenre[genre]) byGenre[genre] = [];
    byGenre[genre].push(movie);
  }

  // Sort genres alphabetically
  const sortedGenres = Object.keys(byGenre).sort();

  for (const genre of sortedGenres) {
    const movies = byGenre[genre];

    // Sort movies by title within genre
    movies.sort((a, b) => a.title.localeCompare(b.title));

    for (const movie of movies) {
      const poster = movie.poster || '';
      const yearStr = movie.year ? ` (${movie.year})` : '';
      const ratingStr = movie.rating ? ` [${movie.rating.toFixed(1)}]` : '';

      // EXTINF with full metadata
      // Format: #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Display Name
      m3u += `#EXTINF:-1 tvg-id="cineby-${movie.tmdbId}" `;
      m3u += `tvg-name="${movie.title}" `;
      m3u += `tvg-logo="${poster}" `;
      m3u += `group-title="Movies - ${genre}" `;

      // Additional VOD metadata as custom tags
      m3u += `tvg-year="${movie.year || ''}" `;
      m3u += `tvg-rating="${movie.rating || ''}" `;
      m3u += `tvg-genres="${movie.genres.join(',')}" `;

      m3u += `,${movie.title}${yearStr}${ratingStr}\n`;

      // Stream URL through our proxy
      m3u += `http://${host}/cineby/${movie.tmdbId}/stream\n`;
    }
  }

  return m3u;
}

// Build VOD playlist in JSON format (for apps that support richer metadata)
async function buildVodJson() {
  // Ensure we have movies
  if (!vodCache.movies || vodCache.movies.length === 0) {
    const movies = await fetchAllMoviesFromApi();
    if (movies) {
      vodCache.movies = movies;
      vodCache.lastUpdate = Date.now();
      saveCache();
    }
  }

  const vodList = [];

  for (const movie of vodCache.movies) {
    const stream = vodCache.extractedStreams[movie.tmdbId];

    vodList.push({
      id: movie.tmdbId,
      title: movie.title,
      year: movie.year,
      releaseDate: movie.releaseDate,
      genres: movie.genres,
      genreIds: movie.genreIds,
      rating: movie.rating,
      description: movie.description,
      poster: movie.poster,
      backdrop: movie.backdrop,
      mediaType: movie.mediaType,
      cinebyUrl: movie.cinebyUrl,
      hasStream: stream && stream.success,
      streamExtractedAt: stream ? stream.extractedAt : null
    });
  }

  return {
    generated: new Date().toISOString(),
    totalMovies: vodList.length,
    moviesWithStreams: vodList.filter(m => m.hasStream).length,
    movies: vodList
  };
}

// Update movie catalog from API
async function updateCatalog() {
  const movies = await fetchAllMoviesFromApi();
  if (movies && movies.length > 0) {
    vodCache.movies = movies;
    vodCache.lastUpdate = Date.now();
    saveCache();
    return movies;
  }
  return vodCache.movies;
}

// Get extraction status
function getExtractionStatus() {
  const total = vodCache.movies.length;
  const extracted = Object.keys(vodCache.extractedStreams).filter(k => vodCache.extractedStreams[k].success).length;
  const failed = Object.keys(vodCache.extractedStreams).filter(k => !vodCache.extractedStreams[k].success).length;
  const pending = total - extracted - failed;

  return {
    total,
    extracted,
    failed,
    pending,
    lastUpdate: vodCache.lastUpdate,
    cacheFile: VOD_CACHE_FILE
  };
}

// Get cached stream URL for a movie
function getCachedStream(tmdbId) {
  const stream = vodCache.extractedStreams[tmdbId];
  if (stream && stream.success) {
    return stream.url;
  }
  return null;
}

// Get all movies with metadata
function getAllMoviesWithMetadata() {
  return vodCache.movies.map(movie => ({
    ...movie,
    hasStream: vodCache.extractedStreams[movie.tmdbId]?.success || false,
    streamUrl: vodCache.extractedStreams[movie.tmdbId]?.url || null
  }));
}

// Initialize on load
loadCache();

module.exports = {
  fetchAllMoviesFromApi,
  extractStreamForMovie,
  batchExtractStreams,
  buildVodPlaylist,
  buildVodJson,
  updateCatalog,
  getExtractionStatus,
  getCachedStream,
  getAllMoviesWithMetadata,
  loadCache,
  saveCache
};
