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
    this.clients = [];
    this.broadcastStream = null;
    this.shouldRestart = false;
    this.displayNum = 1;
    this.restartAttempts = 0;
    this.maxRestartAttempts = 5;
    this.restartDelay = 2000;
    this.stopping = false; // New flag to track stopping state

    this.stats = {
      startTime: null,
      bytesTransferred: 0,
      framesProcessed: 0,
      errors: [],
      lastActivity: null,
      restarts: 0
    };
  }

  // Helper method to wait for process to fully terminate
  async waitForProcessExit(timeout = 5000) {
    if (!this.process) return true;
    
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (!this.process || !this.isRunning) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          // Force kill if still running
          if (this.process) {
            console.log(`[ffmpeg-${this.tunerId}] Force killing hung process`);
            this.process.kill('SIGKILL');
          }
          resolve(false);
        }
      }, 100);
    });
  }

  async start(displayNum) {
    // Prevent concurrent start calls while stopping
    if (this.stopping) {
      console.log(`[ffmpeg-${this.tunerId}] Waiting for stop to complete...`);
      await this.waitForProcessExit(5000);
    }

    if (this.isRunning && this.process) {
      console.log(`[ffmpeg-${this.tunerId}] Already running, stopping for channel switch...`);
      this.shouldRestart = false;
      await this.stopAndWait();
    }

    this.displayNum = displayNum;
    this.shouldRestart = true;
    this.restartAttempts = 0;
    this.stopping = false;

    const platform = config.getPlatform();

    this.broadcastStream = new PassThrough();

    this.stats.startTime = Date.now();
    this.stats.bytesTransferred = 0;
    this.stats.errors = [];

    let args;

    if (platform === 'mac') {
      args = [
        '-f', 'avfoundation',
        '-framerate', '30',
        '-capture_cursor', '0',
        '-i', '1:none',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-s', `${config.resolution.width}x${config.resolution.height}`,
        '-b:v', config.videoBitrate,
        '-maxrate', config.videoBitrate,
        '-bufsize', '1M',
        '-g', '30',
        '-f', 'mpegts',
        'pipe:1',
      ];
    } else {
      // Linux: Use config values for resolution, bitrate, audio
      const videoBitrate = config.videoBitrate || '4M';
      const audioBitrate = config.audioBitrate || '128k';
      const width = config.resolution?.width || 1280;
      const height = config.resolution?.height || 720;

      console.log(`[ffmpeg-${this.tunerId}] Using settings: ${width}x${height} @ ${videoBitrate} video, ${audioBitrate} audio`);

      args = [
        '-thread_queue_size', '1024',
        '-f', 'x11grab',
        '-framerate', '30',
        '-video_size', `${width}x${height}`,
        '-i', `:${displayNum}`,
        '-thread_queue_size', '1024',
        '-f', 'pulse',
        '-ac', '2',
        '-i', 'virtual_speaker.monitor',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-profile:v', 'high',
        '-level', '4.1',
        '-pix_fmt', 'yuv420p',
        '-crf', '23',
        '-b:v', videoBitrate,
        '-maxrate', videoBitrate,
        '-bufsize', '2M',
        '-g', '60',
        '-keyint_min', '30',
        '-bf', '2',
        '-b_strategy', '1',
        '-sc_threshold', '40',
        '-refs', '3',
        '-flags', '+cgop',
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-ar', '48000',
        '-ac', '2',
        '-async', '1',
        '-vsync', 'cfr',
        '-muxdelay', '0',
        '-muxpreload', '0',
        '-f', 'mpegts',
        'pipe:1',
      ];
    }

    console.log(`[ffmpeg-${this.tunerId}] Starting MPEG-TS capture...`);

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (data) => {
      this.stats.bytesTransferred += data.length;
      this.stats.lastActivity = Date.now();

      for (let i = this.clients.length - 1; i >= 0; i--) {
        const client = this.clients[i];
        if (client.writable && !client.destroyed) {
          try {
            client.write(data);
          } catch (err) {
            this.clients.splice(i, 1);
            console.log(`[ffmpeg-${this.tunerId}] Client write error, ${this.clients.length} remaining`);
          }
        } else {
          this.clients.splice(i, 1);
          console.log(`[ffmpeg-${this.tunerId}] Removed dead client, ${this.clients.length} remaining`);
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('frame=')) {
        const frameMatch = msg.match(/frame=\s*(\d+)/);
        if (frameMatch) {
          this.stats.framesProcessed = parseInt(frameMatch[1]);
        }
      }
      if (msg.includes('Error') || msg.includes('error')) {
        console.error(`[ffmpeg-${this.tunerId}] ${msg}`);
        this.stats.errors.push({ time: Date.now(), message: msg.trim() });
        if (this.stats.errors.length > 10) {
          this.stats.errors.shift();
        }
      }
    });

    this.process.on('close', (code) => {
      console.log(`[ffmpeg-${this.tunerId}] Process exited with code ${code}`);
      this.isRunning = false;
      this.process = null;
      this.stopping = false;

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
          return;
        } else {
          console.error(`[ffmpeg-${this.tunerId}] Max restart attempts reached, giving up`);
        }
      }

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

    await new Promise(r => setTimeout(r, 500));
    console.log(`[ffmpeg-${this.tunerId}] MPEG-TS stream ready`);
  }

  addClient(res) {
    this.clients.push(res);
    console.log(`[ffmpeg-${this.tunerId}] Client connected, ${this.clients.length} total`);

    res.on('close', () => {
      const idx = this.clients.indexOf(res);
      if (idx !== -1) {
        this.clients.splice(idx, 1);
        console.log(`[ffmpeg-${this.tunerId}] Client disconnected, ${this.clients.length} remaining`);
      }
    });
  }

  getClientCount() {
    return this.clients.length;
  }

  // New method: stop and wait for process to fully terminate
  async stopAndWait() {
    this.shouldRestart = false;
    this.stopping = true;

    if (this.process) {
      console.log(`[ffmpeg-${this.tunerId}] Stopping capture and waiting...`);
      
      const proc = this.process;
      proc.kill('SIGTERM');

      // Wait for process to exit
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (proc && !proc.killed) {
            console.log(`[ffmpeg-${this.tunerId}] Force killing after timeout`);
            proc.kill('SIGKILL');
          }
          resolve();
        }, 3000);

        proc.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.process = null;
      this.isRunning = false;
    }

    // Clear clients
    for (const client of this.clients) {
      if (!client.destroyed) {
        client.end();
      }
    }
    this.clients = [];
    this.stopping = false;
  }

  stop() {
    this.shouldRestart = false;
    this.stopping = true;

    if (this.process) {
      console.log(`[ffmpeg-${this.tunerId}] Stopping capture...`);
      const proc = this.process;
      proc.kill('SIGTERM');

      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 3000);

      // Don't null the process here - let the 'close' event handle it
    }

    for (const client of this.clients) {
      if (!client.destroyed) {
        client.end();
      }
    }
    this.clients = [];
  }

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
      errors: this.stats.errors.slice(-5),
      errorCount: this.stats.errors.length,
      restarts: this.stats.restarts,
      lastActivity: this.stats.lastActivity,
      healthy: this.isRunning && (Date.now() - (this.stats.lastActivity || 0)) < 5000
    };
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

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

  getPlaylistPath() {
    return null;
  }

  getSegmentPath(filename) {
    return null;
  }
}

module.exports = FFmpegCapture;
