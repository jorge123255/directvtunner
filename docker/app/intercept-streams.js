// Script to intercept DirecTV HLS stream URLs from Chrome
const { chromium } = require('playwright');

const DEBUG_PORT = 9222;

async function interceptStreams() {
  console.log('Connecting to Chrome on port', DEBUG_PORT);

  const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0];

  console.log('Current URL:', page.url());
  console.log('\nListening for HLS stream requests...\n');

  const streams = new Map();

  // Intercept all network requests
  page.on('request', request => {
    const url = request.url();

    // Look for HLS manifest files
    if (url.includes('.m3u8')) {
      const headers = request.headers();
      console.log('\n=== HLS Manifest ===');
      console.log('URL:', url);
      console.log('Headers:', JSON.stringify(headers, null, 2));

      // Parse channel info from URL
      const channelMatch = url.match(/channel\(([^)]+)\)/);
      if (channelMatch) {
        const channelInfo = channelMatch[1];
        streams.set(channelInfo, {
          url,
          headers,
          timestamp: Date.now()
        });
      }
    }

    // Look for segment requests too
    if (url.includes('.ts') && url.includes('fastly.net')) {
      console.log('[Segment]', url.substring(0, 100) + '...');
    }
  });

  // Also monitor responses
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('.m3u8')) {
      try {
        const body = await response.text();
        console.log('\n=== Manifest Content ===');
        console.log('URL:', url);
        console.log('Content preview:\n', body.substring(0, 500));
      } catch (e) {
        // Ignore errors
      }
    }
  });

  console.log('Waiting for stream requests... (watching for 60 seconds)');
  console.log('Try clicking on different channels in the DirecTV player');

  // Wait for 60 seconds to collect requests
  await new Promise(r => setTimeout(r, 60000));

  console.log('\n\n=== Summary ===');
  console.log('Streams found:', streams.size);
  for (const [channel, data] of streams) {
    console.log(`\nChannel: ${channel}`);
    console.log(`URL: ${data.url}`);
  }

  // Don't close browser, just disconnect
  browser.disconnect();
}

interceptStreams().catch(console.error);
