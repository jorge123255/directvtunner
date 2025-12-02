/**
 * Quality presets for DirecTV Tuner
 */
const presets = {
  '720p-low': {
    name: '720p Low Bandwidth',
    description: 'Best for slow connections (2 Mbps)',
    settings: {
      video: {
        resolution: { width: 1280, height: 720 },
        bitrate: '2M'
      },
      audio: {
        bitrate: '96k'
      },
      hls: {
        segmentTime: 4,
        listSize: 5
      }
    }
  },
  '720p-standard': {
    name: '720p Standard',
    description: 'Balanced quality (3 Mbps)',
    settings: {
      video: {
        resolution: { width: 1280, height: 720 },
        bitrate: '3M'
      },
      audio: {
        bitrate: '128k'
      },
      hls: {
        segmentTime: 4,
        listSize: 5
      }
    }
  },
  '1080p-standard': {
    name: '1080p Standard',
    description: 'Recommended default (4 Mbps)',
    settings: {
      video: {
        resolution: { width: 1920, height: 1080 },
        bitrate: '4M'
      },
      audio: {
        bitrate: '128k'
      },
      hls: {
        segmentTime: 2,
        listSize: 5
      }
    }
  },
  '1080p-high': {
    name: '1080p High Quality',
    description: 'Best for local network (6 Mbps)',
    settings: {
      video: {
        resolution: { width: 1920, height: 1080 },
        bitrate: '6M'
      },
      audio: {
        bitrate: '192k'
      },
      hls: {
        segmentTime: 2,
        listSize: 5
      }
    }
  }
};

/**
 * Get all presets
 */
function getPresets() {
  return Object.entries(presets).map(([id, preset]) => ({
    id,
    name: preset.name,
    description: preset.description
  }));
}

/**
 * Get a specific preset by ID
 */
function getPreset(id) {
  return presets[id] || null;
}

module.exports = {
  presets,
  getPresets,
  getPreset
};
