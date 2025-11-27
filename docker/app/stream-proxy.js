const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const tunerManager = require('./tuner-manager');
const { generateM3U, getAllChannels, getChannel } = require('./channels');
const { getAllMovies, getMovie, searchMovies, getMoviesByCategory, getCategories, generateCinebyM3U } = require('./cineby-movies');
const cinebyStreamer = require('./cineby-streamer');

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
app.get('/cineby/movies', (req, res) => {
  res.json(getAllMovies());
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

// Stream a Cineby movie - extracts HLS URL and redirects to it
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

    console.log(`[cineby] Redirecting to stream: ${streamUrl.substring(0, 80)}...`);

    // Redirect to the actual stream URL
    // The IPTV client will play directly from the source with native controls!
    res.redirect(302, streamUrl);

  } catch (error) {
    console.error(`[cineby] Error streaming ${movieId}:`, error.message);
    res.status(500).json({
      error: 'Failed to extract stream',
      message: error.message,
      movie: movie.title
    });
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
    console.log('Add the M3U URL to TvMate or VLC to start watching!');
    console.log('='.repeat(60));
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
