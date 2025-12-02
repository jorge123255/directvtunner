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
    this.idleTimer = null; // Timer for idle timeout
    this.idleTimeout = config.ffmpegIdleTimeout || 30000; // Default 30 seconds
    this.useHwAccel = config.hwAccel; // Track current hw accel mode (can fallback to 'none')
    this.hwAccelFailed = false; // Track if hw accel failed for this session
    this.nvencErrorDetected = false; // Track if we saw actual NVENC errors (not just process kill)

    this.stats = {
      startTime: null,
      bytesTransferred: 0,
      framesProcessed: 0,
      errors: [],
      lastActivity: null,
      restarts: 0,
      encoder: null // Track which encoder is actually being used
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

    // Always reset to try NVENC on new stream start
    // The fallback only persists within a single stream session
    this.hwAccelFailed = false;
    this.nvencErrorDetected = false;
    this.useHwAccel = config.hwAccel;

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
      // Use instance hwAccel which may have been downgraded from NVENC to none
      const hwAccel = this.useHwAccel;
      const encoder = hwAccel === 'nvenc' ? 'h264_nvenc' : (hwAccel === 'qsv' ? 'h264_qsv' : 'libx264');

      console.log(`[ffmpeg-${this.tunerId}] Using settings: ${width}x${height} @ ${videoBitrate} video, ${audioBitrate} audio`);
      console.log(`[ffmpeg-${this.tunerId}] Encoder: ${encoder} (hwAccel: ${hwAccel})${this.hwAccelFailed ? ' [NVENC failed, using fallback]' : ''}`);
      this.stats.encoder = encoder;

      // Build video encoder arguments based on hardware acceleration
      let videoEncoderArgs;

      if (hwAccel === 'nvenc') {
        // NVIDIA NVENC hardware encoding
        const nvencPreset = config.nvenc?.preset || 'p4';
        const nvencTune = config.nvenc?.tune || 'll';
        const nvencRc = config.nvenc?.rc || 'vbr';
        const nvencBframes = config.nvenc?.bframes || 0;

        console.log(`[ffmpeg-${this.tunerId}] NVENC settings: preset=${nvencPreset}, tune=${nvencTune}, rc=${nvencRc}`);

        videoEncoderArgs = [
          '-c:v', 'h264_nvenc',
          '-preset', nvencPreset,
          '-tune', nvencTune,
          '-rc', nvencRc,
          '-profile:v', 'high',
          '-level', '4.1',
          '-pix_fmt', 'yuv420p',
          '-b:v', videoBitrate,
          '-maxrate', videoBitrate,
          '-bufsize', '2M',
          '-g', '60',
          '-bf', String(nvencBframes),
          '-flags', '+cgop',
        ];

        // Add lookahead if configured (0 = disabled)
        if (config.nvenc?.lookahead > 0) {
          videoEncoderArgs.push('-rc-lookahead', String(config.nvenc.lookahead));
        }
      } else if (hwAccel === 'qsv') {
        // Intel QuickSync hardware encoding (future)
        const qsvPreset = config.qsv?.preset || 'fast';

        console.log(`[ffmpeg-${this.tunerId}] QSV settings: preset=${qsvPreset}`);

        videoEncoderArgs = [
          '-c:v', 'h264_qsv',
          '-preset', qsvPreset,
          '-profile:v', 'high',
          '-level', '4.1',
          '-pix_fmt', 'nv12',
          '-b:v', videoBitrate,
          '-maxrate', videoBitrate,
          '-bufsize', '2M',
          '-g', '60',
          '-bf', '0',
          '-flags', '+cgop',
        ];
      } else {
        // Software encoding (libx264)
        videoEncoderArgs = [
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
        ];
      }

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
        ...videoEncoderArgs,
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
    console.log(`[ffmpeg-${this.tunerId}] FFmpeg args: ffmpeg ${args.join(' ')}`);

    // Set environment variables for FFmpeg
    // PULSE_SERVER is needed for PulseAudio to connect properly in Docker
    const ffmpegEnv = {
      ...process.env,
      DISPLAY: `:${displayNum}`,
      PULSE_SERVER: 'unix:/var/run/pulse/native',
    };

    // Small delay before spawning FFmpeg to ensure GPU encoder is ready
    // This helps with "hit or miss" NVENC initialization issues
    if (this.useHwAccel === 'nvenc') {
      console.log(`[ffmpeg-${this.tunerId}] Waiting 500ms for NVENC readiness...`);
      await new Promise(r => setTimeout(r, 500));
    }

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: ffmpegEnv,
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
      // Log encoder initialization - helps debug "hit or miss" GPU issues
      if (msg.includes('h264_nvenc')) {
        console.log(`[ffmpeg-${this.tunerId}] NVENC encoder initialized: ${msg.trim().substring(0, 200)}`);
      }
      if (msg.includes('libx264')) {
        console.log(`[ffmpeg-${this.tunerId}] libx264 encoder initialized: ${msg.trim().substring(0, 200)}`);
      }
      // Log any CUDA/GPU-related messages
      if (msg.includes('CUDA') || msg.includes('cuda') || msg.includes('GPU') || msg.includes('nvenc')) {
        console.log(`[ffmpeg-${this.tunerId}] GPU: ${msg.trim().substring(0, 200)}`);
      }
      // Detect actual NVENC initialization failures
      if (msg.includes('Cannot load') || msg.includes('No NVENC capable') ||
          msg.includes('nvenc') && (msg.includes('error') || msg.includes('Error') || msg.includes('failed'))) {
        console.error(`[ffmpeg-${this.tunerId}] NVENC ERROR DETECTED: ${msg.trim()}`);
        this.nvencErrorDetected = true;
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
      const uptime = this.stats.startTime ? Date.now() - this.stats.startTime : 0;
      console.log(`[ffmpeg-${this.tunerId}] Process exited with code ${code} after ${uptime}ms`);
      this.isRunning = false;
      this.process = null;
      this.stopping = false;

      // Check if NVENC actually failed (not just killed) - only fallback if we saw real NVENC errors
      // Code 255 is also returned on SIGTERM, so we need actual error detection
      if (code !== 0 && uptime < 5000 && this.useHwAccel === 'nvenc' && !this.hwAccelFailed && this.nvencErrorDetected) {
        console.warn(`[ffmpeg-${this.tunerId}] NVENC failed with actual errors (${uptime}ms), falling back to software encoding`);
        this.hwAccelFailed = true;
        this.useHwAccel = 'none';
        this.restartAttempts = 0; // Reset restart attempts for fallback

        if (this.shouldRestart || this.clients.length > 0) {
          console.log(`[ffmpeg-${this.tunerId}] Restarting with libx264...`);
          setTimeout(() => {
            if (!this.isRunning) {
              this.start(this.displayNum);
            }
          }, 500);
          return;
        }
      }

      // Reset NVENC error flag for next attempt
      this.nvencErrorDetected = false;

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
    // Cancel any pending idle timeout since we have a new client
    this.cancelIdleTimer();

    this.clients.push(res);
    console.log(`[ffmpeg-${this.tunerId}] Client connected, ${this.clients.length} total`);

    res.on('close', () => {
      const idx = this.clients.indexOf(res);
      if (idx !== -1) {
        this.clients.splice(idx, 1);
        console.log(`[ffmpeg-${this.tunerId}] Client disconnected, ${this.clients.length} remaining`);

        // Start idle timer if no clients remaining
        if (this.clients.length === 0 && this.isRunning) {
          this.startIdleTimer();
        }
      }
    });
  }

  // Start the idle timer to stop FFmpeg after timeout
  startIdleTimer() {
    this.cancelIdleTimer(); // Clear any existing timer

    console.log(`[ffmpeg-${this.tunerId}] No clients, starting ${this.idleTimeout / 1000}s idle timer to release GPU`);

    this.idleTimer = setTimeout(() => {
      if (this.clients.length === 0 && this.isRunning) {
        console.log(`[ffmpeg-${this.tunerId}] Idle timeout reached, stopping FFmpeg to release GPU`);
        this.stopForIdle();
      }
    }, this.idleTimeout);
  }

  // Cancel the idle timer (called when a client connects)
  cancelIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // Stop FFmpeg due to idle timeout (different from regular stop)
  stopForIdle() {
    this.cancelIdleTimer();
    this.shouldRestart = false; // Don't auto-restart
    this.stopping = true;

    if (this.process) {
      console.log(`[ffmpeg-${this.tunerId}] Stopping capture (idle timeout)...`);
      const proc = this.process;
      proc.kill('SIGTERM');

      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 3000);
    }
    // Note: Don't clear clients here since there shouldn't be any
  }

  getClientCount() {
    return this.clients.length;
  }

  // New method: stop and wait for process to fully terminate
  async stopAndWait() {
    this.cancelIdleTimer();
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
    this.cancelIdleTimer();
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
      healthy: this.isRunning && (Date.now() - (this.stats.lastActivity || 0)) < 5000,
      encoder: this.stats.encoder,
      hwAccel: this.useHwAccel,
      hwAccelFailed: this.hwAccelFailed
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
