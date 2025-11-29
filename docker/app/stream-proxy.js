const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const tunerManager = require('./tuner-manager');
const { generateM3U, getAllChannels, getChannel } = require('./channels');
const { getAllMovies, getMovie, searchMovies, getMoviesByCategory, getCategories, generateCinebyM3U, refreshCache } = require('./cineby-movies');
const cinebyStreamer = require('./cineby-streamer');
const vodBuilder = require('./cineby-vod-builder');

// DirecTV EPG Service
const directvEpg = require('./directv-epg');

// Unified Provider System
const providerRegistry = require('./providers/provider-registry');
const cacheManager = require('./shared/cache-manager');
const CinebyProvider = require('./providers/cineby');
const CinemaOSProvider = require('./providers/cinemaos');
const OneMoviesProvider = require('./providers/onemovies');

// Register providers
providerRegistry.register(new CinebyProvider());
providerRegistry.register(new CinemaOSProvider());
providerRegistry.register(new OneMoviesProvider());

const app = express();

// Middleware for logging
app.use((req, res, next) => {
  console.log(`[server] ${req.method} ${req.url}`);
  next();
});

// CORS for IPTV clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', tuners: tunerManager.getStatus() });
});

// M3U Playlist endpoint
app.get('/playlist.m3u', (req, res) => {
  const host = req.headers.host || `${config.host}:${config.port}`;
  const m3u = generateM3U(host);

  res.setHeader('Content-Type', 'application/x-mpegurl');
  res.setHeader('Content-Disposition', 'attachment; filename="directv.m3u"');
  res.send(m3u);
});

// Channel list as JSON
app.get('/channels', (req, res) => {
  res.json(getAllChannels());
});

// Tuner status
app.get('/tuners', (req, res) => {
  res.json(tunerManager.getStatus());
});

// Stream health statistics
app.get('/stats', (req, res) => {
  const status = tunerManager.getStatus();
  const stats = {
    server: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: Date.now()
    },
    tuners: status.tuners.map(t => ({
      id: t.id,
      state: t.state,
      channel: t.channel,
      clients: t.clients,
      stream: t.stream
    }))
  };
  res.json(stats);
});

