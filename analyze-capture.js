const fs = require('fs');
const path = require('path');

// Find the capture file
const captureFile = process.argv[2] || '/Users/georgeszulc/Desktop/Projects 2024/my_dvr/directv-capture-2025-11-26T00-16-15-254Z.json';

console.log('Analyzing:', captureFile);
console.log('='.repeat(80));

const data = JSON.parse(fs.readFileSync(captureFile, 'utf8'));

// Summary
console.log('\n## CAPTURE SUMMARY ##');
console.log('Start time:', data.startTime ? new Date(data.startTime).toISOString() : 'N/A');
console.log('Total requests:', data.requests?.length || 0);
console.log('Total headers:', data.headers?.length || 0);
console.log('Total cookies:', data.cookies?.length || 0);
console.log('Page events:', data.pageData?.length || 0);

// Analyze automation indicators from page data
console.log('\n## AUTOMATION INDICATORS ##');
if (data.pageData && data.pageData.length > 0) {
  for (const page of data.pageData) {
    if (page.pageData?.automationIndicators) {
      const indicators = page.pageData.automationIndicators;
      console.log('\nFrom URL:', page.url?.substring(0, 80));
      console.log('  webdriver:', indicators.webdriver);
      console.log('  hasChrome:', indicators.hasChrome);
      console.log('  hasChromeRuntime:', indicators.hasChromeRuntime);
      console.log('  hasCDC:', indicators.hasCDC);
      console.log('  cdcKeys:', indicators.cdcKeys);
      break; // Just show first one
    }
  }
}

// Analyze DRM/EME events
console.log('\n## DRM/EME EVENTS ##');
if (data.pageData) {
  for (const page of data.pageData) {
    if (page.event === 'emeRequest' || page.event === 'emeGranted' || page.event === 'emeDenied') {
      console.log(`  ${page.event}: ${page.keySystem}`);
      if (page.configs) {
        console.log('    configs:', JSON.stringify(page.configs).substring(0, 200));
      }
    }
  }
}

// Analyze interesting requests (license, DRM, fingerprint, etc)
console.log('\n## INTERESTING REQUESTS ##');
const interestingPatterns = ['license', 'drm', 'widevine', 'fingerprint', 'bot', 'captcha', 'challenge', 'eme', 'cdm'];
const interestingRequests = (data.requests || []).filter(r => {
  const url = r.url?.toLowerCase() || '';
  return interestingPatterns.some(p => url.includes(p));
});

console.log(`Found ${interestingRequests.length} interesting requests:`);
for (const req of interestingRequests.slice(0, 20)) {
  console.log(`  [${req.method}] ${req.statusCode || '???'} ${req.url?.substring(0, 100)}`);
}

// Analyze license requests specifically
console.log('\n## LICENSE REQUESTS ##');
const licenseRequests = (data.requests || []).filter(r => r.url?.includes('license'));
console.log(`Found ${licenseRequests.length} license requests`);
for (const req of licenseRequests) {
  console.log(`  [${req.method}] ${req.statusCode} ${req.url}`);

  // Find headers for this request
  const reqHeaders = (data.headers || []).find(h => h.requestId === req.requestId && h.type === 'requestHeaders');
  if (reqHeaders) {
    console.log('  Request headers:');
    for (const h of reqHeaders.headers || []) {
      if (['authorization', 'x-', 'content-type', 'origin', 'referer'].some(p => h.name.toLowerCase().startsWith(p) || h.name.toLowerCase().includes(p))) {
        console.log(`    ${h.name}: ${h.value?.substring(0, 100)}`);
      }
    }
  }
}

// Analyze cookies
console.log('\n## COOKIES ##');
const cookies = data.cookies || [];
console.log(`Total cookies: ${cookies.length}`);

// Group by domain
const cookiesByDomain = {};
for (const c of cookies) {
  const domain = c.domain || 'unknown';
  if (!cookiesByDomain[domain]) cookiesByDomain[domain] = [];
  cookiesByDomain[domain].push(c);
}

for (const [domain, domainCookies] of Object.entries(cookiesByDomain)) {
  console.log(`\n  ${domain}: ${domainCookies.length} cookies`);
  for (const c of domainCookies.slice(0, 5)) {
    console.log(`    ${c.name}: ${c.value?.substring(0, 50)}...`);
  }
  if (domainCookies.length > 5) {
    console.log(`    ... and ${domainCookies.length - 5} more`);
  }
}

// Analyze navigator/fingerprint data
console.log('\n## BROWSER FINGERPRINT ##');
if (data.pageData && data.pageData.length > 0) {
  for (const page of data.pageData) {
    if (page.pageData?.navigator) {
      const nav = page.pageData.navigator;
      console.log('User Agent:', nav.userAgent);
      console.log('Platform:', nav.platform);
      console.log('Languages:', nav.languages);
      console.log('Hardware Concurrency:', nav.hardwareConcurrency);
      console.log('Device Memory:', nav.deviceMemory);
      console.log('Max Touch Points:', nav.maxTouchPoints);
      console.log('Webdriver:', nav.webdriver);
      console.log('Plugins count:', nav.plugins?.length);
      break;
    }
  }
}

// WebGL info
console.log('\n## WEBGL INFO ##');
if (data.pageData && data.pageData.length > 0) {
  for (const page of data.pageData) {
    if (page.pageData?.webgl) {
      const webgl = page.pageData.webgl;
      console.log('Vendor:', webgl.vendor);
      console.log('Renderer:', webgl.renderer);
      console.log('Unmasked Vendor:', webgl.unmaskedVendor);
      console.log('Unmasked Renderer:', webgl.unmaskedRenderer);
      break;
    }
  }
}

// localStorage keys (might have tokens/auth)
console.log('\n## LOCAL STORAGE KEYS ##');
if (data.pageData && data.pageData.length > 0) {
  for (const page of data.pageData) {
    if (page.pageData?.localStorage) {
      const keys = Object.keys(page.pageData.localStorage);
      console.log(`Found ${keys.length} localStorage keys:`);
      for (const key of keys) {
        console.log(`  ${key}`);
      }
      break;
    }
  }
}

// Check for any errors
console.log('\n## ERRORS ##');
const errors = (data.requests || []).filter(r => r.type === 'error' || (r.statusCode && r.statusCode >= 400));
console.log(`Found ${errors.length} errors/failed requests`);
for (const err of errors.slice(0, 10)) {
  console.log(`  ${err.error || err.statusCode} - ${err.url?.substring(0, 80)}`);
}

console.log('\n' + '='.repeat(80));
console.log('Analysis complete!');
