const path = require('path');
const os = require('os');

// Detect platform for FFmpeg capture settings
const isMac = os.platform() === 'darwin';
const isLinux = os.platform() === 'linux';

module.exports = {
  // Server settings
  port: parseInt(process.env.DVR_PORT) || 7070,
  host: process.env.DVR_HOST || '0.0.0.0',

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

  // Video settings - 1080p for better quality
  resolution: {
    width: 1920,
    height: 1080,
  },
  videoBitrate: '4M',
  audioBitrate: '128k',
  hlsSegmentTime: 2,
  hlsListSize: 5,

  // Hardware acceleration settings
  // DVR_HW_ACCEL: 'none' | 'nvenc' | 'qsv' (auto-detected from env)
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
      case 'qsv':
        return 'h264_qsv';
      default:
        return 'libx264';
    }
  },
};
