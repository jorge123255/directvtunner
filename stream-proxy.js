const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const tunerManager = require('./tuner-manager');
const { generateM3U, getAllChannels, getChannel } = require('./channels');

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

// Main stream endpoint - redirects to HLS playlist
app.get('/stream/:channelId', async (req, res) => {
  const { channelId } = req.params;

  const channel = getChannel(channelId);
  if (!channel) {
    return res.status(404).json({ error: `Unknown channel: ${channelId}` });
  }

  try {
    // Allocate a tuner for this channel
    const tuner = await tunerManager.allocateTuner(channelId);

    if (!tuner) {
      return res.status(503).json({
        error: 'All tuners busy',
        message: 'No tuners available. Try again later or release a tuner.',
      });
    }

    // Redirect to the tuner's HLS playlist
    const host = req.headers.host || `${config.host}:${config.port}`;
    const hlsUrl = `http://${host}/tuner/${tuner.id}/stream.m3u8`;

    console.log(`[server] Redirecting ${channelId} to tuner ${tuner.id}: ${hlsUrl}`);

    // For HLS clients, redirect to playlist
    res.redirect(302, hlsUrl);

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

  // Replace segment filenames with full URLs
  const host = req.headers.host || `${config.host}:${config.port}`;
  playlist = playlist.replace(/^(segment\d+\.ts)$/gm, `http://${host}/tuner/${tunerId}/$1`);

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(playlist);
});

// Serve HLS segments for a tuner
app.get('/tuner/:tunerId/:segment', (req, res) => {
  const { tunerId, segment } = req.params;
  const tuner = tunerManager.getTuner(tunerId);

  if (!tuner) {
    return res.status(404).json({ error: `Tuner ${tunerId} not found` });
  }

  // Security: only serve .ts files
  if (!segment.endsWith('.ts')) {
    return res.status(400).json({ error: 'Invalid segment' });
  }

  const segmentPath = tuner.getSegmentPath(segment);
  if (!segmentPath || !fs.existsSync(segmentPath)) {
    return res.status(404).json({ error: 'Segment not found' });
  }

  // Update activity
  tuner.lastActivity = Date.now();

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'max-age=3600');
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
    console.log('Endpoints:');
    console.log(`  M3U Playlist:  http://<host>:${config.port}/playlist.m3u`);
    console.log(`  Channels:      http://<host>:${config.port}/channels`);
    console.log(`  Tuner Status:  http://<host>:${config.port}/tuners`);
    console.log(`  Stream:        http://<host>:${config.port}/stream/<channelId>`);
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
