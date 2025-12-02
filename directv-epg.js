// DirecTV EPG Service
// Fetches guide data from DirecTV API and generates XMLTV format

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DATA_DIR = path.join(__dirname, 'data');
const CHANNELS_CACHE = path.join(DATA_DIR, 'directv_channels.json');
const EPG_CACHE = path.join(DATA_DIR, 'directv_epg.json');

// DirecTV API base
const API_BASE = 'https://api.cld.dtvce.com';

// Default client context (New York DMA 501)
const DEFAULT_CLIENT_CONTEXT = 'dmaID:501_0,billingDmaID:501,regionID:OV MSG SPOT_RegC New York NY_OTT MSG Plus 08152022 SPOT_OV New York NY 501_BTN4OF_BG10O2H_BTN3OF_BTN2OF_SNF SportsNet NY SPOT_YESHDNY_YES2HD_BGTN4HD_OV2 RegC New York NY_BGTN3HD_BIG10HD_MSG OTT SPOT_YES Network Spot SPOT_OV MSG PLUS SPOT_MSG OV 02052021 SPOT_YES OOM B/O_OV MeTV Allowed SPOT_OV New York NY DMA 501,zipCode:11369,countyCode:081,stateNumber:36,stateAbbr:NY,usrLocAndBillLocAreSame:true,bRegionID:OV MSG SPOT_RegC New York NY_OTT MSG Plus 08152022 SPOT_OV New York NY 501_BTN4OF_BG10O2H_BTN3OF_BTN2OF_SNF SportsNet NY SPOT_YESHDNY_YES2HD_BGTN4HD_OV2 RegC New York NY_BGTN3HD_BIG10HD_MSG OTT SPOT_YES Network Spot SPOT_OV MSG PLUS SPOT_MSG OV 02052021 SPOT_YES OOM B/O_OV MeTV Allowed SPOT_OV New York NY DMA 501,isFFP:false,deviceProximity:OOH';

// Auto-refresh interval (4 hours)
const settingsManager = require('./settings-manager');

// Get refresh interval from settings (in hours), default 4
function getRefreshInterval() {
  const settings = settingsManager.getSettings();
  const hours = settings.epg?.refreshInterval || 4;
  return hours * 60 * 60 * 1000;
}

class DirectvEpg {
  constructor() {
    this.channels = [];
    this.schedules = {};
    this.lastFetch = null;
    this.refreshTimer = null;
    this.isRefreshing = false;
    this.loadCache();
  }

  // Start auto-refresh timer
  startAutoRefresh() {
    if (this.refreshTimer) return;

    console.log(`[epg] Auto-refresh enabled (every ${getRefreshInterval() / 1000 / 60 / 60} hours)`);

    // Check if we need an immediate refresh (cache older than interval)
    const cacheAge = this.lastFetch ? Date.now() - this.lastFetch : Infinity;
    if (cacheAge > getRefreshInterval()) {
      console.log('[epg] Cache is stale, scheduling immediate refresh...');
      setTimeout(() => this.autoRefresh(), 10000); // Wait 10s for server to be ready
    }

    // Set up recurring refresh
    this.refreshTimer = setInterval(() => this.autoRefresh(), getRefreshInterval());
  }

