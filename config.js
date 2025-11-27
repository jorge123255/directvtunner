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
  baseDebugPort: 9222,
  baseDisplayNum: 99,

  // Paths
  hlsDir: process.env.DVR_HLS_DIR || path.join(os.tmpdir(), 'dvr-streams'),
  chromeProfile: process.env.DVR_CHROME_PROFILE || path.join(__dirname, 'chrome-debug-profile'),

  // Chrome settings
  chromePath: isMac
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome',

  // Timing
  idleTimeout: 300000,  // 5 min before releasing idle tuner
  channelSwitchDelay: 5000,  // Wait for video to start after navigation
  ffmpegStartDelay: 3000,  // Wait after FFmpeg starts before serving

  // Video settings
  resolution: {
    width: 1280,
    height: 720,
  },
  videoBitrate: '2500k',
  audioBitrate: '128k',
  hlsSegmentTime: 4,
  hlsListSize: 5,

  // Platform-specific FFmpeg settings
  ffmpeg: {
    // macOS: Use avfoundation for screen capture
    // Note: Requires screen recording permission
    mac: {
      videoInput: '-f avfoundation -framerate 30 -capture_cursor 0',
      // "1" is typically the screen, "0" is typically the built-in mic
      // Use "1:none" if no audio needed, or "1:0" for mic
      // For system audio, need BlackHole or similar
      inputDevice: '"1:none"',  // Screen only, no audio yet
    },
    // Linux: Use x11grab + PulseAudio
    linux: {
      videoInput: '-f x11grab -framerate 30',
      audioInput: '-f pulse -i default',
    },
  },

  // Get platform-appropriate FFmpeg command parts
  getPlatform() {
    return isMac ? 'mac' : 'linux';
  },
};
