const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, 'data', 'settings.json');

// Default settings - matches current config.js values
const DEFAULTS = {
  video: {
    resolution: { width: 1280, height: 720 },
    bitrate: '2500k'
  },
  audio: {
    bitrate: '128k'
  },
  hls: {
    segmentTime: 4,
    listSize: 5
  },
  epg: {
    refreshInterval: 4
  },
  tuners: {
    count: 1
  }
};

let cachedSettings = null;

/**
 * Load settings from settings.json, merging with defaults
 */
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
      const saved = JSON.parse(data);
      // Deep merge with defaults
      cachedSettings = deepMerge(DEFAULTS, saved);
    } else {
      cachedSettings = { ...DEFAULTS };
    }
  } catch (err) {
    console.warn('[settings] Failed to load settings.json, using defaults:', err.message);
    cachedSettings = { ...DEFAULTS };
  }
  return cachedSettings;
}

/**
 * Save settings to settings.json
 */
function saveSettings(newSettings) {
  // Validate and normalize
  const settings = {
    video: {
      resolution: {
        width: parseInt(newSettings.video?.resolution?.width) || DEFAULTS.video.resolution.width,
        height: parseInt(newSettings.video?.resolution?.height) || DEFAULTS.video.resolution.height
      },
      bitrate: String(newSettings.video?.bitrate || DEFAULTS.video.bitrate)
    },
    audio: {
      bitrate: String(newSettings.audio?.bitrate || DEFAULTS.audio.bitrate)
    },
    hls: {
      segmentTime: parseInt(newSettings.hls?.segmentTime) || DEFAULTS.hls.segmentTime,
      listSize: parseInt(newSettings.hls?.listSize) || DEFAULTS.hls.listSize
    },
    epg: {
      refreshInterval: parseInt(newSettings.epg?.refreshInterval) || DEFAULTS.epg.refreshInterval
    },
    tuners: {
      count: parseInt(newSettings.tuners?.count) || DEFAULTS.tuners.count
    }
  };

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  cachedSettings = settings;
  return settings;
}

/**
 * Get current settings (cached)
 */
function getSettings() {
  if (!cachedSettings) {
    loadSettings();
  }
  return cachedSettings;
}

/**
 * Get default settings
 */
function getDefaults() {
  return { ...DEFAULTS };
}

/**
 * Deep merge helper
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = {
  loadSettings,
  saveSettings,
  getSettings,
  getDefaults,
  DEFAULTS
};
