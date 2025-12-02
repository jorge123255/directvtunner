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

// CinemaOS Database Manager (for auto-refresh)
const CinemaOSDbManager = require('./cinemaos-db-manager');
const cinemaosManager = new CinemaOSDbManager();

// Cineby TV Database Manager (for auto-refresh)
const CinebyTVManager = require('./cineby-tv-manager');
const tvManager = new CinebyTVManager();

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

// Settings GUI
const settingsManager = require('./settings-manager');
const { getPresets, getPreset } = require('./presets');

const app = express();

// JSON body parsing for settings API
app.use(express.json());

// Serve static files (settings GUI)
app.use(express.static(path.join(__dirname, 'public')));

// Middleware for logging
app.use((req, res, next) => {
  if (!req.url.startsWith('/api/logs')) console.log(`[server] ${req.method} ${req.url}`);
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

// ============================================
// Version API
// ============================================
app.get('/api/version', (req, res) => {
  const pkg = require('./package.json');
  const os = require('os');
  
  function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return days + 'd ' + hours + 'h ' + mins + 'm';
    if (hours > 0) return hours + 'h ' + mins + 'm';
    return mins + 'm';
  }
  
  res.json({
    version: pkg.version || '1.0.0',
    name: pkg.name || 'directv-tuner',
    image: process.env.DOCKER_IMAGE || 'sunnyside1/directvtuner:latest',
    buildDate: process.env.BUILD_DATE || null,
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    uptime: Math.floor(process.uptime()),
    uptimeFormatted: formatUptime(process.uptime())
  });
});


// ============================================
// System Status API
// ============================================

app.get("/api/status", async (req, res) => {
  try {
    // Check login status by examining the browser page
    let loginStatus = {
      isLoggedIn: false,
      currentUrl: "",
      needsLogin: false,
      message: ""
    };

    // Try to get browser page info
    try {
      const tuner = tunerManager.getTuner(0);
      if (tuner && tuner.page) {
        const url = tuner.page.url();
        loginStatus.currentUrl = url;
        loginStatus.isLoggedIn = url.includes("stream.directv.com") && !url.includes("login") && !url.includes("signin") && !url.includes("auth");
        loginStatus.needsLogin = url.includes("login") || url.includes("signin") || url.includes("auth");
        if (loginStatus.needsLogin) {
          loginStatus.message = "Please log in via noVNC";
        } else if (loginStatus.isLoggedIn) {
          loginStatus.message = "Logged in to DirecTV";
        } else {
          loginStatus.message = "Checking login status...";
        }
      } else {
        loginStatus.message = "Browser not ready";
      }
    } catch (e) {
      loginStatus.error = e.message;
      loginStatus.message = "Error checking login";
    }

    // EPG Status
    const epgStatus = directvEpg.getStatus();
    epgStatus.autoRefreshEnabled = directvEpg.refreshTimer !== null;

    // CinemaOS status
    let cinemaosStatus = { enabled: false };
    try {
      const stats = cinemaosManager.getStats();
      cinemaosStatus = {
        enabled: stats.autoRefreshEnabled || false,
        movieCount: stats.totalMovies || 0,
        lastUpdate: stats.lastUpdate
      };
    } catch (e) {}

    // TV status
    let tvStatus = { enabled: false };
    try {
      const stats = tvManager.getStats();
      tvStatus = {
        enabled: stats.autoRefreshEnabled || false,
        showCount: stats.totalShows || 0,
        lastUpdate: stats.lastUpdate
      };
    } catch (e) {}
    // Get tuner status with channel names
    const tunerStatus = tunerManager.getStatus();
    
    // Load channels to get names
    let channelMap = {};
    try {
      const fs = require("fs");
      const channelsPath = "/app/data/directv_channels.json";
      if (fs.existsSync(channelsPath)) {
        const data = JSON.parse(fs.readFileSync(channelsPath, "utf8"));
        (data.channels || []).forEach(ch => {
          channelMap[ch.number] = { name: ch.callSign || ch.name, fullName: ch.name };
        });
      }
    } catch (e) {}
    
    // Enhance tuner info with channel names
    tunerStatus.tuners = tunerStatus.tuners.map(t => ({
      ...t,
      channelName: channelMap[t.channel] ? channelMap[t.channel].name : "",
      channelFullName: channelMap[t.channel] ? channelMap[t.channel].fullName : ""
    }));

    res.json({
      login: loginStatus,
      epg: epgStatus,
      cinemaos: cinemaosStatus,
      tv: tvStatus,
      tuners: tunerStatus
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ============================================
// Settings API
// ============================================

// Get current settings
app.get('/api/settings', (req, res) => {
  res.json(settingsManager.getSettings());
});

// Save settings
app.post('/api/settings', (req, res) => {
  try {
    const saved = settingsManager.saveSettings(req.body);
    res.json({ success: true, settings: saved, restartRequired: false });
  } catch (err) {
    console.error('[server] Failed to save settings:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reset to defaults
app.post('/api/settings/reset', (req, res) => {
  try {
    const defaults = settingsManager.getDefaults();
    const saved = settingsManager.saveSettings(defaults);
    res.json({ success: true, settings: saved });
  } catch (err) {
    console.error('[server] Failed to reset settings:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get available presets
app.get('/api/presets', (req, res) => {
  res.json(getPresets());
});

// Apply a preset
app.post('/api/presets/:presetId', (req, res) => {
  const { presetId } = req.params;
  const preset = getPreset(presetId);

  if (!preset) {
    return res.status(404).json({ error: `Preset "${presetId}" not found` });
  }

  try {
    const currentSettings = settingsManager.getSettings();
    const newSettings = {
      ...currentSettings,
      ...preset.settings,
      // tuners preserved from currentSettings above
    };

    // Save the preset settings
    settingsManager.saveSettings(newSettings);
    res.json({ success: true, name: preset.name, settings: newSettings });
  } catch (err) {
    console.error('[server] Failed to apply preset:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ============================================
// Logs API
// ============================================

// Get server logs
app.get('/api/logs', (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  const logFile = '/var/log/supervisor/dvr.log';
  const errFile = '/var/log/supervisor/dvr_err.log';
  
  const logs = [];
  
  // Helper to parse log lines
  const parseLogLine = (line, isError = false) => {
    const timestamp = new Date().toISOString().substr(11, 8);
    let level = 'info';
    let message = line.trim();
    
    if (!message) return null;
    
    // Filter out noisy cineby fetch errors
    if (message.includes('[cineby] Error fetching from API')) return null;
    
    // Detect level from content
    if (isError || message.includes('Error:') || message.includes('[error]') || message.includes('ERROR') || message.includes('failed')) {
      level = 'error';
    } else if (message.includes('[debug]') || message.includes('DEBUG')) {
      level = 'debug';
    } else if (message.includes('[warn]') || message.includes('WARN')) {
      level = 'warn';
    }
    
    // Extract timestamp if present in log
    const tsMatch = message.match(/^\[?(\d{2}:\d{2}:\d{2})\]?\s*/);
    const time = tsMatch ? tsMatch[1] : timestamp;
    
    return { time, level, message };
  };
  
  try {
    // Read main log
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      const logLines = content.split('\n').slice(-lines);
      logLines.forEach(line => {
        const parsed = parseLogLine(line);
        if (parsed) logs.push(parsed);
      });
    }
    
    // Read error log
    if (fs.existsSync(errFile)) {
      const content = fs.readFileSync(errFile, 'utf8');
      const errLines = content.split('\n').slice(-Math.floor(lines / 2));
      errLines.forEach(line => {
        const parsed = parseLogLine(line, true);
        if (parsed) logs.push(parsed);
      });
    }
    
    // Sort by time (most recent last)
    logs.sort((a, b) => a.time.localeCompare(b.time));
    
    res.json({ logs: logs.slice(-lines) });
  } catch (err) {
    // Handle no upcoming airings with a generated error video
    if (err.message === "NO_UPCOMING_AIRINGS") {
      // Reset the tuner so it can be used again
      tunerManager.releaseTuner(0);
      console.log(`[server] Channel ${channelId} has no upcoming airings, sending error video`);
      res.setHeader("Content-Type", "video/mp2t");
      res.setHeader("Cache-Control", "no-cache");
      
      // Generate a simple error video with FFmpeg
      const { spawn } = require("child_process");
      const ffmpeg = spawn("ffmpeg", [
        "-f", "lavfi",
        "-i", `color=c=black:s=1280x720:d=10`,
        "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=stereo",
        "-vf", `drawtext=text='No Upcoming Airings\nPlease Change Channel':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
        "-t", "10",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-c:a", "aac",
        "-f", "mpegts",
        "-"
      ]);
      
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", () => {});
      ffmpeg.on("close", () => res.end());
      return;
    }

    res.status(500).json({ error: err.message, logs: [] });
  }
});


// ============================================
// System Info API
// ============================================

app.get('/api/system-info', (req, res) => {
  try {
    const os = require('os');
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const uptimeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    const memUsage = process.memoryUsage();
    const memoryStr = `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`;

    // Get container ID
    let containerId = '-';
    try {
      containerId = fs.readFileSync('/etc/hostname', 'utf8').trim().substring(0, 12);
    } catch (e) {}

    // Get image info from environment or file
    const imageInfo = process.env.DVR_IMAGE || 'sunnyside1/directvtuner:latest';
    const version = process.env.DVR_VERSION || '1.0';

    res.json({
      version: version,
      image: imageInfo,
      uptime: uptimeStr,
      memory: memoryStr,
      nodeVersion: process.version,
      containerId: containerId
    });
  } catch (err) {
    console.error('[server] Failed to get system info:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ============================================
// Diagnostics Export API
// ============================================

app.get('/api/diagnostics', async (req, res) => {
  try {
    const os = require('os');
    const { execSync } = require('child_process');
    const archiver = require('archiver');

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="dvr-diagnostics-${timestamp}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // System info
    const systemInfo = {
      timestamp: new Date().toISOString(),
      version: process.env.DVR_VERSION || '1.0',
      image: process.env.DVR_IMAGE || 'sunnyside1/directvtuner:latest',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      env: {
        DVR_NUM_TUNERS: process.env.DVR_NUM_TUNERS,
        EXTERNAL: process.env.EXTERNAL,
        DISPLAY: process.env.DISPLAY
      }
    };
    archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' });

    // Tuner status
    try {
      const tunerStatus = tunerManager.getStatus();
      archive.append(JSON.stringify(tunerStatus, null, 2), { name: 'tuner-status.json' });
    } catch (e) {
      archive.append(`Error getting tuner status: ${e.message}`, { name: 'tuner-status-error.txt' });
    }

    // Current settings
    try {
      const settings = settingsManager.getSettings();
      archive.append(JSON.stringify(settings, null, 2), { name: 'settings.json' });
    } catch (e) {
      archive.append(`Error getting settings: ${e.message}`, { name: 'settings-error.txt' });
    }

    // Log files
    const logFiles = [
      '/var/log/supervisor/dvr.log',
      '/var/log/supervisor/dvr_err.log',
      '/var/log/supervisor/chrome_err.log',
      '/var/log/supervisor/supervisord.log'
    ];

    for (const logFile of logFiles) {
      try {
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf8');
          // Only include last 10000 lines to keep file size reasonable
          const lines = content.split('\n').slice(-10000).join('\n');
          const filename = path.basename(logFile);
          archive.append(lines, { name: `logs/${filename}` });
        }
      } catch (e) {
        archive.append(`Error reading ${logFile}: ${e.message}`, { name: `logs/${path.basename(logFile)}-error.txt` });
      }
    }

    // Process list
    try {
      const ps = execSync('ps aux', { encoding: 'utf8', timeout: 5000 });
      archive.append(ps, { name: 'processes.txt' });
    } catch (e) {
      archive.append(`Error getting process list: ${e.message}`, { name: 'processes-error.txt' });
    }

    // Network info
    try {
      const netInterfaces = os.networkInterfaces();
      archive.append(JSON.stringify(netInterfaces, null, 2), { name: 'network-interfaces.json' });
    } catch (e) {
      archive.append(`Error getting network info: ${e.message}`, { name: 'network-error.txt' });
    }

    // Disk usage
    try {
      const df = execSync('df -h', { encoding: 'utf8', timeout: 5000 });
      archive.append(df, { name: 'disk-usage.txt' });
    } catch (e) {
      archive.append(`Error getting disk usage: ${e.message}`, { name: 'disk-error.txt' });
    }

    await archive.finalize();

  } catch (err) {
    console.error('[server] Failed to generate diagnostics:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
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
    // Handle no upcoming airings with a generated error video
    if (err.message === "NO_UPCOMING_AIRINGS") {
      // Reset the tuner so it can be used again
      tunerManager.releaseTuner(0);
      console.log(`[server] Channel ${channelId} has no upcoming airings, sending error video`);
      res.setHeader("Content-Type", "video/mp2t");
      res.setHeader("Cache-Control", "no-cache");
      
      // Generate a simple error video with FFmpeg
      const { spawn } = require("child_process");
      const ffmpeg = spawn("ffmpeg", [
        "-f", "lavfi",
        "-i", `color=c=black:s=1280x720:d=10`,
        "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=stereo",
        "-vf", `drawtext=text='No Upcoming Airings\nPlease Change Channel':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
        "-t", "10",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-c:a", "aac",
        "-f", "mpegts",
        "-"
      ]);
      
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on("data", () => {});
      ffmpeg.on("close", () => res.end());
      return;
    }

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

// Kill all FFmpeg processes (emergency reset)
app.post("/api/ffmpeg/kill", async (req, res) => {
  try {
    const { execSync } = require("child_process");
    // Kill any running ffmpeg processes
    try {
      execSync("pkill -9 ffmpeg", { timeout: 5000 });
      console.log("[server] FFmpeg processes killed via API");
    } catch (e) {
      // pkill returns error if no processes found, which is fine
    }
    // Reset tuner states
    const status = tunerManager.getStatus();
    for (const tuner of status.tuners) {
      if (tuner.state === 'streaming' || tuner.state === 'tuning') {
        await tunerManager.releaseTuner(tuner.id);
      }
    }
    res.json({ success: true, message: "FFmpeg processes killed and tuners reset" });
  } catch (err) {
    console.error("[server] Failed to kill FFmpeg:", err.message);
    res.status(500).json({ error: err.message });
  }
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
  const { title, year, imdbId, mediaType, season, episode } = req.query;  // Optional info for better API results

  const provider = providerRegistry.get(providerId);
  if (!provider) {
    return res.status(404).json({ error: `Unknown provider: ${providerId}` });
  }

  try {
    // Determine content type (movie or tv)
    const contentType = mediaType || 'movie';
    console.log(`[vod] Stream request: ${providerId}/${contentId} (${contentType}${season ? ` S${season}E${episode}` : ''})`);

    // Check if we already have a fresh stream URL from proactive refresh
    // This is critical: if proactive refresh has run, use the NEW URL, not old cache
    let streamResult = provider.getActiveStreamUrl(contentId);

    // If no active stream (first request or expired), extract fresh
    if (!streamResult) {
      const contentInfo = { title, year, imdbId, season, episode };
      streamResult = await provider.extractStreamUrl(contentId, contentType, contentInfo);
    } else {
      console.log(`[vod] Using proactively refreshed URL for ${contentId}`);
    }

    // Handle both old format (string URL) and new format (object with url + headers)
    let streamUrl, streamHeaders;
    if (typeof streamResult === 'string') {
      streamUrl = streamResult;
      streamHeaders = provider.getProxyHeaders();
    } else {
      streamUrl = streamResult.url;
      streamHeaders = streamResult.headers || provider.getProxyHeaders();
    }

    console.log(`[vod] Proxying stream: ${streamUrl.substring(0, 80)}...`);

    // Fetch the m3u8 playlist with proper headers
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(streamUrl, {
      headers: {
        ...streamHeaders,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    let playlist = await response.text();

    // Store headers for segment proxying
    if (streamResult.headers) {
      provider._streamHeaders = provider._streamHeaders || {};
      provider._streamHeaders[contentId] = streamHeaders;
    }

    // Rewrite segment URLs if needed
    const host = req.headers.host || `${config.host}:${config.port}`;
    const proxyBase = `http://${host}/vod/${providerId}`;
    playlist = provider.rewritePlaylistUrls(playlist, proxyBase, contentId, streamUrl);

    // Extract segment URLs for prefetching
    const segmentUrls = [];
    const lines = playlist.split("\n");
    for (const line of lines) {
      const match = line.match(/\/segment\/([^\?]+)/);
      if (match) segmentUrls.push(match[1]);
    }

    // Store segments and trigger background prefetch
    if (segmentUrls.length > 0) {
      playlistSegmentData.set(contentId, { segments: segmentUrls, headers: streamHeaders });
      console.log(`[vod] Queued ${segmentUrls.length} segments for prefetch (${contentId})`);
      // Start prefetching immediately in background
      setImmediate(() => prefetchSegmentsForContent(contentId));
    }

    // Remove EXT-X-ENDLIST to make it live-like
    playlist = playlist.replace("#EXT-X-ENDLIST", "");

    provider.startStreamRefresh(contentId, contentType);

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(playlist);

  } catch (error) {
    console.error(`[vod] Stream error for ${providerId}/${contentId}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ SEGMENT PREFETCHING SYSTEM ============
const segmentDataCache = new Map();
const SEGMENT_CACHE_TTL = 15 * 60 * 1000;
const SEGMENT_CACHE_MAX_SIZE = 600;
const prefetchActive = new Map();
const playlistSegmentData = new Map(); // Store segment list per content

// Cleanup timer
setInterval(() => {
  const now = Date.now();
  let deleted = 0;
  for (const [key, value] of segmentDataCache) {
    if (now - value.timestamp > SEGMENT_CACHE_TTL) {
      segmentDataCache.delete(key);
      deleted++;
    }
  }
  if (deleted > 0) console.log(`[vod] Cache cleanup: ${deleted} removed, ${segmentDataCache.size} remaining`);
}, 60000);

// Prefetch segments in background
async function prefetchSegmentsForContent(contentId) {
  const data = playlistSegmentData.get(contentId);
  if (!data) return;
  
  const { segments, headers } = data;
  const fetch = (await import('node-fetch')).default;
  let success = 0, failed = 0;
  
  console.log(`[vod] PREFETCH START: ${segments.length} segments for ${contentId}`);
  prefetchActive.set(contentId, true);
  
  for (let i = 0; i < segments.length && prefetchActive.get(contentId); i++) {
    const encodedUrl = segments[i];
    if (segmentDataCache.has(encodedUrl)) { success++; continue; }
    
    try {
      const segmentUrl = Buffer.from(encodedUrl, 'base64url').toString('utf8');
      const resp = await fetch(segmentUrl, {
        headers: { ...headers, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });
      
      if (resp.ok) {
        const buf = await resp.buffer();
        if (segmentDataCache.size >= SEGMENT_CACHE_MAX_SIZE) {
          segmentDataCache.delete(segmentDataCache.keys().next().value);
        }
        segmentDataCache.set(encodedUrl, { data: buf, timestamp: Date.now(), contentType: 'video/mp2t' });
        success++;
        if (success % 20 === 0) console.log(`[vod] Prefetch progress: ${success}/${segments.length} for ${contentId}`);
      } else {
        failed++;
        if (resp.status === 503 || resp.status === 403) {
          console.log(`[vod] Prefetch URLs expired at segment ${i}, got ${success} segments`);
          break;
        }
      }
    } catch (e) { failed++; }
    
    // Tiny delay to be nice to upstream
    await new Promise(r => setTimeout(r, 20));
  }
  
  prefetchActive.delete(contentId);
  console.log(`[vod] PREFETCH DONE: ${success} cached, ${failed} failed for ${contentId}`);
}

// Segment proxy with cache
app.get('/vod/:providerId/segment/:encodedUrl', async (req, res) => {
  const { providerId, encodedUrl } = req.params;
  const { cid } = req.query;

  const provider = providerRegistry.get(providerId);
  if (!provider) return res.status(404).send('Unknown provider');

  if (cid) {
    provider.touchStream(cid);
    provider.startStreamRefresh(cid, 'movie');
  }

  // SERVE FROM CACHE
  const cached = segmentDataCache.get(encodedUrl);
  if (cached) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('X-Cache', 'HIT');
    return res.send(cached.data);
  }

  // Fetch from upstream
  try {
    const segmentUrl = Buffer.from(encodedUrl, 'base64url').toString('utf8');
    let headers = provider.getProxyHeaders();
    if (cid && provider._streamHeaders?.[cid]) headers = provider._streamHeaders[cid];

    const fetch = (await import('node-fetch')).default;
    const resp = await fetch(segmentUrl, {
      headers: { ...headers, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });

    if (!resp.ok) {
      console.log(`[vod] Segment ${resp.status} for ${cid}`);
      if (resp.status === 503 || resp.status === 403) {
        return res.status(410).send('Segment expired');
      }
      return res.status(resp.status).send('Error');
    }

    const buffer = await resp.buffer();
    
    // Cache it
    if (segmentDataCache.size >= SEGMENT_CACHE_MAX_SIZE) {
      segmentDataCache.delete(segmentDataCache.keys().next().value);
    }
    segmentDataCache.set(encodedUrl, { data: buffer, timestamp: Date.now(), contentType: 'video/mp2t' });

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('X-Cache', 'MISS');
    res.send(buffer);
  } catch (e) {
    console.error(`[vod] Segment error:`, e.message);
    res.status(500).send('Error');
  }
});

// CinemaOS Movie Playlist (from TMDB database)
app.get('/cinemaos/playlist.m3u', (req, res) => {
  try {
    // Load database if needed
    if (cinemaosManager.movies.size === 0) {
      cinemaosManager.loadDatabase();
    }

    if (cinemaosManager.movies.size === 0) {
      return res.status(404).send('Playlist not generated yet. POST to /cinemaos/fetch-full first.');
    }

    // Get host from request to generate correct URLs
    const host = req.headers.host || `${config.host}:${config.port}`;
    process.env.TUNER_HOST = host;

    // Regenerate playlist with correct host
    cinemaosManager.generateM3U();

    const m3uPath = path.join(__dirname, 'data', 'cinemaos-movies.m3u');
    res.setHeader('Content-Type', 'application/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="cinemaos-movies.m3u"');
    res.sendFile(m3uPath);
  } catch (error) {
    console.error('[cinemaos] Playlist error:', error.message);
    res.status(500).send('Error generating playlist');
  }
});

// Generate CinemaOS playlist from database
app.post('/cinemaos/generate-playlist', async (req, res) => {
  try {
    const { maxMovies, minVotes, minRating, sortBy } = req.query;
    const host = req.headers.host || `${config.host}:${config.port}`;

    // Use new database manager
    process.env.TUNER_HOST = host;
    process.env.DATA_DIR = path.join(__dirname, 'data');

    delete require.cache[require.resolve('./cinemaos-db-manager')];
    const CinemaOSDbManager = require('./cinemaos-db-manager');
    const manager = new CinemaOSDbManager();
    manager.loadDatabase();

    const result = manager.generateM3U({
      maxMovies: maxMovies ? parseInt(maxMovies) : 0,
      minVotes: minVotes ? parseInt(minVotes) : 0,
      minRating: minRating ? parseFloat(minRating) : 0,
      sortBy: sortBy || 'popularity'
    });

    res.json({
      success: true,
      totalMovies: result.totalMovies,
      playlistUrl: `http://${host}/cinemaos/playlist.m3u`,
      fileSize: `${(result.fileSize / 1024).toFixed(1)} KB`
    });

  } catch (error) {
    console.error('[cinemaos] Playlist generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// CinemaOS database stats
app.get('/cinemaos/stats', (req, res) => {
  try {
    // Use global manager which has auto-refresh state
    if (cinemaosManager.movies.size === 0) {
      cinemaosManager.loadDatabase();
    }
    res.json(cinemaosManager.getStats());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CinemaOS auto-refresh status
app.get('/cinemaos/auto-refresh/status', (req, res) => {
  res.json(cinemaosManager.getAutoRefreshStatus());
});

// Stop CinemaOS auto-refresh
app.post('/cinemaos/auto-refresh/stop', (req, res) => {
  cinemaosManager.stopAutoRefresh();
  res.json({ success: true, message: 'Auto-refresh stopped' });
});

// Start/restart CinemaOS auto-refresh
app.post('/cinemaos/auto-refresh/start', (req, res) => {
  const { hours } = req.query;
  const intervalHours = hours ? parseInt(hours) : 6;

  // Stop existing if running
  cinemaosManager.stopAutoRefresh();

  // Start with new interval
  cinemaosManager.startAutoRefresh(intervalHours);

  res.json({
    success: true,
    message: `Auto-refresh started (every ${intervalHours} hours)`,
    status: cinemaosManager.getAutoRefreshStatus()
  });
});

// CinemaOS full database fetch (takes 30-60 min)
app.post('/cinemaos/fetch-full', async (req, res) => {
  try {
    const host = req.headers.host || `${config.host}:${config.port}`;
    process.env.TUNER_HOST = host;
    process.env.DATA_DIR = path.join(__dirname, 'data');

    delete require.cache[require.resolve('./cinemaos-db-manager')];
    const CinemaOSDbManager = require('./cinemaos-db-manager');
    const manager = new CinemaOSDbManager();

    console.log('[cinemaos] Starting full database fetch (this will take 30-60 minutes)...');

    // Run in background
    manager.fullFetch().then(() => {
      manager.generateM3U();
      console.log('[cinemaos] Full fetch complete, playlist regenerated');
    }).catch(err => {
      console.error('[cinemaos] Full fetch error:', err.message);
    });

    res.json({
      success: true,
      message: 'Full database fetch started in background. This will take 30-60 minutes.',
      checkStatus: `http://${host}/cinemaos/stats`
    });

  } catch (error) {
    console.error('[cinemaos] Fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// CinemaOS incremental update (only new movies)
app.post('/cinemaos/update', async (req, res) => {
  try {
    const host = req.headers.host || `${config.host}:${config.port}`;
    process.env.TUNER_HOST = host;
    process.env.DATA_DIR = path.join(__dirname, 'data');

    delete require.cache[require.resolve('./cinemaos-db-manager')];
    const CinemaOSDbManager = require('./cinemaos-db-manager');
    const manager = new CinemaOSDbManager();

    console.log('[cinemaos] Starting incremental update...');

    // Run in background
    manager.incrementalUpdate().then((stats) => {
      if (stats.new > 0) {
        manager.generateM3U();
        console.log(`[cinemaos] Update complete: ${stats.new} new movies added`);
      } else {
        console.log('[cinemaos] Update complete: no new movies found');
      }
    }).catch(err => {
      console.error('[cinemaos] Update error:', err.message);
    });

    res.json({
      success: true,
      message: 'Incremental update started in background.',
      checkStatus: `http://${host}/cinemaos/stats`
    });

  } catch (error) {
    console.error('[cinemaos] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ================== CINEBY TV SHOW ENDPOINTS ==================

// TV Shows M3U Playlist
app.get('/tv/playlist.m3u', (req, res) => {
  try {
    // Load database if needed
    if (tvManager.shows.size === 0) {
      tvManager.loadDatabase();
    }

    if (tvManager.shows.size === 0) {
      return res.status(404).send('TV playlist not generated yet. POST to /tv/fetch-full first.');
    }

    // Get host from request to generate correct URLs
    const host = req.headers.host || `${config.host}:${config.port}`;
    process.env.TUNER_HOST = host;

    // Regenerate playlist with correct host
    tvManager.generateM3U();

    const m3uPath = path.join(__dirname, 'data', 'cineby-tv.m3u');
    res.setHeader('Content-Type', 'application/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="cineby-tv.m3u"');
    res.sendFile(m3uPath);
  } catch (error) {
    console.error('[tv] Playlist error:', error.message);
    res.status(500).send('Error generating playlist');
  }
});

// TV database stats
app.get('/tv/stats', (req, res) => {
  try {
    if (tvManager.shows.size === 0) {
      tvManager.loadDatabase();
    }
    res.json(tvManager.getStats());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// TV auto-refresh status
app.get('/tv/auto-refresh/status', (req, res) => {
  res.json(tvManager.getAutoRefreshStatus());
});

// Stop TV auto-refresh
app.post('/tv/auto-refresh/stop', (req, res) => {
  tvManager.stopAutoRefresh();
  res.json({ success: true, message: 'TV auto-refresh stopped' });
});

// Start/restart TV auto-refresh
app.post('/tv/auto-refresh/start', (req, res) => {
  const { hours } = req.query;
  const intervalHours = hours ? parseInt(hours) : 1; // Default 1 hour for TV

  tvManager.stopAutoRefresh();
  tvManager.startAutoRefresh(intervalHours);

  res.json({
    success: true,
    message: `TV auto-refresh started (every ${intervalHours} hour${intervalHours > 1 ? 's' : ''})`,
    status: tvManager.getAutoRefreshStatus()
  });
});

// TV full database fetch
app.post('/tv/fetch-full', async (req, res) => {
  try {
    const host = req.headers.host || `${config.host}:${config.port}`;
    process.env.TUNER_HOST = host;
    process.env.DATA_DIR = path.join(__dirname, 'data');

    console.log('[tv] Starting full database fetch...');

    // Run in background
    tvManager.fullFetch().then(() => {
      tvManager.generateM3U();
      console.log('[tv] Full fetch complete, playlist regenerated');
    }).catch(err => {
      console.error('[tv] Full fetch error:', err.message);
    });

    res.json({
      success: true,
      message: 'Full TV database fetch started in background.',
      checkStatus: `http://${host}/tv/stats`
    });

  } catch (error) {
    console.error('[tv] Fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// TV incremental update
app.post('/tv/update', async (req, res) => {
  try {
    const host = req.headers.host || `${config.host}:${config.port}`;
    process.env.TUNER_HOST = host;
    process.env.DATA_DIR = path.join(__dirname, 'data');

    console.log('[tv] Starting incremental update...');

    // Run in background
    tvManager.incrementalUpdate().then((stats) => {
      if (stats.new > 0) {
        tvManager.generateM3U();
        console.log(`[tv] Update complete: ${stats.new} new TV shows added`);
      } else {
        console.log('[tv] Update complete: no new TV shows found');
      }
    }).catch(err => {
      console.error('[tv] Update error:', err.message);
    });

    res.json({
      success: true,
      message: 'Incremental update started in background.',
      checkStatus: `http://${host}/tv/stats`
    });

  } catch (error) {
    console.error('[tv] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Generate TV playlist with options
app.post('/tv/generate-playlist', async (req, res) => {
  try {
    const { maxShows, minVotes, minRating, sortBy } = req.query;
    const host = req.headers.host || `${config.host}:${config.port}`;

    process.env.TUNER_HOST = host;
    process.env.DATA_DIR = path.join(__dirname, 'data');

    if (tvManager.shows.size === 0) {
      tvManager.loadDatabase();
    }

    const result = tvManager.generateM3U({
      maxShows: maxShows ? parseInt(maxShows) : 0,
      minVotes: minVotes ? parseInt(minVotes) : 0,
      minRating: minRating ? parseFloat(minRating) : 0,
      sortBy: sortBy || 'popularity'
    });

    res.json({
      success: true,
      totalShows: result.totalShows,
      playlistUrl: `http://${host}/tv/playlist.m3u`,
      fileSize: `${(result.fileSize / 1024).toFixed(1)} KB`
    });

  } catch (error) {
    console.error('[tv] Playlist generation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ================== END CINEBY TV SHOW ENDPOINTS ==================

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
// Login watcher - monitors for login and triggers EPG refresh when logged in
let loginWatcherActive = false;
let loginDetected = false;

async function startLoginWatcher() {
  if (loginWatcherActive) return;
  loginWatcherActive = true;
  loginDetected = false;
  
  console.log("[login-watcher] Starting login monitor...");
  
  const checkInterval = 10000; // Check every 10 seconds
  const maxWait = 600000; // Max 10 minutes
  let waited = 0;
  
  const check = async () => {
    try {
      const tuner = tunerManager.getTuner(0);
      if (tuner && tuner.page) {
        const url = tuner.page.url();
        const isLoggedIn = url.includes("stream.directv.com") && 
          !url.includes("login") && 
          !url.includes("signin") && 
          !url.includes("auth");
        
        if (isLoggedIn && !loginDetected) {
          loginDetected = true;
          console.log("[login-watcher] Login detected! Triggering EPG refresh...");
          
          // Check if EPG is empty or stale
          const epgStatus = directvEpg.getStatus();
          if (epgStatus.channelCount === 0 || epgStatus.cacheAge > 14400) {
            try {
              await directvEpg.fetchFromBrowser();
              console.log("[login-watcher] EPG refresh completed");
            } catch (e) {
              console.error("[login-watcher] EPG refresh failed:", e.message);
            }
          } else {
            console.log("[login-watcher] EPG already has " + epgStatus.channelCount + " channels");
          }
          loginWatcherActive = false;
          return;
        } else if (!isLoggedIn) {
          console.log("[login-watcher] Waiting for login... (URL: " + url.substring(0, 50) + "...)");
        }
      }
    } catch (e) {
      console.log("[login-watcher] Check error:", e.message);
    }
    
    waited += checkInterval;
    if (waited < maxWait) {
      setTimeout(check, checkInterval);
    } else {
      console.log("[login-watcher] Timeout waiting for login");
      loginWatcherActive = false;
    }
  };
  
  // Start checking after 15 seconds (give browser time to load)
  setTimeout(check, 15000);
}


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
    console.log('CinemaOS Movies (23,000+ movies with auto-refresh):');
    console.log(`  M3U Playlist:     http://<host>:${config.port}/cinemaos/playlist.m3u`);
    console.log(`  Database Stats:   http://<host>:${config.port}/cinemaos/stats`);
    console.log(`  Auto-refresh:     http://<host>:${config.port}/cinemaos/auto-refresh/status`);
    console.log('');
    console.log('TV Shows (with hourly auto-refresh):');
    console.log(`  M3U Playlist:     http://<host>:${config.port}/tv/playlist.m3u`);
    console.log(`  Database Stats:   http://<host>:${config.port}/tv/stats`);
    console.log(`  Auto-refresh:     http://<host>:${config.port}/tv/auto-refresh/status`);
    console.log('');
    console.log('Add the M3U URL to TvMate or VLC to start watching!');
    console.log('='.repeat(60));

    // Start login watcher - checks for login and triggers EPG refresh
    startLoginWatcher();

    // Start EPG auto-refresh (every 4 hours)
    directvEpg.startAutoRefresh();

    // Start CinemaOS movie database auto-refresh (every 6 hours)
    process.env.DATA_DIR = path.join(__dirname, 'data');
    process.env.TUNER_HOST = `${config.host}:${config.port}`;
    cinemaosManager.loadDatabase();
    cinemaosManager.startAutoRefresh(6);

    // Start TV shows database auto-refresh (every 1 hour)
    tvManager.loadDatabase();
    tvManager.startAutoRefresh(1);
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
