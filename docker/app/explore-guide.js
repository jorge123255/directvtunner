// Script to explore the DirecTV guide and extract channel/stream info
const { chromium } = require('playwright');

const DEBUG_PORT = 9222;

async function exploreGuide() {
  console.log('Connecting to Chrome...');

  const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages[0] || await context.newPage();

  console.log('Navigating to guide...');
  await page.goto('https://stream.directv.com/guide', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  // Wait for guide to load
  await new Promise(r => setTimeout(r, 5000));

  // Monitor network requests for HLS streams
  const hlsUrls = new Set();

  page.on('request', request => {
    const url = request.url();
    if (url.includes('.m3u8') || url.includes('fastly.net')) {
      hlsUrls.add(url);
      console.log('[HLS]', url);
    }
  });

  // Try to extract channel info from the page
  console.log('\nExtracting channel data from guide...\n');

  const channelData = await page.evaluate(() => {
    const channels = [];

    // Look for channel elements in the guide
    // DirecTV guide typically has channel rows with logo, name, number
    const channelElements = document.querySelectorAll('[class*="channel"], [class*="Channel"], [data-channel]');

    channelElements.forEach(el => {
      const text = el.textContent;
      const dataAttrs = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) {
          dataAttrs[attr.name] = attr.value;
        }
      }
      if (text || Object.keys(dataAttrs).length > 0) {
        channels.push({
          text: text?.substring(0, 100),
          attrs: dataAttrs,
          className: el.className
        });
      }
    });

    // Also look for any visible channel numbers/names
    const allText = document.body.innerText;
    const channelMatches = allText.match(/\d{3}\s+[A-Z]{2,}/g) || [];

    return {
      elementsFound: channels.length,
      sampleElements: channels.slice(0, 10),
      textMatches: channelMatches.slice(0, 20)
    };
  });

  console.log('Channel elements found:', channelData.elementsFound);
  console.log('Sample elements:', JSON.stringify(channelData.sampleElements, null, 2));
  console.log('Text matches:', channelData.textMatches);

  // Try clicking on a channel to see the stream URL
  console.log('\n\nLooking for clickable channel items...');

  // Wait and collect any network requests
  await new Promise(r => setTimeout(r, 3000));

  console.log('\nHLS URLs collected:', Array.from(hlsUrls));

  // Get the page HTML structure
  const structure = await page.evaluate(() => {
    const getStructure = (el, depth = 0) => {
      if (depth > 3) return null;
      const children = Array.from(el.children).slice(0, 5).map(c => getStructure(c, depth + 1)).filter(Boolean);
      return {
        tag: el.tagName,
        class: el.className?.substring?.(0, 50),
        id: el.id,
        children: children.length > 0 ? children : undefined
      };
    };
    return getStructure(document.body);
  });

  console.log('\nPage structure:', JSON.stringify(structure, null, 2));

  await browser.close();
}

exploreGuide().catch(console.error);
