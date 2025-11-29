// Provider Registry - Central registration and routing for all streaming site providers

const { generateCombinedPlaylist, generateProviderPlaylist } = require('../shared/m3u-generator');

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  /**
   * Register a provider
   * @param {BaseProvider} provider - Provider instance
   */
  register(provider) {
    this.providers.set(provider.id, provider);
    console.log(`[registry] Registered provider: ${provider.name} (${provider.id})`);
  }

  /**
   * Unregister a provider
   */
  unregister(providerId) {
    this.providers.delete(providerId);
  }

  /**
   * Get provider by ID
   */
  get(providerId) {
    return this.providers.get(providerId);
  }

  /**
   * Get all registered providers
   */
  getAll() {
    return Array.from(this.providers.values());
  }

  /**
   * Get provider IDs
   */
  getIds() {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if provider exists
   */
  has(providerId) {
    return this.providers.has(providerId);
  }

  /**
   * Get providers that support a specific feature
   * @param {string} feature - Feature name (e.g., 'movies', 'tv', 'live')
   */
  getByFeature(feature) {
    return this.getAll().filter(p => p.features.includes(feature));
  }

  /**
   * Get provider info for API responses
   */
  getProviderInfo() {
    return this.getAll().map(p => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      features: p.features
    }));
  }

  /**
   * Generate combined M3U playlist for all providers
   * @param {string} host - Host for stream URLs (e.g., localhost:7070)
   * @param {string[]} features - Filter by features (default: ['movies'])
   */
  async generateCombinedM3U(host, features = ['movies']) {
    const cacheManager = require('../shared/cache-manager');
    const providerCatalogs = [];

    for (const provider of this.getAll()) {
      if (features.some(f => provider.features.includes(f))) {
        // Try to get cached catalog first
        let catalog = cacheManager.getCatalogAnyAge(provider.id);

        if (!catalog) {
          try {
            catalog = await provider.fetchCatalog();
            cacheManager.setCatalog(provider.id, catalog);
          } catch (err) {
            console.error(`[registry] Error fetching catalog for ${provider.id}:`, err.message);
            continue;
          }
        }

        providerCatalogs.push({
          providerId: provider.id,
          providerName: provider.name,
          movies: catalog.movies || []
        });
      }
    }

    return generateCombinedPlaylist(providerCatalogs, host);
  }

  /**
   * Generate M3U playlist for a single provider
   */
  async generateProviderM3U(providerId, host) {
    const provider = this.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const cacheManager = require('../shared/cache-manager');
    let catalog = cacheManager.getCatalogAnyAge(providerId);

    if (!catalog) {
      catalog = await provider.fetchCatalog();
      cacheManager.setCatalog(providerId, catalog);
    }

    return generateProviderPlaylist(catalog.movies || [], providerId, host, {
      includeHeader: true,
      groupPrefix: provider.name
    });
  }

  /**
   * Extract stream URL using the appropriate provider
   */
  async extractStreamUrl(providerId, contentId, contentType = 'movie') {
    const provider = this.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const cacheManager = require('../shared/cache-manager');

    // Check persistent cache first
    const cachedUrl = cacheManager.getStreamUrl(providerId, contentId);
    if (cachedUrl) {
      console.log(`[registry] Using cached stream for ${providerId}/${contentId}`);
      return cachedUrl;
    }

    // Check in-memory cache
    const memoryCachedUrl = provider.getCachedStreamUrl(contentId);
    if (memoryCachedUrl) {
      console.log(`[registry] Using memory-cached stream for ${providerId}/${contentId}`);
      return memoryCachedUrl;
    }

    // Extract fresh URL
    console.log(`[registry] Extracting stream for ${providerId}/${contentId}`);
    const url = await provider.extractStreamUrl(contentId, contentType);

    // Cache in both places
    provider.cacheStreamUrl(contentId, url);
    cacheManager.setStreamUrl(providerId, contentId, url);

    return url;
  }

  /**
   * Get status for all providers
   */
  getStatus() {
    const cacheManager = require('../shared/cache-manager');
    const status = cacheManager.getStatus();

    // Add provider info
    for (const provider of this.getAll()) {
      if (!status[provider.id]) {
        status[provider.id] = {
          catalogSize: 0,
          catalogAge: null,
          extractedStreams: 0,
          failedStreams: 0,
          pendingStreams: 0
        };
      }
      status[provider.id].name = provider.name;
      status[provider.id].features = provider.features;
      status[provider.id].memoryCacheSize = provider.streamCache.size;
    }

    return status;
  }

  /**
   * Batch extract streams for a provider
   */
  async batchExtract(providerId, options = {}) {
    const { skipCached = true, delay = 3000, maxItems = null } = options;

    const provider = this.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const cacheManager = require('../shared/cache-manager');
    let catalog = cacheManager.getCatalogAnyAge(providerId);

    if (!catalog) {
      console.log(`[registry] Fetching catalog for batch extraction...`);
      catalog = await provider.fetchCatalog();
      cacheManager.setCatalog(providerId, catalog);
    }

    const movies = catalog.movies || [];
    const results = { success: 0, failed: 0, skipped: 0 };

    let processCount = 0;
    for (const movie of movies) {
      if (maxItems && processCount >= maxItems) break;

      // Skip if already cached
      if (skipCached && cacheManager.hasStreamAttempt(providerId, movie.tmdbId)) {
        results.skipped++;
        continue;
      }

      try {
        console.log(`[registry] Extracting ${providerId}/${movie.tmdbId}: ${movie.title}`);
        const url = await provider.extractStreamUrl(movie.tmdbId);
        cacheManager.setStreamUrl(providerId, movie.tmdbId, url);
        results.success++;
      } catch (err) {
        console.error(`[registry] Failed ${providerId}/${movie.tmdbId}:`, err.message);
        cacheManager.setStreamError(providerId, movie.tmdbId, err);
        results.failed++;
      }

      processCount++;

      // Rate limiting
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    console.log(`[registry] Batch extraction complete for ${providerId}:`, results);
    return results;
  }
}

// Singleton instance
const registry = new ProviderRegistry();

module.exports = registry;