  // Stop auto-refresh
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      console.log('[epg] Auto-refresh disabled');
    }
  }

  // Auto-refresh handler
  async autoRefresh() {
    if (this.isRefreshing) {
      console.log('[epg] Refresh already in progress, skipping');
      return;
    }

    console.log('[epg] Starting auto-refresh...');
    try {
      await this.fetchFromBrowser();
      console.log('[epg] Auto-refresh completed successfully');
    } catch (err) {
      console.error('[epg] Auto-refresh failed:', err.message);
    }
  }

  loadCache() {
    try {
      if (fs.existsSync(CHANNELS_CACHE)) {
        const data = JSON.parse(fs.readFileSync(CHANNELS_CACHE, 'utf8'));
        this.channels = data.channels || [];
        console.log(`[epg] Loaded ${this.channels.length} channels from cache`);
      }
      if (fs.existsSync(EPG_CACHE)) {
        const data = JSON.parse(fs.readFileSync(EPG_CACHE, 'utf8'));
        this.schedules = data.schedules || {};
        this.lastFetch = data.lastFetch;
        console.log(`[epg] Loaded EPG cache from ${new Date(this.lastFetch).toISOString()}`);
      }
    } catch (err) {
      console.error('[epg] Error loading cache:', err.message);
    }
  }

  saveCache() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(CHANNELS_CACHE, JSON.stringify({ channels: this.channels }, null, 2));
      fs.writeFileSync(EPG_CACHE, JSON.stringify({ schedules: this.schedules, lastFetch: this.lastFetch }, null, 2));
      console.log('[epg] Cache saved');
    } catch (err) {
      console.error('[epg] Error saving cache:', err.message);
    }
  }

  // Fetch channels and EPG via browser CDP (uses authenticated session)
  async fetchFromBrowser() {
    if (this.isRefreshing) {
      console.log('[epg] Refresh already in progress, skipping');
      return { channels: this.channels.length, schedules: Object.keys(this.schedules).length };
    }

    this.isRefreshing = true;
    console.log('[epg] Fetching EPG data via browser...');

    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();

    if (contexts.length === 0) {
      throw new Error('No browser context found');
    }

    const context = contexts[0];
    const page = await context.newPage();

    try {
      // Capture API responses
      const apiResponses = {};

      context.on('response', async (response) => {
        const url = response.url();
        if (url.includes('api.cld.dtvce.com')) {
          try {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              const body = await response.json();

              // Capture channels
              if (url.includes('/allchannels')) {
                apiResponses.channels = body;
                console.log(`[epg] Captured ${body.channelInfoList?.length || 0} channels`);
                // Log first channel to see available properties
                if (body.channelInfoList?.[0]) {
                  console.log("[epg] Sample channel keys:", Object.keys(body.channelInfoList[0]).join(", "));
                  fs.writeFileSync("/tmp/raw_channels.json", JSON.stringify(body.channelInfoList, null, 2));
                  console.log("[epg] Sample channel:", JSON.stringify(body.channelInfoList[0]).substring(0, 500));
                }
              }

              // Capture schedule
              if (url.includes('/schedule') && body.schedules) {
                if (!apiResponses.schedules) apiResponses.schedules = [];
                apiResponses.schedules.push(...body.schedules);
                console.log(`[epg] Captured ${body.schedules.length} schedule items`);
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      });

      // Navigate to guide page to trigger API calls
      console.log('[epg] Navigating to guide page...');
      await page.goto('https://stream.directv.com/guide', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Click on "Streaming" filter to only get streamable channels
      console.log('[epg] Clicking Streaming filter...');
      try {
        // Click the Filter dropdown
        await page.click('[aria-label="Filter: Streaming"], [aria-label*="Filter"]', { timeout: 5000 });
        await page.waitForTimeout(1000);
        // Click "Streaming Channels" option
        await page.click('text=Streaming Channels', { timeout: 5000 });
        // Filter is client-side, API already has all channels
        // We filter by mDVR below instead
        await page.waitForTimeout(5000);
        console.log('[epg] Streaming filter applied');
      } catch (e) {
        console.log('[epg] Could not apply streaming filter:', e.message);
      }

      // Wait for data to load
      await page.waitForTimeout(8000);

      // Scroll to trigger more schedule loads
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(2000);
      }

      // Close the page we created
      await page.close();

      // Process captured data
      if (apiResponses.channels?.channelInfoList) {
        const allChannels = apiResponses.channels.channelInfoList;
        const mDVRValues = [...new Set(allChannels.map(ch => ch.mDVR))];
        const mdvrValues = [...new Set(allChannels.map(ch => ch.mdvr))];
        console.log("[epg] mDVR values found:", mDVRValues, "mdvr values:", mdvrValues);
        const streamableChannels = allChannels.filter(ch => ch.augmentation?.constraints?.isLiveStreamEnabled === true);
        console.log(`[epg] Filtering: ${allChannels.length} total -> ${streamableChannels.length} streamable (isLiveStreamEnabled=true)`);
        this.channels = streamableChannels.map(ch => ({
          id: ch.resourceId,
          name: ch.channelName,
          number: ch.channelNumber,
          callSign: ch.callSign,
          ccid: ch.ccid,
          logo: ch.imageList?.find(i => i.imageType === 'chlogo-clb-guide')?.imageUrl || null,
          format: ch.format
        }));
        console.log(`[epg] Processed ${this.channels.length} channels`);
      }

      if (apiResponses.schedules) {
        // Group schedules by channel
        for (const schedule of apiResponses.schedules) {
          const channelId = schedule.channelId;
          if (!this.schedules[channelId]) {
            this.schedules[channelId] = [];
          }

          for (const content of schedule.contents || []) {
            const consumable = content.consumables?.[0];
            if (consumable) {
              this.schedules[channelId].push({
                title: content.title || content.displayTitle,
                subtitle: content.episodeTitle || null,
                description: content.description || '',
                startTime: consumable.startTime,
                endTime: consumable.endTime,
                duration: consumable.duration,
                categories: content.categories || [],
                genres: content.genres || [],
                rating: consumable.parentalRating || content.parentalRating,
                seasonNumber: content.seasonNumber,
                episodeNumber: content.episodeNumber,
                originalAirDate: content.originalAirDate,
                year: content.releaseYear
              });
            }
          }
        }
        console.log(`[epg] Processed schedules for ${Object.keys(this.schedules).length} channels`);
      }

      this.lastFetch = Date.now();
      this.saveCache();

      this.isRefreshing = false;
      return {
        channels: this.channels.length,
        schedules: Object.keys(this.schedules).length
      };

    } catch (err) {
      this.isRefreshing = false;
      throw err;
    } finally {
      // Always ensure the guide page is closed
      try {
        if (page && !page.isClosed()) {
          await page.close();
          console.log('[epg] Closed EPG page');
        }
      } catch (e) {
        console.log('[epg] Error closing page:', e.message);
      }

      // Extra safety: close any lingering guide pages via CDP
      try {
        const http = require('http');
        const req = http.get('http://localhost:9222/json', (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const pages = JSON.parse(data);
              for (const p of pages) {
                if (p.type === 'page' && p.url && p.url.includes('/guide')) {
                  http.get(`http://localhost:9222/json/close/${p.id}`);
                  console.log('[epg] Force-closed lingering guide page');
                }
              }
            } catch (e) {}
          });
        });
        req.on('error', () => {});
      } catch (e) {}
    }
  }

  // Generate XMLTV format EPG
  generateXMLTV(hoursAhead = 24) {
    const now = new Date();
    const endTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<!DOCTYPE tv SYSTEM "xmltv.dtd">\n';
    xml += '<tv generator-info-name="directv-epg" generator-info-url="http://localhost:3000">\n';

    // Add channels
    for (const channel of this.channels) {
      const tvgId = `dtv-${channel.number}`;
      xml += `  <channel id="${tvgId}">\n`;
      xml += `    <display-name>${this.escapeXml(channel.name)}</display-name>\n`;
      xml += `    <display-name>${channel.number}</display-name>\n`;
      if (channel.callSign) {
        xml += `    <display-name>${this.escapeXml(channel.callSign)}</display-name>\n`;
      }
      if (channel.logo) {
        xml += `    <icon src="${this.escapeXml(channel.logo)}" />\n`;
      }
      xml += `  </channel>\n`;
    }

    // Add programs
    for (const channel of this.channels) {
      const programs = this.schedules[channel.id] || [];
      const tvgId = `dtv-${channel.number}`;

      for (const program of programs) {
        const start = new Date(program.startTime);
        const end = new Date(program.endTime);

        // Skip programs outside our time window
        if (end < now || start > endTime) continue;

        xml += `  <programme start="${this.formatXMLTVDate(start)}" stop="${this.formatXMLTVDate(end)}" channel="${tvgId}">\n`;
        xml += `    <title lang="en">${this.escapeXml(program.title)}</title>\n`;

        if (program.subtitle) {
          xml += `    <sub-title lang="en">${this.escapeXml(program.subtitle)}</sub-title>\n`;
        }

        if (program.description) {
          xml += `    <desc lang="en">${this.escapeXml(program.description)}</desc>\n`;
        }

        if (program.categories?.length > 0) {
          for (const cat of program.categories) {
            xml += `    <category lang="en">${this.escapeXml(cat)}</category>\n`;
          }
        }

        if (program.genres?.length > 0) {
          for (const genre of program.genres) {
            xml += `    <category lang="en">${this.escapeXml(genre)}</category>\n`;
          }
        }

        if (program.seasonNumber && program.episodeNumber) {
          // XMLTV episode format: season-1.episode-1.0
          const s = program.seasonNumber - 1;
          const e = program.episodeNumber - 1;
          xml += `    <episode-num system="xmltv_ns">${s}.${e}.0</episode-num>\n`;
        }

        if (program.originalAirDate) {
          xml += `    <date>${program.originalAirDate.replace(/-/g, '')}</date>\n`;
        }

        if (program.rating) {
          xml += `    <rating system="VCHIP">\n`;
          xml += `      <value>${this.escapeXml(program.rating)}</value>\n`;
          xml += `    </rating>\n`;
        }

        xml += `  </programme>\n`;
      }
    }

    xml += '</tv>\n';
    return xml;
  }

  // Generate M3U playlist with tvg-id matching EPG
  generateM3U(host) {
    let m3u = '#EXTM3U url-tvg="http://' + host + '/tve/directv/epg.xml"\n\n';

    for (const channel of this.channels) {
      const tvgId = `dtv-${channel.number}`;
      const groupTitle = this.getChannelGroup(channel);

      m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${channel.name}" tvg-logo="${channel.logo || ''}" tvg-chno="${channel.number}" group-title="${groupTitle}",${channel.name}\n`;
      m3u += `http://${host}/stream/${channel.number}\n\n`;
    }

    return m3u;
  }

  // Get channel group/category
  getChannelGroup(channel) {
    const name = (channel.name || '').toLowerCase();
    const callSign = (channel.callSign || '').toLowerCase();

    if (/espn|fox sports|nfl|mlb|nba|nhl|golf|sports/i.test(name + callSign)) return 'Sports';
    if (/news|cnn|msnbc|fox news|cnbc/i.test(name + callSign)) return 'News';
    if (/hbo|max|showtime|starz|cinemax|movie/i.test(name + callSign)) return 'Movies';
    if (/disney|nick|cartoon|kids/i.test(name + callSign)) return 'Kids';
    if (/discovery|history|natgeo|animal|tlc|hgtv|food/i.test(name + callSign)) return 'Documentary';
    return 'Entertainment';
  }

  // Format date for XMLTV (YYYYMMDDHHmmss +0000)
  formatXMLTVDate(date) {
    const d = new Date(date);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
  }

  // Escape XML special characters
  escapeXml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Get channel by number
  getChannelByNumber(number) {
    return this.channels.find(ch => ch.number === number);
  }

  // Get all channels
  getChannels() {
    return this.channels;
  }

  // Get EPG status
  getStatus() {
    return {
      channelCount: this.channels.length,
      scheduledChannels: Object.keys(this.schedules).length,
      lastFetch: this.lastFetch,
      cacheAge: this.lastFetch ? Math.round((Date.now() - this.lastFetch) / 1000) : null
    };
  }
}

module.exports = new DirectvEpg();
