const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const config = require('./config');

class FFmpegCapture {
  constructor(tunerId, outputDir) {
    this.tunerId = tunerId;
    this.outputDir = outputDir;
    this.process = null;
    this.isRunning = false;
    this.clients = [];  // Connected HTTP response streams
    this.broadcastStream = null;  // PassThrough stream for multicasting
    this.shouldRestart = false;  // Auto-reconnect flag
    this.displayNum = 1;  // Store display number for restart
    this.restartAttempts = 0;
    this.maxRestartAttempts = 5;
    this.restartDelay = 2000;  // 2 seconds between restart attempts

    // Stream statistics for health monitoring
    this.stats = {
      startTime: null,
      bytesTransferred: 0,
      framesProcessed: 0,
      errors: [],
      lastActivity: null,
      restarts: 0
    };
  }

  async start(displayNum) {
    // If already running, stop first (for channel switching)
    if (this.isRunning) {
      console.log(`[ffmpeg-${this.tunerId}] Already running, stopping for channel switch...`);
      this.shouldRestart = false;  // Disable auto-restart during channel switch
      this.stop();
      await new Promise(r => setTimeout(r, 500));
    }

    this.displayNum = displayNum;  // Store for auto-restart
    this.shouldRestart = true;  // Enable auto-restart
    this.restartAttempts = 0;  // Reset restart counter

    const platform = config.getPlatform();

    // Create broadcast stream for multicasting to multiple clients
    this.broadcastStream = new PassThrough();

    // Reset stats
    this.stats.startTime = Date.now();
    this.stats.bytesTransferred = 0;
    this.stats.errors = [];

    let args;

    if (platform === 'mac') {
      // macOS: Use avfoundation, output MPEG-TS to stdout
      args = [
        '-f', 'avfoundation',
        '-framerate', '30',
        '-capture_cursor', '0',
        '-i', '1:none',  // Screen only, no audio for now
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-s', `${config.resolution.width}x${config.resolution.height}`,
        '-b:v', config.videoBitrate,
        '-maxrate', config.videoBitrate,
        '-bufsize', '1M',
        '-g', '30',  // Keyframe every 1 second at 30fps
        '-f', 'mpegts',
        'pipe:1',  // Output to stdout
      ];
    } else {
      // Linux: MPEG-TS direct streaming to stdout with all improvements
      args = [
        // Input thread queue size for smoother capture (increased for stability)
        '-thread_queue_size', '1024',
        // Video input (x11grab)
        '-f', 'x11grab',
        '-framerate', '30',
        '-video_size', `${config.resolution.width}x${config.resolution.height}`,
        '-i', `:${displayNum}`,
        // Audio input (PulseAudio)
        '-thread_queue_size', '1024',
        '-f', 'pulse',
        '-ac', '2',
        '-i', 'virtual_speaker.monitor',
        // Video encoding - high quality streaming
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-profile:v', 'high',
        '-level', '4.1',
        '-pix_fmt', 'yuv420p',
        // Adaptive bitrate range - CRF with max bitrate constraint
        '-crf', '23',  // Quality-based encoding
        '-b:v', '8M',
        '-maxrate', '10M',  // Allow bursts up to 10Mbps for complex scenes
        '-bufsize', '8M',  // Larger buffer for smoother playback
        '-g', '60',  // Keyframe every 2 seconds (better compression)
        '-keyint_min', '30',
        '-bf', '2',  // B-frames for better compression
        '-b_strategy', '1',  // Adaptive B-frame placement
        '-sc_threshold', '40',  // Scene change detection
        '-refs', '3',  // Reference frames for better quality
        '-flags', '+cgop',
        // Audio encoding - improved quality
        '-c:a', 'aac',
        '-b:a', '192k',  // Upgraded from 128k for better audio
        '-ar', '48000',  // Higher sample rate
        '-ac', '2',
        // Muxing options for better streaming
        '-muxdelay', '0',
        '-muxpreload', '0',
        // Output MPEG-TS to stdout
        '-f', 'mpegts',
        'pipe:1',
      ];
    }

    console.log(`[ffmpeg-${this.tunerId}] Starting MPEG-TS capture...`);

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Pipe FFmpeg stdout to broadcast stream
    this.process.stdout.on('data', (data) => {
      // Update stats
      this.stats.bytesTransferred += data.length;
      this.stats.lastActivity = Date.now();

      // Write to all connected clients
      for (let i = this.clients.length - 1; i >= 0; i--) {
        const client = this.clients[i];
        if (client.writable && !client.destroyed) {
          try {
            client.write(data);
          } catch (err) {
            // Client write error, remove it
            this.clients.splice(i, 1);
            console.log(`[ffmpeg-${this.tunerId}] Client write error, ${this.clients.length} remaining`);
          }
        } else {
          // Remove dead clients
          this.clients.splice(i, 1);
          console.log(`[ffmpeg-${this.tunerId}] Removed dead client, ${this.clients.length} remaining`);
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      // Parse FFmpeg progress info for stats
      if (msg.includes('frame=')) {
        const frameMatch = msg.match(/frame=\s*(\d+)/);
        if (frameMatch) {
          this.stats.framesProcessed = parseInt(frameMatch[1]);
        }
      }
      // Log errors
      if (msg.includes('Error') || msg.includes('error')) {
        console.error(`[ffmpeg-${this.tunerId}] ${msg}`);
        this.stats.errors.push({ time: Date.now(), message: msg.trim() });
        // Keep only last 10 errors
        if (this.stats.errors.length > 10) {
          this.stats.errors.shift();
        }
      }
    });

    this.process.on('close', (code) => {
      console.log(`[ffmpeg-${this.tunerId}] Process exited with code ${code}`);
      this.isRunning = false;
      this.process = null;

      // Auto-restart if enabled and has clients
      if (this.shouldRestart && this.clients.length > 0 && code !== 0) {
        this.restartAttempts++;
        if (this.restartAttempts <= this.maxRestartAttempts) {
          console.log(`[ffmpeg-${this.tunerId}] Auto-restarting (attempt ${this.restartAttempts}/${this.maxRestartAttempts})...`);
          this.stats.restarts++;
          setTimeout(() => {
            if (this.shouldRestart && !this.isRunning) {
              this.start(this.displayNum);
            }
          }, this.restartDelay);
          return;  // Don't end client connections, keep them for restart
        } else {
          console.error(`[ffmpeg-${this.tunerId}] Max restart attempts reached, giving up`);
        }
      }

      // End all client connections
      for (const client of this.clients) {
        if (!client.destroyed) {
          client.end();
        }
      }
      this.clients = [];
    });

    this.process.on('error', (err) => {
      console.error(`[ffmpeg-${this.tunerId}] Error:`, err.message);
      this.stats.errors.push({ time: Date.now(), message: err.message });
      this.isRunning = false;
    });

    this.isRunning = true;

    // Give FFmpeg a moment to start producing output
    await new Promise(r => setTimeout(r, 500));
    console.log(`[ffmpeg-${this.tunerId}] MPEG-TS stream ready`);
  }

  // Add a client to receive the MPEG-TS stream
  addClient(res) {
    this.clients.push(res);
    console.log(`[ffmpeg-${this.tunerId}] Client connected, ${this.clients.length} total`);

    // Remove client when connection closes
    res.on('close', () => {
      const idx = this.clients.indexOf(res);
      if (idx !== -1) {
        this.clients.splice(idx, 1);
        console.log(`[ffmpeg-${this.tunerId}] Client disconnected, ${this.clients.length} remaining`);
      }
    });
  }

  // Get number of connected clients
  getClientCount() {
    return this.clients.length;
  }

  stop() {
    this.shouldRestart = false;  // Disable auto-restart when explicitly stopped

    if (this.process) {
      console.log(`[ffmpeg-${this.tunerId}] Stopping capture...`);
      this.process.kill('SIGTERM');

      // Force kill after 3 seconds if still running
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 3000);

      this.process = null;
      this.isRunning = false;
    }

    // End all client connections
    for (const client of this.clients) {
      if (!client.destroyed) {
        client.end();
      }
    }
    this.clients = [];
  }

  // Get stream health statistics
  getStats() {
    const uptime = this.stats.startTime ? Date.now() - this.stats.startTime : 0;
    const avgBitrate = uptime > 0 ? (this.stats.bytesTransferred * 8 / (uptime / 1000)) : 0;

    return {
      isRunning: this.isRunning,
      uptime: uptime,
      uptimeFormatted: this.formatDuration(uptime),
      bytesTransferred: this.stats.bytesTransferred,
      bytesFormatted: this.formatBytes(this.stats.bytesTransferred),
      framesProcessed: this.stats.framesProcessed,
      avgBitrateMbps: (avgBitrate / 1000000).toFixed(2),
      clientCount: this.clients.length,
      errors: this.stats.errors.slice(-5),  // Last 5 errors
      errorCount: this.stats.errors.length,
      restarts: this.stats.restarts,
      lastActivity: this.stats.lastActivity,
      healthy: this.isRunning && (Date.now() - (this.stats.lastActivity || 0)) < 5000
    };
  }

  // Format bytes to human readable
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Format duration to human readable
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  // Legacy methods for compatibility (no longer used for MPEG-TS)
  getPlaylistPath() {
    return null;
  }

  getSegmentPath(filename) {
    return null;
  }
}

module.exports = FFmpegCapture;
