const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

class FFmpegCapture {
  constructor(tunerId, outputDir) {
    this.tunerId = tunerId;
    this.outputDir = outputDir;
    this.process = null;
    this.isRunning = false;
  }

  async start(displayNum) {
    if (this.isRunning) {
      console.log(`[ffmpeg-${this.tunerId}] Already running`);
      return;
    }

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Clean up old segments
    this.cleanupSegments();

    const outputPath = path.join(this.outputDir, 'stream.m3u8');
    const platform = config.getPlatform();

    let args;

    if (platform === 'mac') {
      // macOS: Use avfoundation
      // Screen device index 1 (usually main display)
      // Note: For audio, you'd need BlackHole or similar virtual audio device
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
        '-bufsize', '5M',
        '-g', '60',  // Keyframe every 2 seconds at 30fps
        '-f', 'hls',
        '-hls_time', String(config.hlsSegmentTime),
        '-hls_list_size', String(config.hlsListSize),
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', path.join(this.outputDir, 'segment%03d.ts'),
        outputPath,
      ];
    } else {
      // Linux: Use x11grab + PulseAudio
      args = [
        '-f', 'x11grab',
        '-framerate', '30',
        '-video_size', `${config.resolution.width}x${config.resolution.height}`,
        '-i', `:${displayNum}`,
        '-f', 'pulse',
        '-i', 'default',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-b:v', config.videoBitrate,
        '-maxrate', config.videoBitrate,
        '-bufsize', '5M',
        '-c:a', 'aac',
        '-b:a', config.audioBitrate,
        '-g', '60',
        '-f', 'hls',
        '-hls_time', String(config.hlsSegmentTime),
        '-hls_list_size', String(config.hlsListSize),
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', path.join(this.outputDir, 'segment%03d.ts'),
        outputPath,
      ];
    }

    console.log(`[ffmpeg-${this.tunerId}] Starting capture...`);
    console.log(`[ffmpeg-${this.tunerId}] Output: ${outputPath}`);

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (data) => {
      // FFmpeg outputs to stderr, stdout is usually empty
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      // Only log important messages
      if (msg.includes('Error') || msg.includes('error')) {
        console.error(`[ffmpeg-${this.tunerId}] ${msg}`);
      }
    });

    this.process.on('close', (code) => {
      console.log(`[ffmpeg-${this.tunerId}] Process exited with code ${code}`);
      this.isRunning = false;
      this.process = null;
    });

    this.process.on('error', (err) => {
      console.error(`[ffmpeg-${this.tunerId}] Error:`, err.message);
      this.isRunning = false;
    });

    this.isRunning = true;

    // Wait a bit for FFmpeg to initialize
    await this.waitForPlaylist();
  }

  async waitForPlaylist() {
    const playlistPath = path.join(this.outputDir, 'stream.m3u8');
    const maxWait = 15000;  // 15 seconds max
    const checkInterval = 500;
    let waited = 0;

    while (waited < maxWait) {
      if (fs.existsSync(playlistPath)) {
        const content = fs.readFileSync(playlistPath, 'utf8');
        // Wait until we have at least one segment
        if (content.includes('.ts')) {
          console.log(`[ffmpeg-${this.tunerId}] Playlist ready after ${waited}ms`);
          return true;
        }
      }
      await new Promise(r => setTimeout(r, checkInterval));
      waited += checkInterval;
    }

    console.warn(`[ffmpeg-${this.tunerId}] Playlist not ready after ${maxWait}ms`);
    return false;
  }

  stop() {
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
  }

  cleanupSegments() {
    if (!fs.existsSync(this.outputDir)) return;

    const files = fs.readdirSync(this.outputDir);
    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
        fs.unlinkSync(path.join(this.outputDir, file));
      }
    }
    console.log(`[ffmpeg-${this.tunerId}] Cleaned up old segments`);
  }

  getPlaylistPath() {
    return path.join(this.outputDir, 'stream.m3u8');
  }

  getSegmentPath(filename) {
    return path.join(this.outputDir, filename);
  }
}

module.exports = FFmpegCapture;
