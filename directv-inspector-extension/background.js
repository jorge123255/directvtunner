// Background service worker - captures network requests and cookies

let capturedData = {
  requests: [],
  cookies: [],
  headers: [],
  startTime: null,
  isRecording: false
};

// Start/stop recording
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startRecording') {
    capturedData = {
      requests: [],
      cookies: [],
      headers: [],
      startTime: Date.now(),
      isRecording: true
    };
    console.log('[DirecTV Inspector] Recording started');
    sendResponse({ success: true });
  } else if (message.action === 'stopRecording') {
    capturedData.isRecording = false;
    console.log('[DirecTV Inspector] Recording stopped');
    sendResponse({ success: true });
  } else if (message.action === 'getData') {
    sendResponse(capturedData);
  } else if (message.action === 'exportData') {
    // Get all cookies for directv.com
    chrome.cookies.getAll({ domain: 'directv.com' }, (cookies) => {
      capturedData.cookies = cookies;
      sendResponse(capturedData);
    });
    return true; // Keep channel open for async response
  } else if (message.action === 'contentScriptData') {
    // Data from content script
    if (capturedData.isRecording) {
      capturedData.pageData = capturedData.pageData || [];
      capturedData.pageData.push({
        timestamp: Date.now(),
        url: sender.tab?.url,
        ...message.data
      });
    }
    sendResponse({ received: true });
  }
  return true;
});

// Capture all network requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!capturedData.isRecording) return;

    const entry = {
      timestamp: Date.now(),
      type: 'request',
      method: details.method,
      url: details.url,
      requestId: details.requestId,
      tabId: details.tabId,
      requestBody: details.requestBody
    };

    capturedData.requests.push(entry);

    // Log interesting requests
    if (details.url.includes('license') ||
        details.url.includes('drm') ||
        details.url.includes('widevine') ||
        details.url.includes('auth') ||
        details.url.includes('token') ||
        details.url.includes('fingerprint') ||
        details.url.includes('bot') ||
        details.url.includes('captcha')) {
      console.log('[DirecTV Inspector] Interesting request:', details.url);
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

// Capture request headers
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!capturedData.isRecording) return;

    capturedData.headers.push({
      timestamp: Date.now(),
      type: 'requestHeaders',
      url: details.url,
      requestId: details.requestId,
      headers: details.requestHeaders
    });
  },
  { urls: ['*://*.directv.com/*', '*://*.att.com/*'] },
  ['requestHeaders']
);

// Capture response headers
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!capturedData.isRecording) return;

    capturedData.headers.push({
      timestamp: Date.now(),
      type: 'responseHeaders',
      url: details.url,
      requestId: details.requestId,
      statusCode: details.statusCode,
      headers: details.responseHeaders
    });
  },
  { urls: ['*://*.directv.com/*', '*://*.att.com/*'] },
  ['responseHeaders']
);

// Log when requests complete
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!capturedData.isRecording) return;

    // Find and update the request entry
    const entry = capturedData.requests.find(r => r.requestId === details.requestId);
    if (entry) {
      entry.statusCode = details.statusCode;
      entry.completed = Date.now();
    }
  },
  { urls: ['*://*.directv.com/*', '*://*.att.com/*'] }
);

// Log errors
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!capturedData.isRecording) return;

    capturedData.requests.push({
      timestamp: Date.now(),
      type: 'error',
      url: details.url,
      error: details.error
    });
    console.log('[DirecTV Inspector] Request error:', details.url, details.error);
  },
  { urls: ['*://*.directv.com/*', '*://*.att.com/*'] }
);

console.log('[DirecTV Inspector] Background service worker loaded');
