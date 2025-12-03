const path = require('path');
const os = require('os');

// Detect platform for FFmpeg capture settings
const isMac = os.platform() === 'darwin';
const isLinux = os.platform() === 'linux';

// Low resource mode for FFmpeg - reduces CPU usage for NAS and weak hardware
const lowResourceFFmpeg = process.env.DVR_LOW_RESOURCE_FFMPEG === 'true';

module.exports = {
  // Server settings
  port: parseInt(process.env.DVR_PORT) || 7070,
  host: process.env.DVR_HOST || '0.0.0.0',

  // Low resource mode flag (FFmpeg only - Chrome has its own DVR_LOW_RESOURCE_CHROME)
  lowResourceFFmpeg,

  // Tuner settings
  numTuners: parseInt(process.env.DVR_NUM_TUNERS) || 1,
  baseDebugPort: parseInt(process.env.CHROME_DEBUG_PORT) || 9222,
  baseDisplayNum: 1,  // Xvfb display :1 in Docker

  // Paths - Docker optimized
  hlsDir: process.env.DVR_HLS_DIR || '/data/streams',
  chromeProfile: process.env.DVR_CHROME_PROFILE || '/data/chrome-profile',

  // Chrome settings - Linux in Docker
  chromePath: '/usr/bin/google-chrome-stable',

  // Timing
  idleTimeout: 300000,  // 5 min before releasing idle tuner
  ffmpegIdleTimeout: parseInt(process.env.DVR_FFMPEG_IDLE_TIMEOUT) || 30000,  // 30 sec before stopping FFmpeg when no clients
  channelSwitchDelay: 5000,  // Wait for video to start after navigation
  ffmpegStartDelay: 3000,  // Wait after FFmpeg starts before serving

  // Video settings - lower in low resource mode
  resolution: {
    width: lowResourceFFmpeg ? 1280 : 1920,
    height: lowResourceFFmpeg ? 720 : 1080,
  },
  videoBitrate: lowResourceFFmpeg ? '2M' : '4M',
  audioBitrate: lowResourceFFmpeg ? '96k' : '128k',

  // HLS settings (better for multiple clients watching same channel)
  hlsMode: process.env.DVR_HLS_MODE !== 'false', // Default true, set DVR_HLS_MODE=false to use MPEG-TS pipe
  hls: {
    segmentTime: parseInt(process.env.DVR_HLS_SEGMENT_TIME) || 4,  // Seconds per segment (4s = less HTTP overhead)
    listSize: parseInt(process.env.DVR_HLS_LIST_SIZE) || 6,        // Segments in playlist (24s buffer)
  },
  hlsSegmentTime: 4,  // Legacy
  hlsListSize: 6,     // Legacy

  // Hardware acceleration settings
  // DVR_HW_ACCEL: 'none' | 'nvenc' | 'vaapi' | 'qsv' (auto-detected from env)
  hwAccel: process.env.DVR_HW_ACCEL || 'none',

  // NVENC-specific settings
  nvenc: {
    preset: process.env.DVR_NVENC_PRESET || 'p4',  // p1 (fastest) to p7 (best quality)
    tune: process.env.DVR_NVENC_TUNE || 'll',      // ll (low latency), ull (ultra low latency), hq (high quality)
    rc: process.env.DVR_NVENC_RC || 'vbr',         // vbr, cbr, cq
    // Lookahead can improve quality but adds latency
    lookahead: parseInt(process.env.DVR_NVENC_LOOKAHEAD) || 0,
    // B-frames (0 for lowest latency)
    bframes: parseInt(process.env.DVR_NVENC_BFRAMES) || 0,
  },

  // QSV-specific settings (for Intel, future use)
  qsv: {
    preset: process.env.DVR_QSV_PRESET || 'fast',
  },

  // Platform-specific FFmpeg settings
  ffmpeg: {
    // macOS: Use avfoundation for screen capture
    mac: {
      videoInput: '-f avfoundation -framerate 30 -capture_cursor 0',
      inputDevice: '"1:none"',
    },
    // Linux: Use x11grab + PulseAudio
    linux: {
      videoInput: '-f x11grab -framerate 30',
      audioInput: '-f pulse -i default',
    },
  },

  // Get platform-appropriate FFmpeg command parts
  getPlatform() {
    return 'linux';  // Always Linux in Docker
  },

  // Check if hardware acceleration is enabled
  isHwAccelEnabled() {
    return this.hwAccel !== 'none';
  },

  // Get the encoder to use
  getEncoder() {
    switch (this.hwAccel) {
      case 'nvenc':
        return 'h264_nvenc';
      case 'vaapi':
        return 'h264_vaapi';
      case 'qsv':
        return 'h264_qsv';
      default:
        return 'libx264';
    }
  },
};
