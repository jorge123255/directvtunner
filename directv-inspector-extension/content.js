// Content script - runs in the page context to capture browser fingerprinting

(function() {
  'use strict';

  console.log('[DirecTV Inspector] Content script loaded on:', window.location.href);

  // Collect page data
  function collectPageData() {
    const data = {
      url: window.location.href,
      timestamp: Date.now(),

      // Navigator properties (commonly used for fingerprinting)
      navigator: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        languages: navigator.languages ? [...navigator.languages] : null,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        maxTouchPoints: navigator.maxTouchPoints,
        webdriver: navigator.webdriver,
        cookieEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        plugins: Array.from(navigator.plugins || []).map(p => ({
          name: p.name,
          filename: p.filename,
          description: p.description
        })),
        mimeTypes: Array.from(navigator.mimeTypes || []).map(m => ({
          type: m.type,
          suffixes: m.suffixes
        }))
      },

      // Screen info
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth
      },

      // Window info
      window: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio
      },

      // Check for automation indicators
      automationIndicators: {
        webdriver: navigator.webdriver,
        hasChrome: !!window.chrome,
        hasChromeRuntime: !!(window.chrome && window.chrome.runtime),
        hasCallPhantom: !!window.callPhantom,
        hasPhantom: !!window._phantom,
        hasNightmare: !!window.__nightmare,
        hasSelenium: !!window._selenium,
        hasWebDriver: !!window.webdriver,
        hasDomAutomation: !!window.domAutomation,
        hasDomAutomationController: !!window.domAutomationController,
        hasCDC: Object.keys(window).filter(k => k.startsWith('cdc_')).length > 0,
        cdcKeys: Object.keys(window).filter(k => k.startsWith('cdc_'))
      },

      // localStorage items
      localStorage: Object.keys(localStorage).reduce((acc, key) => {
        try {
          acc[key] = localStorage.getItem(key)?.substring(0, 200); // Truncate long values
        } catch (e) {}
        return acc;
      }, {}),

      // sessionStorage items
      sessionStorage: Object.keys(sessionStorage).reduce((acc, key) => {
        try {
          acc[key] = sessionStorage.getItem(key)?.substring(0, 200);
        } catch (e) {}
        return acc;
      }, {}),

      // Cookies (document.cookie)
      cookies: document.cookie
    };

    return data;
  }

  // Capture WebGL info (fingerprinting)
  function getWebGLInfo() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return null;

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION)
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  // Monitor for specific function calls that might be fingerprinting
  function setupMonitoring() {
    // Monitor canvas fingerprinting
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      console.log('[DirecTV Inspector] Canvas toDataURL called - possible fingerprinting');
      sendToBackground({ event: 'canvasFingerprint', args: args.map(String) });
      return originalToDataURL.apply(this, args);
    };

    // Monitor WebGL getParameter
    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445 || param === 37446) { // UNMASKED_VENDOR/RENDERER
        console.log('[DirecTV Inspector] WebGL fingerprint detected, param:', param);
        sendToBackground({ event: 'webglFingerprint', param });
      }
      return originalGetParameter.apply(this, arguments);
    };

    // Monitor permissions query
    const originalQuery = navigator.permissions?.query;
    if (originalQuery) {
      navigator.permissions.query = function(desc) {
        console.log('[DirecTV Inspector] Permissions query:', desc.name);
        sendToBackground({ event: 'permissionsQuery', name: desc.name });
        return originalQuery.apply(this, arguments);
      };
    }

    // Monitor AudioContext (fingerprinting)
    const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
    if (OriginalAudioContext) {
      window.AudioContext = function(...args) {
        console.log('[DirecTV Inspector] AudioContext created - possible fingerprinting');
        sendToBackground({ event: 'audioContextCreated' });
        return new OriginalAudioContext(...args);
      };
      window.AudioContext.prototype = OriginalAudioContext.prototype;
    }
  }

  // Send data to background script
  function sendToBackground(data) {
    try {
      chrome.runtime.sendMessage({ action: 'contentScriptData', data });
    } catch (e) {
      console.log('[DirecTV Inspector] Could not send to background:', e.message);
    }
  }

  // Monitor EME (Encrypted Media Extensions) for DRM
  function monitorEME() {
    // Monitor requestMediaKeySystemAccess
    const originalRequestMKSA = navigator.requestMediaKeySystemAccess;
    if (originalRequestMKSA) {
      navigator.requestMediaKeySystemAccess = async function(keySystem, configs) {
        console.log('[DirecTV Inspector] EME requestMediaKeySystemAccess:', keySystem);
        console.log('[DirecTV Inspector] EME configs:', JSON.stringify(configs, null, 2));
        sendToBackground({
          event: 'emeRequest',
          keySystem,
          configs: configs
        });

        try {
          const result = await originalRequestMKSA.apply(this, arguments);
          console.log('[DirecTV Inspector] EME access granted for:', keySystem);
          sendToBackground({ event: 'emeGranted', keySystem });
          return result;
        } catch (err) {
          console.log('[DirecTV Inspector] EME access denied:', err.message);
          sendToBackground({ event: 'emeDenied', keySystem, error: err.message });
          throw err;
        }
      };
    }
  }

  // Monitor fetch/XHR for interesting requests
  function monitorNetwork() {
    // Monitor fetch
    const originalFetch = window.fetch;
    window.fetch = async function(url, options) {
      const urlStr = url.toString();
      if (urlStr.includes('license') || urlStr.includes('drm') ||
          urlStr.includes('fingerprint') || urlStr.includes('bot') ||
          urlStr.includes('captcha') || urlStr.includes('challenge')) {
        console.log('[DirecTV Inspector] Interesting fetch:', urlStr);
        sendToBackground({
          event: 'interestingFetch',
          url: urlStr,
          method: options?.method || 'GET',
          headers: options?.headers
        });
      }
      return originalFetch.apply(this, arguments);
    };
  }

  // Run on page load
  function init() {
    setupMonitoring();
    monitorEME();
    monitorNetwork();

    // Collect initial page data
    const pageData = collectPageData();
    pageData.webgl = getWebGLInfo();

    console.log('[DirecTV Inspector] Initial page data:', pageData);
    sendToBackground({ event: 'pageLoad', pageData });

    // Also collect when DOM is fully loaded
    if (document.readyState === 'complete') {
      sendToBackground({ event: 'domComplete', pageData: collectPageData() });
    } else {
      window.addEventListener('load', () => {
        sendToBackground({ event: 'domComplete', pageData: collectPageData() });
      });
    }
  }

  // Start
  init();
})();
