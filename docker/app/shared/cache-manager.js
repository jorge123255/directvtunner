// Unified Cache Manager - Multi-provider VOD cache
// Supports multiple streaming sites with isolated namespaces

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'vod-cache-unified.json');
const OLD_CACHE_FILE = path.join(__dirname, '..', 'vod-cache.json');

// Default cache structure
const DEFAULT_CACHE = {
  version: 2,
  lastUpdate: null,
  providers: {}
};

// Default provider structure
const DEFAULT_PROVIDER_CACHE = {
  catalog: { lastFetch: null, movies: [], tv: [] },
  streams: {}
};

class CacheManager {
  constructor() {
    this.cache = this.load();
  }

  // Load cache from disk
  load() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (data.version === 2) {
          console.log('[cache] Loaded unified cache');
          return data;
        }
      }
    } catch (err) {
      console.error('[cache] Error loading cache:', err.message);
    }

    // Check for old cache to migrate
    if (fs.existsSync(OLD_CACHE_FILE)) {
      console.log('[cache] Found old cache, will migrate on first save');
    }

    return { ...DEFAULT_CACHE };
  }

  // Save cache to disk
  save() {
    this.cache.lastUpdate = Date.now();
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch (err) {
      console.error('[cache] Error saving cache:', err.message);
    }
  }

  // Get provider-specific cache, creating if needed
  getProviderCache(providerId) {
    if (!this.cache.providers[providerId]) {
      this.cache.providers[providerId] = JSON.parse(JSON.stringify(DEFAULT_PROVIDER_CACHE));
    }
    return this.cache.providers[providerId];
  }

  // ========== Catalog Operations ==========

  // Set catalog for a provider
  setCatalog(providerId, catalog) {
    const providerCache = this.getProviderCache(providerId);
    providerCache.catalog = {
      lastFetch: Date.now(),
      movies: catalog.movies || [],
      tv: catalog.tv || []
    };
    this.save();
    console.log(`[cache] Saved catalog for ${providerId}: ${providerCache.catalog.movies.length} movies`);
  }

  // Get catalog for a provider (with TTL check)
  getCatalog(providerId, maxAge = 60 * 60 * 1000) {
    const providerCache = this.getProviderCache(providerId);
    if (providerCache.catalog.lastFetch &&
        (Date.now() - providerCache.catalog.lastFetch) < maxAge) {
      return providerCache.catalog;
    }
    return null; // Expired or not set
  }

  // Get catalog even if expired (for fallback)
  getCatalogAnyAge(providerId) {
    const providerCache = this.getProviderCache(providerId);
    if (providerCache.catalog.lastFetch) {
      return providerCache.catalog;
    }
    return null;
  }

  // Get movie from catalog
  getMovie(providerId, contentId) {
    const providerCache = this.getProviderCache(providerId);
    const id = contentId.toString();
    return providerCache.catalog.movies.find(m =>
      m.id === id || m.tmdbId?.toString() === id
    ) || null;
  }

  // ========== Stream URL Operations ==========

  // Set stream URL for a content item
  setStreamUrl(providerId, contentId, url, ttl = 24 * 60 * 60 * 1000) {
    const providerCache = this.getProviderCache(providerId);
    providerCache.streams[contentId] = {
      success: true,
      url,
      extractedAt: Date.now(),
      expiresAt: Date.now() + ttl
    };
    this.save();
  }

  // Set stream extraction failure
  setStreamError(providerId, contentId, error) {
    const providerCache = this.getProviderCache(providerId);
    providerCache.streams[contentId] = {
      success: false,
      error: error.message || error,
      extractedAt: Date.now(),
      expiresAt: Date.now() + (60 * 60 * 1000) // Retry in 1 hour
    };
    this.save();
  }

  // Get stream URL (returns null if expired)
  getStreamUrl(providerId, contentId) {
    const providerCache = this.getProviderCache(providerId);
    const stream = providerCache.streams[contentId];
    if (stream && stream.success && Date.now() < stream.expiresAt) {
      return stream.url;
    }
    return null;
  }

  // Check if stream was already attempted (even if failed)
  hasStreamAttempt(providerId, contentId) {
    const providerCache = this.getProviderCache(providerId);
    const stream = providerCache.streams[contentId];
    return stream && Date.now() < stream.expiresAt;
  }

  // ========== Statistics ==========

  // Get status for all providers
  getStatus() {
    const status = {};
    for (const [providerId, data] of Object.entries(this.cache.providers)) {
      const streams = data.streams || {};
      const now = Date.now();

      const validStreams = Object.values(streams).filter(s => s.success && now < s.expiresAt).length;
      const failedStreams = Object.values(streams).filter(s => !s.success).length;
      const totalMovies = data.catalog?.movies?.length || 0;

      status[providerId] = {
        catalogSize: totalMovies,
        catalogAge: data.catalog?.lastFetch ? Math.round((now - data.catalog.lastFetch) / 1000) : null,
        extractedStreams: validStreams,
        failedStreams,
        pendingStreams: totalMovies - validStreams - failedStreams
      };
    }
    return status;
  }

  // Get status for a specific provider
  getProviderStatus(providerId) {
    const data = this.cache.providers[providerId];
    if (!data) return null;

    const streams = data.streams || {};
    const now = Date.now();

    const validStreams = Object.values(streams).filter(s => s.success && now < s.expiresAt).length;
    const failedStreams = Object.values(streams).filter(s => !s.success).length;
    const totalMovies = data.catalog?.movies?.length || 0;

    return {
      catalogSize: totalMovies,
      catalogAge: data.catalog?.lastFetch ? Math.round((now - data.catalog.lastFetch) / 1000) : null,
      extractedStreams: validStreams,
      failedStreams,
      pendingStreams: totalMovies - validStreams - failedStreams
    };
  }

  // ========== Migration ==========

  // Migrate from old vod-cache.json format
  migrateFromOldCache() {
    if (!fs.existsSync(OLD_CACHE_FILE)) {
      console.log('[cache] No old cache to migrate');
      return false;
    }

    try {
      const oldData = JSON.parse(fs.readFileSync(OLD_CACHE_FILE, 'utf8'));

      // Create Cineby provider cache from old format
      this.cache.providers.cineby = {
        catalog: {
          lastFetch: oldData.lastUpdate || Date.now(),
          movies: oldData.movies || [],
          tv: []
        },
        streams: {}
      };

      // Migrate extracted streams
      for (const [tmdbId, stream] of Object.entries(oldData.extractedStreams || {})) {
        if (stream.success) {
          this.cache.providers.cineby.streams[tmdbId] = {
            success: true,
            url: stream.url,
            extractedAt: stream.extractedAt,
            expiresAt: stream.extractedAt + (24 * 60 * 60 * 1000)
          };
        } else {
          this.cache.providers.cineby.streams[tmdbId] = {
            success: false,
            error: stream.error || 'Unknown error',
            extractedAt: stream.extractedAt,
            expiresAt: stream.extractedAt + (60 * 60 * 1000)
          };
        }
      }

      this.save();
      console.log(`[cache] Migrated old cache: ${oldData.movies?.length || 0} movies, ${Object.keys(oldData.extractedStreams || {}).length} streams`);
      return true;

    } catch (err) {
      console.error('[cache] Migration error:', err.message);
      return false;
    }
  }

  // ========== Utilities ==========

  // Clear all cache for a provider
  clearProvider(providerId) {
    delete this.cache.providers[providerId];
    this.save();
  }

  // Clear all cache
  clearAll() {
    this.cache = { ...DEFAULT_CACHE };
    this.save();
  }

  // Get movies with stream status
  getMoviesWithStreamStatus(providerId) {
    const providerCache = this.getProviderCache(providerId);
    const now = Date.now();

    return providerCache.catalog.movies.map(movie => {
      const stream = providerCache.streams[movie.tmdbId];
      return {
        ...movie,
        hasStream: stream && stream.success && now < stream.expiresAt,
        streamExtractedAt: stream?.extractedAt || null
      };
    });
  }
}

// Singleton instance
const cacheManager = new CacheManager();

// Auto-migrate on first load
if (!cacheManager.cache.providers.cineby && fs.existsSync(OLD_CACHE_FILE)) {
  cacheManager.migrateFromOldCache();
}

module.exports = cacheManager;