// Main stream endpoint - serves MPEG-TS directly for instant playback
app.get('/stream/:channelId', async (req, res) => {
  const { channelId } = req.params;
  const startTime = Date.now();
  const log = (msg) => console.log(`[server] [${Date.now() - startTime}ms] ${msg}`);

  log(`Stream request for ${channelId}`);

  const channel = getChannel(channelId);
  if (!channel) {
    return res.status(404).json({ error: `Unknown channel: ${channelId}` });
  }

  try {
    // Allocate a tuner for this channel
    log('Allocating tuner...');
    const tuner = await tunerManager.allocateTuner(channelId);
    log(`Tuner allocated: ${tuner ? tuner.id : 'none'} (state: ${tuner?.state})`);

    if (!tuner) {
      return res.status(503).json({
        error: 'All tuners busy',
        message: 'No tuners available. Try again later or release a tuner.',
      });
    }

    log(`Serving ${channelId} from tuner ${tuner.id} (state: ${tuner.state})`);

    // Wait for tuner to be in streaming state (not tuning)
    let stateWait = 0;
    const maxStateWait = 30000;  // 30 seconds for channel switch
    while (tuner.state === 'tuning' && stateWait < maxStateWait) {
      await new Promise(r => setTimeout(r, 500));
      stateWait += 500;
      log(`Waiting for tuner state... (${stateWait}ms, state: ${tuner.state})`);
    }
    log(`Tuner ready (state: ${tuner.state})`);

    // Verify tuner is on the correct channel
    if (tuner.currentChannel !== channelId) {
      console.log(`[server] Tuner switched away from ${channelId}, was expecting ${channelId} got ${tuner.currentChannel}`);
      return res.status(503).json({ error: 'Channel switched, please retry' });
    }

    // Update activity
    tuner.lastActivity = Date.now();

    // Set MPEG-TS headers for streaming
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');

    log('Starting MPEG-TS stream');

    // Pipe the MPEG-TS stream directly to the client
    tuner.pipeToClient(res);

    // The connection will stay open until the client disconnects
    // or the tuner is released

  } catch (err) {
    console.error(`[server] Error allocating tuner for ${channelId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve HLS playlist for a tuner
app.get('/tuner/:tunerId/stream.m3u8', async (req, res) => {
  const { tunerId } = req.params;
  const tuner = tunerManager.getTuner(tunerId);

  if (!tuner) {
    return res.status(404).json({ error: `Tuner ${tunerId} not found` });
  }

  const playlistPath = tuner.getPlaylistPath();
  if (!playlistPath || !fs.existsSync(playlistPath)) {
    return res.status(404).json({ error: 'Stream not ready' });
  }

  // Update activity
  tuner.lastActivity = Date.now();

  // Read and modify playlist to use absolute URLs
  let playlist = fs.readFileSync(playlistPath, 'utf8');

  // Replace segment filenames with full URLs (both regular HLS and LL-HLS)
  const host = req.headers.host || `${config.host}:${config.port}`;
  playlist = playlist.replace(/^(segment\d+\.ts)$/gm, `http://${host}/tuner/${tunerId}/$1`);
  playlist = playlist.replace(/^(segment\d+\.m4s)$/gm, `http://${host}/tuner/${tunerId}/$1`);
  // Handle init.mp4 in EXT-X-MAP tag: #EXT-X-MAP:URI="init.mp4"
  playlist = playlist.replace(/URI="(init\.mp4)"/g, `URI="http://${host}/tuner/${tunerId}/$1"`);

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(playlist);
});

// Serve HLS segments for a tuner (supports both regular HLS and LL-HLS)
app.get('/tuner/:tunerId/:segment', (req, res) => {
  const { tunerId, segment } = req.params;
  const tuner = tunerManager.getTuner(tunerId);

  if (!tuner) {
    return res.status(404).json({ error: `Tuner ${tunerId} not found` });
  }

  // Security: only serve valid HLS segment files
  // Regular HLS: .ts files
  // LL-HLS: .m4s segments and init.mp4
  const isValidSegment = segment.endsWith('.ts') ||
                         segment.endsWith('.m4s') ||
                         segment === 'init.mp4';

  if (!isValidSegment) {
    return res.status(400).json({ error: 'Invalid segment' });
  }

  const segmentPath = tuner.getSegmentPath(segment);
  if (!segmentPath || !fs.existsSync(segmentPath)) {
    return res.status(404).json({ error: 'Segment not found' });
  }

  // Update activity
  tuner.lastActivity = Date.now();

  // Set correct MIME type based on segment type
  let contentType = 'video/mp2t'; // Default for .ts
  if (segment.endsWith('.m4s') || segment === 'init.mp4') {
    contentType = 'video/mp4';
  }

  res.setHeader('Content-Type', contentType);
  // Short cache for LL-HLS segments, longer for init
  res.setHeader('Cache-Control', segment === 'init.mp4' ? 'max-age=3600' : 'no-cache');
  fs.createReadStream(segmentPath).pipe(res);
});

// Release a client from tuner (called when client stops watching)
app.post('/tuner/:tunerId/release', (req, res) => {
  const { tunerId } = req.params;
  tunerManager.releaseClient(tunerId);
  res.json({ success: true });
});

// Force release tuner (admin endpoint)
app.post('/tuner/:tunerId/force-release', async (req, res) => {
  const { tunerId } = req.params;
  await tunerManager.releaseTuner(tunerId);
  res.json({ success: true });
});

// ================== CINEBY ENDPOINTS ==================

// Combined M3U playlist (DirecTV channels + Cineby movies)
app.get('/full-playlist.m3u', (req, res) => {
  const host = req.headers.host || `${config.host}:${config.port}`;

  // Combine DirecTV channels and Cineby movies
  let m3u = '#EXTM3U\n\n';
  m3u += '# DirecTV Live Channels\n';
  m3u += generateM3U(host).replace('#EXTM3U\n', '');
  m3u += '\n# Cineby Movies (Native Playback - Pause/Rewind supported!)\n';
  m3u += generateCinebyM3U(host);

  res.setHeader('Content-Type', 'application/x-mpegurl');
  res.setHeader('Content-Disposition', 'attachment; filename="full-playlist.m3u"');
  res.send(m3u);
});

// Cineby movies M3U only
app.get('/cineby-playlist.m3u', (req, res) => {
  const host = req.headers.host || `${config.host}:${config.port}`;
  const m3u = '#EXTM3U\n\n' + generateCinebyM3U(host);

  res.setHeader('Content-Type', 'application/x-mpegurl');
  res.setHeader('Content-Disposition', 'attachment; filename="cineby-movies.m3u"');
  res.send(m3u);
});

// List all Cineby movies
app.get('/cineby/movies', async (req, res) => {
  try {
    const movies = await getAllMovies();
    res.json(movies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Cineby categories
app.get('/cineby/categories', (req, res) => {
  res.json(getCategories());
});

// Get movies by category
app.get('/cineby/category/:category', (req, res) => {
  const { category } = req.params;
  const movies = getMoviesByCategory(category);
  res.json(movies);
});

// Search Cineby movies
app.get('/cineby/search', (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing search query (q)' });
  }
  const results = searchMovies(q);
  res.json(results);
});

// Get single movie details
app.get('/cineby/movie/:movieId', (req, res) => {
  const { movieId } = req.params;
  const movie = getMovie(movieId);
  if (!movie) {
    return res.status(404).json({ error: `Movie not found: ${movieId}` });
  }
  res.json(movie);
});

// Required headers for Cineby CDN requests
const CINEBY_HEADERS = {
  'Referer': 'https://www.cineby.gd/',
  'Origin': 'https://www.cineby.gd',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
};

// Proxy fetch helper
async function proxyFetch(url) {
  const https = require('https');
  const http = require('http');
  const urlObj = new URL(url);
  const lib = urlObj.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.get(url, {
      headers: CINEBY_HEADERS
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        proxyFetch(response.headers.location).then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks)
        });
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Stream a Cineby movie - proxies HLS with required headers
// This allows TvMate/VLC to play with native pause/rewind/forward!
app.get('/cineby/:movieId/stream', async (req, res) => {
  const { movieId } = req.params;

  const movie = getMovie(movieId);
  if (!movie) {
    return res.status(404).json({ error: `Movie not found: ${movieId}` });
  }

  console.log(`[cineby] Stream request for: ${movie.title}`);

  try {
    // Extract the stream URL from Cineby
    const streamUrl = await cinebyStreamer.extractStreamUrl(movieId);
    console.log(`[cineby] Got stream URL: ${streamUrl.substring(0, 80)}...`);

    // Fetch the m3u8 playlist with proper headers
    const response = await proxyFetch(streamUrl);

    if (response.status !== 200) {
      throw new Error(`CDN returned ${response.status}`);
    }

    let playlist = response.body.toString('utf8');

    // Get the base URL for rewriting segment URLs
    // Segments are relative paths that should use the same workers.dev domain
    const baseUrl = new URL(streamUrl);
    const workerBase = `${baseUrl.protocol}//${baseUrl.host}`;
    const host = req.headers.host || `${config.host}:${config.port}`;

    console.log(`[cineby] Worker base URL: ${workerBase}`);

    // Rewrite segment URLs to point to our proxy
    // Segments look like: /raindust78.online/file2/... or /lightbeam83.wiki/file2/... or /stormcurve61.site/file2/...
    // They need to be fetched via the same workers.dev proxy
    playlist = playlist.replace(/^(\/[a-z0-9]+\.(online|live|wiki|site)\/file2\/[^\n]+)$/gm, (match) => {
      // Build full URL through the workers.dev proxy
      const fullUrl = `${workerBase}${match}`;
      const encoded = Buffer.from(fullUrl).toString('base64url');
      return `http://${host}/cineby/segment/${encoded}`;
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(playlist);

  } catch (error) {
    console.error(`[cineby] Error streaming ${movieId}:`, error.message);
    res.status(500).json({
      error: 'Failed to extract stream',
      message: error.message,
      movie: movie.title
    });
  }
});

// Proxy HLS segments with required headers
app.get('/cineby/segment/:encodedUrl', async (req, res) => {
  try {
    const segmentUrl = Buffer.from(req.params.encodedUrl, 'base64url').toString('utf8');
    console.log(`[cineby] Proxying segment: ${segmentUrl.substring(0, 60)}...`);

    const response = await proxyFetch(segmentUrl);

    if (response.status !== 200) {
      return res.status(response.status).send('Segment fetch failed');
    }

    // Forward appropriate headers
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    } else {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    res.setHeader('Cache-Control', 'max-age=3600');

    res.send(response.body);

  } catch (error) {
    console.error(`[cineby] Segment proxy error:`, error.message);
    res.status(500).send('Proxy error');
  }
});

// Get the raw stream URL (for debugging/advanced use)
app.get('/cineby/:movieId/url', async (req, res) => {
  const { movieId } = req.params;

  const movie = getMovie(movieId);
  if (!movie) {
    return res.status(404).json({ error: `Movie not found: ${movieId}` });
  }

  try {
    const streamUrl = await cinebyStreamer.extractStreamUrl(movieId);
    res.json({
      movie: movie.title,
      year: movie.year,
      streamUrl,
      cinebyUrl: movie.cinebyUrl
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cineby cache status
app.get('/cineby/cache', (req, res) => {
  res.json(cinebyStreamer.getCacheStatus());
});

// Clear Cineby cache
app.post('/cineby/cache/clear', (req, res) => {
  const { movieId } = req.query;
  cinebyStreamer.clearCache(movieId);
  res.json({ success: true, cleared: movieId || 'all' });
});

// Refresh Cineby movie catalog from API
app.post('/cineby/refresh', async (req, res) => {
  try {
    console.log('[cineby] Manual catalog refresh requested');
    const movies = await refreshCache();
    res.json({ success: true, movieCount: movies.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== VOD BUILDER ENDPOINTS ==================

// VOD Playlist - M3U format with full metadata
app.get('/vod-playlist.m3u', async (req, res) => {
  try {
    const host = req.headers.host || `${config.host}:${config.port}`;
    const m3u = await vodBuilder.buildVodPlaylist(host);

    res.setHeader('Content-Type', 'application/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="cineby-vod.m3u"');
    res.send(m3u);
  } catch (error) {
    console.error('[vod] Error building playlist:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// VOD catalog as JSON (for apps with richer metadata support)
app.get('/vod/catalog', async (req, res) => {
  try {
    const catalog = await vodBuilder.buildVodJson();
    res.json(catalog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VOD movies with metadata and stream status
app.get('/vod/movies', (req, res) => {
  const movies = vodBuilder.getAllMoviesWithMetadata();
  res.json(movies);
});

// VOD extraction status
app.get('/vod/status', (req, res) => {
  res.json(vodBuilder.getExtractionStatus());
});

// Update VOD catalog from API
app.post('/vod/update-catalog', async (req, res) => {
  try {
    console.log('[vod] Updating movie catalog from API...');
    const movies = await vodBuilder.updateCatalog();
    res.json({ success: true, movieCount: movies.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start batch extraction of m3u8 URLs
app.post('/vod/extract', async (req, res) => {
  try {
    const { skipCached = true, maxAge, delayBetween } = req.query;

    console.log('[vod] Starting batch m3u8 extraction...');

    // First ensure we have the movie catalog
    let movies = vodBuilder.getAllMoviesWithMetadata();
    if (movies.length === 0) {
      console.log('[vod] No movies in cache, fetching from API first...');
      await vodBuilder.updateCatalog();
      movies = vodBuilder.getAllMoviesWithMetadata();
    }

    if (movies.length === 0) {
      return res.status(500).json({ error: 'No movies found in catalog' });
    }

    // Start extraction in background (don't wait for completion)
    const options = {
      skipCached: skipCached === 'true' || skipCached === true,
      maxAge: maxAge ? parseInt(maxAge) : undefined,
      delayBetween: delayBetween ? parseInt(delayBetween) : undefined
    };

    // Run extraction asynchronously
    vodBuilder.batchExtractStreams(movies, options)
      .then(results => {
        console.log(`[vod] Batch extraction completed: ${results.success} success, ${results.failed} failed, ${results.skipped} skipped`);
      })
      .catch(err => {
        console.error('[vod] Batch extraction error:', err.message);
      });

    res.json({
      success: true,
      message: 'Batch extraction started',
      totalMovies: movies.length,
      options
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Extract single movie (synchronous)
app.post('/vod/extract/:tmdbId', async (req, res) => {
  const { tmdbId } = req.params;

  try {
    const movies = vodBuilder.getAllMoviesWithMetadata();
    const movie = movies.find(m => m.tmdbId.toString() === tmdbId);

    if (!movie) {
      return res.status(404).json({ error: `Movie not found: ${tmdbId}` });
    }

    console.log(`[vod] Extracting stream for: ${movie.title}`);

    const { chromium } = require('playwright');
    const browser = await chromium.connectOverCDP(`http://localhost:${process.env.CHROME_DEBUG_PORT || 9222}`);
    const result = await vodBuilder.extractStreamForMovie(browser, movie);

    if (result.success) {
      res.json({
        success: true,
        movie: movie.title,
        tmdbId: movie.tmdbId,
        streamUrl: result.url,
        extractedAt: result.extractedAt
      });
    } else {
      res.status(500).json({
        success: false,
        movie: movie.title,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== UNIFIED PROVIDER ENDPOINTS ==================
// These work with any registered provider (cineby, cinemaos, etc.)

// List all providers
app.get('/vod/providers', (req, res) => {
  res.json(providerRegistry.getProviderInfo());
});

// Unified status for all providers
app.get('/vod/unified-status', (req, res) => {
  res.json(providerRegistry.getStatus());
});

// Provider-specific M3U playlist
app.get('/vod/:providerId/playlist.m3u', async (req, res) => {
  const { providerId } = req.params;

  if (!providerRegistry.has(providerId)) {
    return res.status(404).json({ error: `Unknown provider: ${providerId}` });
  }

  try {
    const host = req.headers.host || `${config.host}:${config.port}`;
    const m3u = await providerRegistry.generateProviderM3U(providerId, host);

    res.setHeader('Content-Type', 'application/x-mpegurl');
    res.setHeader('Content-Disposition', `attachment; filename="${providerId}-movies.m3u"`);
    res.send(m3u);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Provider catalog
app.get('/vod/:providerId/catalog', async (req, res) => {
  const { providerId } = req.params;
  const { expand = 'false', refresh = 'false' } = req.query;

  const provider = providerRegistry.get(providerId);
  if (!provider) {
    return res.status(404).json({ error: `Unknown provider: ${providerId}` });
  }

  try {
    // Check cache first (use any age to avoid unnecessary browser calls)
    let catalog = cacheManager.getCatalogAnyAge(providerId);
    let fromCache = true;

    // Only fetch from browser if:
    // 1. No cached catalog exists at all, OR
    // 2. User explicitly wants expansion, OR
    // 3. User explicitly wants refresh
    if (!catalog || expand === 'true' || refresh === 'true') {
      console.log(`[vod] Fetching catalog for ${providerId} (expand: ${expand}, refresh: ${refresh})`);
      try {
        catalog = await provider.fetchCatalog({ expandBrowse: expand === 'true' });
        cacheManager.setCatalog(providerId, catalog);
        fromCache = false;
      } catch (fetchError) {
        // If fetch fails but we have cached data, use it with a warning
        if (catalog) {
          console.log(`[vod] Fetch failed, using cached catalog: ${fetchError.message}`);
        } else {
          throw fetchError; // No fallback available
        }
      }
    }

    const cachedCatalog = cacheManager.getCatalogAnyAge(providerId);
    res.json({
      provider: providerId,
      totalMovies: catalog.movies?.length || 0,
      catalogAge: cachedCatalog?.lastFetch
        ? Math.round((Date.now() - cachedCatalog.lastFetch) / 1000)
        : null,
      fromCache,
      movies: catalog.movies || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Provider status
app.get('/vod/:providerId/status', (req, res) => {
  const { providerId } = req.params;

  if (!providerRegistry.has(providerId)) {
    return res.status(404).json({ error: `Unknown provider: ${providerId}` });
  }

  res.json(cacheManager.getProviderStatus(providerId));
});

// Stream endpoint for any provider
app.get('/vod/:providerId/:contentId/stream', async (req, res) => {
  const { providerId, contentId } = req.params;

  const provider = providerRegistry.get(providerId);
  if (!provider) {
    return res.status(404).json({ error: `Unknown provider: ${providerId}` });
  }

  try {
    console.log(`[vod] Stream request: ${providerId}/${contentId}`);

    // Get stream URL (from cache or fresh extraction)
    const streamUrl = await providerRegistry.extractStreamUrl(providerId, contentId);

    // Fetch the m3u8 playlist
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(streamUrl, {
      headers: provider.getProxyHeaders()
    });

    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    let playlist = await response.text();

    // Rewrite segment URLs if needed
    const host = req.headers.host || `${config.host}:${config.port}`;
    const proxyBase = `http://${host}/vod/${providerId}`;
    playlist = provider.rewritePlaylistUrls(playlist, proxyBase);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlist);

  } catch (error) {
    console.error(`[vod] Stream error for ${providerId}/${contentId}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Segment proxy for any provider
app.get('/vod/:providerId/segment/:encodedUrl', async (req, res) => {
  const { providerId, encodedUrl } = req.params;

  const provider = providerRegistry.get(providerId);
  if (!provider) {
    return res.status(404).send('Unknown provider');
  }

  try {
    const segmentUrl = Buffer.from(encodedUrl, 'base64url').toString('utf8');

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(segmentUrl, {
      headers: provider.getProxyHeaders()
    });

    if (!response.ok) {
      return res.status(response.status).send('Upstream error');
    }

    res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const buffer = await response.buffer();
    res.send(buffer);

  } catch (error) {
    console.error(`[vod] Segment proxy error:`, error.message);
    res.status(500).send('Proxy error');
  }
});

// Batch extraction for a provider
app.post('/vod/:providerId/extract', async (req, res) => {
  const { providerId } = req.params;
  const { skipCached = 'true', maxItems } = req.query;

  if (!providerRegistry.has(providerId)) {
    return res.status(404).json({ error: `Unknown provider: ${providerId}` });
  }

  try {
    // Start extraction in background
    console.log(`[vod] Starting batch extraction for ${providerId}`);

    providerRegistry.batchExtract(providerId, {
      skipCached: skipCached === 'true',
      maxItems: maxItems ? parseInt(maxItems) : null
    }).then(results => {
      console.log(`[vod] Batch extraction complete for ${providerId}:`, results);
    }).catch(err => {
      console.error(`[vod] Batch extraction error for ${providerId}:`, err.message);
    });

    const status = cacheManager.getProviderStatus(providerId);
    res.json({
      success: true,
      message: 'Batch extraction started',
      provider: providerId,
      currentStatus: status
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Single extraction for a provider
app.post('/vod/:providerId/extract/:contentId', async (req, res) => {
  const { providerId, contentId } = req.params;

  const provider = providerRegistry.get(providerId);
  if (!provider) {
    return res.status(404).json({ error: `Unknown provider: ${providerId}` });
  }

  try {
    console.log(`[vod] Extracting ${providerId}/${contentId}`);
    const url = await providerRegistry.extractStreamUrl(providerId, contentId);

    res.json({
      success: true,
      provider: providerId,
      contentId,
      streamUrl: url
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      provider: providerId,
      contentId,
      error: error.message
    });
  }
});

// Combined M3U playlist for all providers
app.get('/vod/combined-playlist.m3u', async (req, res) => {
  try {
    const host = req.headers.host || `${config.host}:${config.port}`;
    const m3u = await providerRegistry.generateCombinedM3U(host, ['movies']);

    res.setHeader('Content-Type', 'application/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="vod-combined.m3u"');
    res.send(m3u);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================== END UNIFIED PROVIDER ENDPOINTS ==================

// ================== DIRECTV EPG ENDPOINTS ==================

// XMLTV EPG for TvMate/IPTV apps
app.get('/tve/directv/epg.xml', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  console.log(`[epg] Generating XMLTV EPG (${hours} hours)`);

  const xml = directvEpg.generateXMLTV(hours);

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', 'attachment; filename="directv-epg.xml"');
  res.send(xml);
});

// M3U playlist with EPG tvg-id matching
app.get('/tve/directv/playlist.m3u', (req, res) => {
  const host = req.headers.host || `${config.host}:${config.port}`;
  console.log('[epg] Generating DirecTV M3U playlist with EPG IDs');

  const m3u = directvEpg.generateM3U(host);

  res.setHeader('Content-Type', 'application/x-mpegurl');
  res.setHeader('Content-Disposition', 'attachment; filename="directv.m3u"');
  res.send(m3u);
});

// DirecTV channel list from EPG
app.get('/tve/directv/channels', (req, res) => {
  res.json({
    success: true,
    count: directvEpg.getChannels().length,
    channels: directvEpg.getChannels()
  });
});

// EPG status
app.get('/tve/directv/epg/status', (req, res) => {
  res.json(directvEpg.getStatus());
});

// Refresh EPG data from DirecTV (requires authenticated browser session)
app.post('/tve/directv/epg/refresh', async (req, res) => {
  try {
    console.log('[epg] Manual EPG refresh requested');
    const result = await directvEpg.fetchFromBrowser();
    res.json({
      success: true,
      message: 'EPG refreshed',
      ...result
    });
  } catch (error) {
    console.error('[epg] Refresh error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stream a DirecTV channel by number (placeholder - needs tuner integration)
app.get('/tve/directv/stream/:channelNumber', async (req, res) => {
  const { channelNumber } = req.params;

  // Find channel by number
  const channel = directvEpg.getChannelByNumber(channelNumber);
  if (!channel) {
    return res.status(404).json({ error: `Channel ${channelNumber} not found` });
  }

  // For now, redirect to the stream.directv.com URL
  // This would need browser automation to actually play
  res.redirect(`https://stream.directv.com/watch/live?channel=${channel.ccid}`);
});

// ================== END DIRECTV EPG ENDPOINTS ==================

// Startup
async function start() {
  console.log('='.repeat(60));
  console.log('DirecTV IPTV Proxy Server');
  console.log('='.repeat(60));

  // Initialize tuner manager
  console.log('[server] Initializing tuners...');
  await tunerManager.initialize();

  // Start HTTP server
  app.listen(config.port, config.host, () => {
    console.log(`[server] Server running on http://${config.host}:${config.port}`);
    console.log('');
    console.log('DirecTV Endpoints:');
    console.log(`  M3U Playlist:     http://<host>:${config.port}/playlist.m3u`);
    console.log(`  Channels:         http://<host>:${config.port}/channels`);
    console.log(`  Tuner Status:     http://<host>:${config.port}/tuners`);
    console.log(`  Stream Health:    http://<host>:${config.port}/stats`);
    console.log(`  Stream:           http://<host>:${config.port}/stream/<channelId>`);
    console.log('');
    console.log('Cineby Movie Endpoints (Native playback with pause/rewind!):');
    console.log(`  Full Playlist:    http://<host>:${config.port}/full-playlist.m3u`);
    console.log(`  Cineby Only:      http://<host>:${config.port}/cineby-playlist.m3u`);
    console.log(`  Movie List:       http://<host>:${config.port}/cineby/movies`);
    console.log(`  Stream Movie:     http://<host>:${config.port}/cineby/<movieId>/stream`);
    console.log('');
    console.log('VOD Builder (Full metadata + batch m3u8 extraction):');
    console.log(`  VOD Playlist:     http://<host>:${config.port}/vod-playlist.m3u`);
    console.log(`  VOD Catalog:      http://<host>:${config.port}/vod/catalog`);
    console.log(`  VOD Status:       http://<host>:${config.port}/vod/status`);
    console.log(`  Update Catalog:   POST http://<host>:${config.port}/vod/update-catalog`);
    console.log(`  Batch Extract:    POST http://<host>:${config.port}/vod/extract`);
    console.log('');
    console.log('Add the M3U URL to TvMate or VLC to start watching!');
    console.log('='.repeat(60));

    // Start EPG auto-refresh (every 4 hours)
    directvEpg.startAutoRefresh();
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[server] Shutting down...');
  await tunerManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[server] Shutting down...');
  await tunerManager.shutdown();
  process.exit(0);
});

// Start the server
start().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
