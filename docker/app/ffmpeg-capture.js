const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const config = require('./config');
const settingsManager = require('./settings-manager');

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

    // HLS output mode (better for multiple clients)
    this.hlsMode = config.hlsMode !== false; // Default to HLS mode
    this.hlsDir = path.join(config.hlsDir || '/data/streams', `tuner-${tunerId}`);
    this.hlsPlaylist = path.join(this.hlsDir, 'stream.m3u8');
    this.hlsSegmentTime = config.hls?.segmentTime || 2;
    this.hlsListSize = config.hls?.listSize || 5;

    // Segment size monitor for black screen detection
    this.segmentMonitorInterval = null;
    this.segmentMonitorEnabled = process.env.DVR_SEGMENT_MONITOR !== 'false'; // Default enabled
    this.minSegmentSize = parseInt(process.env.DVR_MIN_SEGMENT_SIZE) || 50000; // 50KB threshold (black ~14KB, normal ~500KB)
    this.smallSegmentCount = 0;
    this.smallSegmentThreshold = parseInt(process.env.DVR_SMALL_SEGMENT_THRESHOLD) || 3; // 3 consecutive small segments triggers retune
    this.onBlackScreenDetected = null; // Callback for black screen detection

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
      // Linux: Read user settings from settingsManager (falls back to defaults)
      const settings = settingsManager.getSettings();
      const videoBitrate = settings.video?.bitrate || config.videoBitrate || '4M';
      const audioBitrate = settings.audio?.bitrate || config.audioBitrate || '128k';
      const width = settings.video?.resolution?.width || config.resolution?.width || 1280;
      const height = settings.video?.resolution?.height || config.resolution?.height || 720;
      // HLS settings from user config
      this.hlsSegmentTime = settings.hls?.segmentTime || config.hls?.segmentTime || 4;
      this.hlsListSize = settings.hls?.listSize || config.hls?.listSize || 6;
      // Use instance hwAccel which may have been downgraded from NVENC to none
      // hwAccel comes from config (env var), not user settings
      const hwAccel = this.useHwAccel;
      const encoder = hwAccel === 'nvenc' ? 'h264_nvenc' :
                      (hwAccel === 'qsv' ? 'h264_qsv' :
                      (hwAccel === 'vaapi' ? 'h264_vaapi' : 'libx264'));

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
        // Intel QuickSync hardware encoding
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
      } else if (hwAccel === 'vaapi') {
        // Intel VAAPI hardware encoding (Linux)
        console.log(`[ffmpeg-${this.tunerId}] VAAPI settings: using /dev/dri/renderD128`);

        videoEncoderArgs = [
          '-c:v', 'h264_vaapi',
          '-profile:v', 'high',
          '-level', '4.1',
          '-b:v', videoBitrate,
          '-maxrate', videoBitrate,
          '-bufsize', '12M',
          '-g', '60',
          '-bf', '0',
        ];
      } else {
        // Software encoding (libx264)
        if (config.lowResourceFFmpeg) {
          // Low resource mode: faster encoding, less CPU
          console.log(`[ffmpeg-${this.tunerId}] Low resource FFmpeg mode: superfast preset, reduced quality`);
          videoEncoderArgs = [
            '-c:v', 'libx264',
            '-preset', 'superfast',
            '-tune', 'zerolatency',
            '-profile:v', 'main',
            '-level', '4.0',
            '-pix_fmt', 'yuv420p',
            '-crf', '26',
            '-b:v', videoBitrate,
            '-maxrate', videoBitrate,
            '-bufsize', '1M',
            '-g', '60',
            '-bf', '0',
            '-refs', '1',
            '-flags', '+cgop',
          ];
        } else {
          // Standard quality settings (unchanged)
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
      }

      // Output format: HLS segments or MPEG-TS pipe
      let outputArgs;
      if (this.hlsMode) {
        // Ensure HLS directory exists
        if (!fs.existsSync(this.hlsDir)) {
          fs.mkdirSync(this.hlsDir, { recursive: true });
        }
        // Clean old segments
        const oldFiles = fs.readdirSync(this.hlsDir).filter(f => f.endsWith('.ts') || f.endsWith('.m3u8'));
        for (const f of oldFiles) {
          try { fs.unlinkSync(path.join(this.hlsDir, f)); } catch (e) {}
        }

        outputArgs = [
          '-f', 'hls',
          '-hls_time', String(this.hlsSegmentTime),
          '-hls_list_size', String(this.hlsListSize),
          '-hls_flags', 'delete_segments+append_list',
          '-hls_segment_filename', path.join(this.hlsDir, 'segment%03d.ts'),
          this.hlsPlaylist,
        ];
        console.log(`[ffmpeg-${this.tunerId}] HLS mode: ${this.hlsSegmentTime}s segments, ${this.hlsListSize} in playlist`);
      } else {
        outputArgs = [
          '-f', 'mpegts',
          'pipe:1',
        ];
      }

      // Use per-tuner audio sink for isolated audio capture
      const audioSink = `virtual_speaker_${this.tunerId}.monitor`;

      // Hardware acceleration initialization args
      let hwInitArgs = [];
      let vaapiFilter = [];
      if (hwAccel === 'qsv') {
        hwInitArgs = ['-init_hw_device', 'qsv=qsv:hw', '-filter_hw_device', 'qsv'];
      } else if (hwAccel === 'vaapi') {
        hwInitArgs = ['-vaapi_device', '/dev/dri/renderD128'];
        vaapiFilter = ['-vf', 'format=nv12,hwupload'];
      }

      args = [
        ...hwInitArgs,
        '-fflags', '+genpts',
        '-thread_queue_size', '1024',
        '-f', 'x11grab',
        '-framerate', '30',
        '-video_size', `${width}x${height}`,
        '-i', `:${displayNum}`,
        '-thread_queue_size', '1024',
        '-f', 'pulse',
        '-ac', '2',
        '-i', audioSink,
        ...vaapiFilter,
        ...videoEncoderArgs,
        '-c:a', 'aac',
        '-b:a', audioBitrate,
        '-ar', '48000',
        '-ac', '2',
        '-af', 'aresample=async=1:min_hard_comp=0.1:first_pts=0',
        '-vsync', 'cfr',
        ...outputArgs,
      ];
    }

    console.log(`[ffmpeg-${this.tunerId}] Starting ${this.hlsMode ? 'HLS' : 'MPEG-TS'} capture...`);
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

    // Start segment monitor after FFmpeg is running (with delay for first segments)
    if (this.hlsMode && this.segmentMonitorEnabled) {
      setTimeout(() => {
        if (this.isRunning) {
          this.startSegmentMonitor();
        }
      }, (this.hlsSegmentTime * 2 + 2) * 1000); // Wait for 2 segments + buffer
    }
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
    this.stopSegmentMonitor();
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

  async startPlaceholder(displayNum, message) {
    // Stop any existing stream first
    if (this.isRunning && this.process) {
      await this.stopAndWait();
    }

    this.displayNum = displayNum;
    this.shouldRestart = true;
    this.restartAttempts = 0;
    this.stopping = false;

    this.broadcastStream = new PassThrough();

    this.stats.startTime = Date.now();
    this.stats.bytesTransferred = 0;
    this.stats.errors = [];
    this.stats.encoder = 'lavfi (placeholder)';

    // Read user settings for placeholder resolution
    const settings = settingsManager.getSettings();
    const width = settings.video?.resolution?.width || config.resolution?.width || 1920;
    const height = settings.video?.resolution?.height || config.resolution?.height || 1080;
    const videoBitrate = settings.video?.bitrate || config.videoBitrate || '4M';

    // Escape special characters for FFmpeg drawtext filter
    const escapedMessage = message
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");

    // Generate placeholder with test pattern and text overlay
    // Using lavfi (libavfilter virtual input) to generate video
    const args = [
      '-f', 'lavfi',
      '-i', `color=c=0x1a1a2e:s=${width}x${height}:r=30,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-60:text='No Upcoming Airings',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=32:fontcolor=0xcccccc:x=(w-text_w)/2:y=(h-text_h)/2+20:text='Please change channel',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=24:fontcolor=0x888888:x=(w-text_w)/2:y=h-80:text='DirecTV Tuner'`,
      '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=stereo',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'stillimage',
      '-pix_fmt', 'yuv420p',
      '-b:v', '500k',
      '-g', '60',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'mpegts',
      'pipe:1',
    ];

    console.log(`[ffmpeg-${this.tunerId}] Starting placeholder stream...`);
    console.log(`[ffmpeg-${this.tunerId}] Message: ${message}`);

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
            console.log(`[ffmpeg-${this.tunerId}] Placeholder client write error, ${this.clients.length} remaining`);
          }
        } else {
          this.clients.splice(i, 1);
          console.log(`[ffmpeg-${this.tunerId}] Removed dead placeholder client, ${this.clients.length} remaining`);
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        console.error(`[ffmpeg-${this.tunerId}] Placeholder error: ${msg}`);
      }
    });

    this.process.on('close', (code) => {
      console.log(`[ffmpeg-${this.tunerId}] Placeholder stream ended with code ${code}`);
      this.isRunning = false;
      this.process = null;
    });

    this.isRunning = true;
    console.log(`[ffmpeg-${this.tunerId}] Placeholder MPEG-TS stream ready`);
  }

  stop() {
    this.cancelIdleTimer();
    this.stopSegmentMonitor();
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
    if (this.hlsMode) {
      return this.hlsPlaylist;
    }
    return null;
  }

  getSegmentPath(filename) {
    if (this.hlsMode) {
      return path.join(this.hlsDir, filename);
    }
    return null;
  }

  // Check if HLS playlist is ready (has segments)
  isHlsReady() {
    if (!this.hlsMode) return false;
    try {
      if (!fs.existsSync(this.hlsPlaylist)) return false;
      const content = fs.readFileSync(this.hlsPlaylist, 'utf8');
      return content.includes('.ts');
    } catch (e) {
      return false;
    }
  }

  // Get HLS directory for this tuner
  getHlsDir() {
    return this.hlsDir;
  }

  isHlsMode() {
    return this.hlsMode;
  }

  // Set callback for black screen detection
  setBlackScreenCallback(callback) {
    this.onBlackScreenDetected = callback;
  }

  // Start monitoring segment sizes for black screen detection
  startSegmentMonitor() {
    if (!this.hlsMode || !this.segmentMonitorEnabled) {
      return;
    }

    this.stopSegmentMonitor(); // Clear any existing monitor
    this.smallSegmentCount = 0;

    // Check every segment interval (segment time + 1 second buffer)
    const checkInterval = (this.hlsSegmentTime + 1) * 1000;

    console.log(`[ffmpeg-${this.tunerId}] Starting segment size monitor (check every ${checkInterval/1000}s, min size: ${this.minSegmentSize} bytes)`);

    this.segmentMonitorInterval = setInterval(() => {
      this.checkSegmentSizes();
    }, checkInterval);
  }

  // Stop the segment monitor
  stopSegmentMonitor() {
    if (this.segmentMonitorInterval) {
      clearInterval(this.segmentMonitorInterval);
      this.segmentMonitorInterval = null;
    }
    this.smallSegmentCount = 0;
  }

  // Check the latest segment sizes
  checkSegmentSizes() {
    if (!this.isRunning || !this.hlsMode) {
      return;
    }

    try {
      const files = fs.readdirSync(this.hlsDir)
        .filter(f => f.endsWith('.ts'))
        .map(f => ({
          name: f,
          path: path.join(this.hlsDir, f),
          stat: fs.statSync(path.join(this.hlsDir, f))
        }))
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs); // Newest first

      if (files.length === 0) {
        return;
      }

      // Check the most recent segment
      const latestSegment = files[0];
      const segmentSize = latestSegment.stat.size;

      if (segmentSize < this.minSegmentSize) {
        this.smallSegmentCount++;
        console.log(`[ffmpeg-${this.tunerId}] Small segment detected: ${latestSegment.name} = ${segmentSize} bytes (${this.smallSegmentCount}/${this.smallSegmentThreshold})`);

        if (this.smallSegmentCount >= this.smallSegmentThreshold) {
          console.warn(`[ffmpeg-${this.tunerId}] BLACK SCREEN DETECTED: ${this.smallSegmentCount} consecutive small segments`);
          this.smallSegmentCount = 0; // Reset counter

          // Trigger callback if set
          if (this.onBlackScreenDetected) {
            this.onBlackScreenDetected(this.tunerId);
          }
        }
      } else {
        // Reset counter on good segment
        if (this.smallSegmentCount > 0) {
          console.log(`[ffmpeg-${this.tunerId}] Good segment: ${latestSegment.name} = ${segmentSize} bytes, resetting counter`);
        }
        this.smallSegmentCount = 0;
      }

      // Update stats with latest segment info
      this.stats.latestSegmentSize = segmentSize;
      this.stats.latestSegmentName = latestSegment.name;

    } catch (err) {
      console.error(`[ffmpeg-${this.tunerId}] Segment monitor error: ${err.message}`);
    }
  }

  // Get segment monitor status
  getSegmentMonitorStatus() {
    return {
      enabled: this.segmentMonitorEnabled,
      running: this.segmentMonitorInterval !== null,
      minSegmentSize: this.minSegmentSize,
      smallSegmentCount: this.smallSegmentCount,
      smallSegmentThreshold: this.smallSegmentThreshold,
      latestSegmentSize: this.stats.latestSegmentSize || null,
      latestSegmentName: this.stats.latestSegmentName || null
    };
  }
}

module.exports = FFmpegCapture;
