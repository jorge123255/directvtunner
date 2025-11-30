#!/usr/bin/env node
/**
 * Cineby TV Show Database Manager
 * - Fetches TV shows from TMDB API
 * - Deduplicates across categories
 * - Supports incremental updates (hourly for new episodes)
 * - Generates M3U playlist
 * - Uses CinemaOS scraper API for streams
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  // TMDB API (public key used by many apps)
  tmdbApiKey: 'd56e51fb77b081a9cb5192eaaa7823ad',
  tmdbBase: 'https://api.themoviedb.org/3',

  // TV categories to fetch
  categories: [
    { id: 'popular', endpoint: '/tv/popular' },
    { id: 'top_rated', endpoint: '/tv/top_rated' },
    { id: 'on_the_air', endpoint: '/tv/on_the_air' },
    { id: 'airing_today', endpoint: '/tv/airing_today' }
  ],

  language: 'en-US',

  // Paths
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  dbFile: 'cineby-tv-db.json',
  m3uFile: 'cineby-tv.m3u',

  // Fetch settings
  delayBetweenRequests: 250, // ms - TMDB rate limit friendly
  maxPagesPerCategory: 100,  // Safety limit

  // Tuner host for M3U URLs
  tunerHost: process.env.TUNER_HOST || 'localhost:7070'
};

// TV Genre mapping (TMDB)
const GENRES = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western'
};

class CinebyTVManager {
  constructor() {
    this.shows = new Map();  // id -> show
    this.lastUpdate = null;
    this.stats = {
      total: 0,
      new: 0,
      updated: 0,
      categories: {}
    };

    // Auto-refresh state
    this.autoRefreshTimer = null;
    this.autoRefreshEnabled = false;
    this.autoRefreshInterval = null;
    this.nextAutoUpdate = null;
  }

  // Load existing database
  loadDatabase() {
    const dbPath = path.join(CONFIG.dataDir, CONFIG.dbFile);

    if (fs.existsSync(dbPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        this.lastUpdate = data.lastUpdate;

        for (const show of data.shows || []) {
          this.shows.set(show.id, show);
        }

        console.log(`[tv-db] Loaded ${this.shows.size} TV shows from database`);
        console.log(`[tv-db] Last update: ${this.lastUpdate || 'never'}`);
        return true;
      } catch (err) {
        console.error('[tv-db] Error loading database:', err.message);
      }
    }

    console.log('[tv-db] No existing database found, starting fresh');
    return false;
  }

  // Save database
  saveDatabase() {
    if (!fs.existsSync(CONFIG.dataDir)) {
      fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    }

    const dbPath = path.join(CONFIG.dataDir, CONFIG.dbFile);
    const data = {
      lastUpdate: new Date().toISOString(),
      totalShows: this.shows.size,
      stats: this.stats,
      shows: Array.from(this.shows.values())
    };

    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    console.log(`[tv-db] Saved ${this.shows.size} TV shows to database`);
  }

  // Fetch from TMDB API
  async fetchTMDB(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
      const queryParams = new URLSearchParams({
        api_key: CONFIG.tmdbApiKey,
        language: CONFIG.language,
        ...params
      });

      const url = `${CONFIG.tmdbBase}${endpoint}?${queryParams}`;

      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      }).on('error', reject);
    });
  }

  // Get show details including seasons/episodes
  async fetchShowDetails(showId) {
    try {
      const details = await this.fetchTMDB(`/tv/${showId}`, {
        append_to_response: 'external_ids'
      });
      return details;
    } catch (err) {
      console.error(`[tv-db] Error fetching details for ${showId}:`, err.message);
      return null;
    }
  }

  // Process and deduplicate a TV show
  processShow(show, category, details = null) {
    const existing = this.shows.get(show.id);

    const processed = {
      id: show.id,
      name: show.name || show.original_name,
      originalName: show.original_name,
      firstAirDate: show.first_air_date,
      year: show.first_air_date ? show.first_air_date.split('-')[0] : null,
      overview: show.overview,
      poster: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : null,
      backdrop: show.backdrop_path ? `https://image.tmdb.org/t/p/w1280${show.backdrop_path}` : null,
      rating: show.vote_average,
      voteCount: show.vote_count,
      popularity: show.popularity,
      genres: (show.genre_ids || []).map(id => GENRES[id]).filter(g => g),
      originCountry: show.origin_country || [],
      language: show.original_language,

      // Season/episode info (from details if available)
      numberOfSeasons: details?.number_of_seasons || existing?.numberOfSeasons || null,
      numberOfEpisodes: details?.number_of_episodes || existing?.numberOfEpisodes || null,
      status: details?.status || existing?.status || null,
      lastEpisodeToAir: details?.last_episode_to_air || existing?.lastEpisodeToAir || null,
      nextEpisodeToAir: details?.next_episode_to_air || existing?.nextEpisodeToAir || null,

      // External IDs
      imdbId: details?.external_ids?.imdb_id || existing?.imdbId || null,

      categories: existing ? [...new Set([...existing.categories, category])] : [category],
      addedAt: existing ? existing.addedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existing) {
      this.stats.updated++;
    } else {
      this.stats.new++;
    }

    this.shows.set(show.id, processed);
    return processed;
  }

  // Fetch all shows from a category
  async fetchCategory(category, incrementalMode = false) {
    console.log(`\n[tv-fetch] Category: ${category.id}`);

    let page = 1;
    let totalPages = 1;
    let newInCategory = 0;
    let consecutiveExisting = 0;
    const maxConsecutiveExisting = 2; // Stop if 2 pages have no new shows

    while (page <= totalPages && page <= CONFIG.maxPagesPerCategory) {
      try {
        const data = await this.fetchTMDB(category.endpoint, { page });

        if (page === 1) {
          totalPages = Math.min(data.total_pages || 1, CONFIG.maxPagesPerCategory);
          console.log(`[tv-fetch] Total pages: ${totalPages}`);
        }

        const results = data.results || [];
        let newOnPage = 0;

        for (const show of results) {
          const wasNew = !this.shows.has(show.id);
          this.processShow(show, category.id);
          if (wasNew) {
            newOnPage++;
            newInCategory++;
          }
        }

        // Progress
        if (page % 5 === 0 || page === totalPages) {
          console.log(`[tv-fetch] ${category.id}: page ${page}/${totalPages} - ${newOnPage} new this page, ${newInCategory} new total`);
        }

        // Incremental mode: stop early if no new shows
        if (incrementalMode) {
          if (newOnPage === 0) {
            consecutiveExisting++;
            if (consecutiveExisting >= maxConsecutiveExisting) {
              console.log(`[tv-fetch] ${category.id}: stopping early - ${maxConsecutiveExisting} pages with no new shows`);
              break;
            }
          } else {
            consecutiveExisting = 0;
          }
        }

        page++;
        await this.sleep(CONFIG.delayBetweenRequests);

      } catch (err) {
        console.error(`[tv-fetch] Error on page ${page}:`, err.message);
        page++;
      }
    }

    this.stats.categories[category.id] = {
      pagesScanned: page - 1,
      newShows: newInCategory
    };

    console.log(`[tv-fetch] ${category.id}: completed - ${newInCategory} new shows from ${page - 1} pages`);
    return newInCategory;
  }

  // Full fetch of all categories
  async fullFetch() {
    console.log('\n' + '='.repeat(60));
    console.log('FULL TV DATABASE FETCH');
    console.log('='.repeat(60));

    this.stats = { total: 0, new: 0, updated: 0, categories: {} };
    const startCount = this.shows.size;

    for (const category of CONFIG.categories) {
      await this.fetchCategory(category, false);
    }

    this.stats.total = this.shows.size;
    this.stats.new = this.shows.size - startCount;

    console.log('\n' + '='.repeat(60));
    console.log(`COMPLETE: ${this.shows.size} total TV shows (${this.stats.new} new)`);
    console.log('='.repeat(60));

    this.saveDatabase();
    return this.stats;
  }

  // Incremental update - only look for new shows
  async incrementalUpdate() {
    console.log('\n' + '='.repeat(60));
    console.log('INCREMENTAL TV UPDATE');
    console.log('='.repeat(60));

    this.loadDatabase();

    this.stats = { total: this.shows.size, new: 0, updated: 0, categories: {} };
    const startCount = this.shows.size;

    for (const category of CONFIG.categories) {
      await this.fetchCategory(category, true);
    }

    this.stats.total = this.shows.size;
    this.stats.new = this.shows.size - startCount;

    console.log('\n' + '='.repeat(60));
    console.log(`COMPLETE: ${this.shows.size} total TV shows (${this.stats.new} new added)`);
    console.log('='.repeat(60));

    if (this.stats.new > 0 || this.stats.updated > 0) {
      this.saveDatabase();
    } else {
      console.log('[tv-db] No changes, skipping save');
    }

    return this.stats;
  }

  // Generate M3U playlist
  generateM3U(options = {}) {
    const {
      maxShows = 0,
      minRating = 0,
      minVotes = 0,
      genres = [],
      sortBy = 'popularity'
    } = options;

    let shows = Array.from(this.shows.values());

    // Filter
    if (minRating > 0) {
      shows = shows.filter(s => (s.rating || 0) >= minRating);
    }
    if (minVotes > 0) {
      shows = shows.filter(s => (s.voteCount || 0) >= minVotes);
    }
    if (genres.length > 0) {
      shows = shows.filter(s => s.genres.some(g => genres.includes(g)));
    }

    // Sort
    if (sortBy === 'popularity') {
      shows.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    } else if (sortBy === 'rating') {
      shows.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === 'year') {
      shows.sort((a, b) => (b.year || '0').localeCompare(a.year || '0'));
    } else if (sortBy === 'name') {
      shows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    // Limit
    if (maxShows > 0) {
      shows = shows.slice(0, maxShows);
    }

    // Generate M3U - each show links to S01E01 by default
    const lines = ['#EXTM3U', `#PLAYLIST:Cineby TV Shows (${shows.length})`, ''];

    for (const show of shows) {
      const displayTitle = show.year ? `${show.name} (${show.year})` : show.name;
      const groupTitle = show.genres.join(';') || 'TV Shows';

      lines.push(
        `#EXTINF:-1 tvg-id="cineby-tv-${show.id}" ` +
        `tvg-name="${this.escapeM3U(displayTitle)}" ` +
        `tvg-logo="${show.poster || ''}" ` +
        `group-title="${groupTitle}" ` +
        `tvg-rating="${show.rating || ''}",${displayTitle}`
      );

      // Stream URL - default to S01E01
      const streamUrl = `http://${CONFIG.tunerHost}/vod/cinemaos/${show.id}/stream` +
        `?mediaType=tv` +
        `&title=${encodeURIComponent(show.name || '')}` +
        `&year=${show.year || ''}` +
        `&season=1&episode=1`;

      lines.push(streamUrl);
      lines.push('');
    }

    const m3u = lines.join('\n');
    const m3uPath = path.join(CONFIG.dataDir, CONFIG.m3uFile);
    fs.writeFileSync(m3uPath, m3u);

    console.log(`[tv-m3u] Generated playlist with ${shows.length} TV shows`);
    console.log(`[tv-m3u] Saved to ${m3uPath}`);

    return {
      totalShows: shows.length,
      filePath: m3uPath,
      fileSize: fs.statSync(m3uPath).size
    };
  }

  escapeM3U(str) {
    if (!str) return '';
    return str.replace(/"/g, "'").replace(/\n/g, ' ').trim();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get database stats
  getStats() {
    const shows = Array.from(this.shows.values());

    const genreCounts = {};
    const yearCounts = {};
    const statusCounts = {};

    for (const show of shows) {
      for (const genre of show.genres || []) {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      }
      if (show.year) {
        yearCounts[show.year] = (yearCounts[show.year] || 0) + 1;
      }
      if (show.status) {
        statusCounts[show.status] = (statusCounts[show.status] || 0) + 1;
      }
    }

    return {
      totalShows: this.shows.size,
      lastUpdate: this.lastUpdate,
      nextAutoUpdate: this.nextAutoUpdate || null,
      autoRefreshEnabled: this.autoRefreshEnabled || false,
      genres: genreCounts,
      years: yearCounts,
      statuses: statusCounts,
      avgRating: shows.length > 0
        ? (shows.reduce((sum, s) => sum + (s.rating || 0), 0) / shows.length).toFixed(2)
        : 0
    };
  }

  // ========== Auto-Refresh Methods ==========

  /**
   * Start automatic incremental updates
   * @param {number} intervalHours - Hours between updates (default: 1 for TV)
   */
  startAutoRefresh(intervalHours = 1) {
    if (this.autoRefreshTimer) {
      console.log('[tv-db] Auto-refresh already running');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;
    this.autoRefreshEnabled = true;
    this.autoRefreshInterval = intervalHours;

    console.log(`[tv-db] Starting auto-refresh (every ${intervalHours} hour${intervalHours > 1 ? 's' : ''})`);

    // Run first update after a short delay
    setTimeout(() => {
      this.runAutoUpdate();
    }, 60000); // 1 minute after startup

    // Then run at regular intervals
    this.autoRefreshTimer = setInterval(() => {
      this.runAutoUpdate();
    }, intervalMs);

    this.updateNextAutoUpdateTime(intervalMs);
  }

  /**
   * Stop automatic updates
   */
  stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
      this.autoRefreshEnabled = false;
      this.nextAutoUpdate = null;
      console.log('[tv-db] Auto-refresh stopped');
    }
  }

  /**
   * Run an automatic incremental update
   */
  async runAutoUpdate() {
    console.log('[tv-db] Auto-refresh: starting incremental update...');

    try {
      const stats = await this.incrementalUpdate();

      if (stats.new > 0) {
        this.generateM3U();
        console.log(`[tv-db] Auto-refresh complete: ${stats.new} new TV shows added, playlist regenerated`);
      } else {
        console.log('[tv-db] Auto-refresh complete: no new TV shows found');
      }

      // Update next run time
      if (this.autoRefreshInterval) {
        this.updateNextAutoUpdateTime(this.autoRefreshInterval * 60 * 60 * 1000);
      }

      return stats;
    } catch (error) {
      console.error('[tv-db] Auto-refresh error:', error.message);
      throw error;
    }
  }

  updateNextAutoUpdateTime(intervalMs) {
    this.nextAutoUpdate = new Date(Date.now() + intervalMs).toISOString();
  }

  getAutoRefreshStatus() {
    return {
      enabled: this.autoRefreshEnabled || false,
      intervalHours: this.autoRefreshInterval || null,
      nextUpdate: this.nextAutoUpdate || null,
      lastUpdate: this.lastUpdate || null
    };
  }
}

// Export for use as module
module.exports = CinebyTVManager;

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  const manager = new CinebyTVManager();

  async function run() {
    switch (command) {
      case 'full':
        await manager.fullFetch();
        manager.generateM3U();
        break;

      case 'update':
        await manager.incrementalUpdate();
        manager.generateM3U();
        break;

      case 'generate':
        manager.loadDatabase();
        manager.generateM3U({
          maxShows: parseInt(args[1]) || 0,
          minRating: parseFloat(args[2]) || 0
        });
        break;

      case 'stats':
        manager.loadDatabase();
        console.log(JSON.stringify(manager.getStats(), null, 2));
        break;

      case 'help':
      default:
        console.log(`
Cineby TV Database Manager

Commands:
  full      - Full fetch of all TV shows
  update    - Incremental update (only new shows, faster)
  generate  - Generate M3U from existing database
  stats     - Show database statistics

Examples:
  node cineby-tv-manager.js full
  node cineby-tv-manager.js update
  node cineby-tv-manager.js generate 500 7.0
  node cineby-tv-manager.js stats
        `);
    }
  }

  run().catch(console.error);
}
