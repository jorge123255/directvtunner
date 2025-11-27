// Preload script for DVR Player
// This runs in the renderer process before the page loads

const { contextBridge } = require('electron');

// Hide Electron fingerprints
delete window.process;
delete window.require;

// Expose minimal API to the renderer
contextBridge.exposeInMainWorld('dvrPlayer', {
  version: '1.0.0',
  platform: process.platform,
  // Log function for debugging
  log: (message) => {
    console.log('[dvr-player] [renderer]', message);
  }
});

// Log when preload is executed
console.log('[dvr-player] Preload script loaded');

// Check for Widevine support once DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  console.log('[dvr-player] DOM ready, checking EME support...');

  // Check if EME (Encrypted Media Extensions) is available
  if (navigator.requestMediaKeySystemAccess) {
    console.log('[dvr-player] EME API is available');

    // Test Widevine availability
    const config = [{
      initDataTypes: ['cenc'],
      videoCapabilities: [{
        contentType: 'video/mp4; codecs="avc1.42E01E"'
      }],
      audioCapabilities: [{
        contentType: 'audio/mp4; codecs="mp4a.40.2"'
      }]
    }];

    navigator.requestMediaKeySystemAccess('com.widevine.alpha', config)
      .then((keySystemAccess) => {
        console.log('[dvr-player] Widevine CDM is available!');
        console.log('[dvr-player] Key system:', keySystemAccess.keySystem);
      })
      .catch((err) => {
        console.error('[dvr-player] Widevine CDM NOT available:', err.message);
      });
  } else {
    console.error('[dvr-player] EME API is NOT available');
  }
});
