/**
 * Chicago Direct Stream - Phase 2 Implementation
 *
 * Directly fetches HLS streams for Chicago local channels by mimicking iOS app behavior.
 * This bypasses the web player's geo-restrictions by accessing the CDN directly.
 *
 * Key Discovery from iOS Traffic Analysis:
 * - HLS manifests are publicly accessible on CDN (no auth token in URL)
 * - URL Pattern: https://dfwlive-v2-c3p{N}-os.global.ssl.fastly.net/Content/HLS.cps/Live/channel(CALLSIGN-CCID.dfw.RESOLUTION)/index.m3u8
 * - DRM: SAMPLE-AES with both FairPlay and Widevine keys in manifest
 * - CDN nodes: c0p1, c0p7, c3p3, c3p5, c3p6 (load balanced)
 */

const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { CHICAGO_LOCALS, CHICAGO_CLIENT_CONTEXT } = require('./chicago-locals');

// CDN node options (discovered from iOS traffic)
const CDN_NODES = [
  'dfwlive-v2-c3p3-os.global.ssl.fastly.net',
  'dfwlive-v2-c3p5-os.akamaized.net',
  'dfwlive-v2-c0p1-os.akamaized.net',
  'dfwlive-v2-c3p6-os.global.ssl.fastly.net',
];

// iOS App headers (from traffic capture)
const IOS_HEADERS = {
  'User-Agent': 'ClientApp/5.0.92 (iOS 18.6.2; iPhone16,1; iPhone)  PureRN/0.73.6',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip',
  'Connection': 'keep-alive',
};

// Resolution options
const RESOLUTIONS = {
  '1080': '1080',
  '720': '720',
  '480': '480',
};

class ChicagoDirectStream {
  constructor() {
    this.sessionId = uuidv4().toUpperCase();
    this.currentCdnNode = 0;
  }

  /**
   * Get a Chicago local channel by callsign
   */
  getChannel(callSign) {
    const upper = callSign.toUpperCase();
    return CHICAGO_LOCALS.find(ch => ch.callSign.toUpperCase() === upper);
  }

  /**
   * Get all Chicago local channels
   */
  getAllChannels() {
    return CHICAGO_LOCALS;
  }

  /**
   * Build the HLS manifest URL for a Chicago channel
   */
  buildManifestUrl(callSign, ccid, resolution = '720') {
    const cdnNode = CDN_NODES[this.currentCdnNode % CDN_NODES.length];
    // Rotate CDN node for load balancing
    this.currentCdnNode++;

    return `https://${cdnNode}/Content/HLS.cps/Live/channel(${callSign}-${ccid}.dfw.${resolution})/index.m3u8`;
  }

  /**
   * Build variant playlist URL (for specific quality level)
   */
  buildVariantUrl(callSign, ccid, resolution, variant) {
    const cdnNode = CDN_NODES[this.currentCdnNode % CDN_NODES.length];
    return `https://${cdnNode}/Content/HLS.cps/Live/channel(${callSign}-${ccid}.dfw.${resolution})/${variant}`;
  }

  /**
   * Fetch the master HLS manifest for a Chicago channel
   */
  async fetchManifest(callSign, resolution = '720') {
    const channel = this.getChannel(callSign);
    if (!channel) {
      throw new Error(`Unknown Chicago channel: ${callSign}`);
    }

    const url = this.buildManifestUrl(channel.callSign, channel.ccid, resolution);
    console.log(`[chicago-direct] Fetching manifest: ${url}`);

    return new Promise((resolve, reject) => {
      const headers = {
        ...IOS_HEADERS,
        'X-Playback-Session-Id': this.sessionId,
      };

      https.get(url, { headers }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch manifest: HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            url,
            manifest: data,
            channel,
            headers: res.headers,
          });
        });
      }).on('error', reject);
    });
  }

  /**
   * Parse HLS manifest and extract DRM info
   */
  parseManifest(manifestData) {
    const lines = manifestData.split('\n');
    const result = {
      variants: [],
      audioTracks: [],
      subtitles: [],
      sessionKeys: [],
      fairplayKeys: [],
      widevineKeys: [],
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Parse session keys (DRM)
      if (line.startsWith('#EXT-X-SESSION-KEY:')) {
        const keyInfo = this.parseKeyLine(line);
        result.sessionKeys.push(keyInfo);

        if (keyInfo.keyFormat === 'com.apple.streamingkeydelivery') {
          result.fairplayKeys.push(keyInfo);
        } else if (keyInfo.keyFormat === 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed') {
          result.widevineKeys.push(keyInfo);
        }
      }

      // Parse variant streams
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = this.parseAttributes(line);
        const uri = lines[i + 1]?.trim();
        if (uri && !uri.startsWith('#')) {
          result.variants.push({
            ...attrs,
            uri,
          });
        }
      }

      // Parse audio tracks
      if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
        result.audioTracks.push(this.parseAttributes(line));
      }

      // Parse subtitles
      if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=SUBTITLES')) {
        result.subtitles.push(this.parseAttributes(line));
      }
    }

    return result;
  }

  /**
   * Parse HLS key line
   */
  parseKeyLine(line) {
    const match = line.match(/#EXT-X-(?:SESSION-)?KEY:(.+)/);
    if (!match) return {};

    const attrs = this.parseAttributes('#TAG:' + match[1]);

    // Extract PSSH from base64 data URI
    if (attrs.uri && attrs.uri.startsWith('data:text/plain;base64,')) {
      attrs.pssh = attrs.uri.replace('data:text/plain;base64,', '');
    }

    return {
      method: attrs.method,
      uri: attrs.uri,
      keyFormat: attrs.keyformat,
      keyFormatVersions: attrs.keyformatversions,
      keyId: attrs.keyid,
      pssh: attrs.pssh,
    };
  }

  /**
   * Parse HLS attributes from a line
   */
  parseAttributes(line) {
    const result = {};
    // Remove tag prefix
    const attrStr = line.replace(/^#[A-Z-]+:/, '');

    // Parse key=value pairs (handling quoted values)
    const regex = /([A-Z-]+)=(?:"([^"]*)"|([^,]*))/gi;
    let match;
    while ((match = regex.exec(attrStr)) !== null) {
      const key = match[1].toLowerCase().replace(/-/g, '');
      const value = match[2] !== undefined ? match[2] : match[3];
      result[key] = value;
    }

    return result;
  }

  /**
   * Extract Widevine PSSH from manifest
   */
  extractWidevinePssh(manifestData) {
    const parsed = this.parseManifest(manifestData);
    return parsed.widevineKeys.map(k => k.pssh).filter(Boolean);
  }

  /**
   * Get the best quality variant URL
   */
  getBestVariantUrl(manifest, baseUrl, preferredResolution = '720') {
    const parsed = this.parseManifest(manifest);

    // Sort variants by bandwidth (highest first)
    const sorted = parsed.variants.sort((a, b) => {
      return parseInt(b.bandwidth || 0) - parseInt(a.bandwidth || 0);
    });

    // Try to find a variant matching preferred resolution
    const preferred = sorted.find(v => v.resolution?.includes(preferredResolution));
    const selected = preferred || sorted[0];

    if (!selected) {
      throw new Error('No variant streams found in manifest');
    }

    // Build full URL
    const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
    return baseDir + selected.uri;
  }

  /**
   * Create a proxy manifest that can be served to players
   * This rewrites the manifest to proxy through our server
   */
  createProxyManifest(originalManifest, baseUrl, proxyBaseUrl) {
    let proxyManifest = originalManifest;

    // Rewrite segment URLs to go through our proxy
    const lines = originalManifest.split('\n');
    const rewritten = lines.map(line => {
      // Skip comment lines and key lines
      if (line.startsWith('#') || !line.trim()) {
        return line;
      }

      // Rewrite relative URLs
      if (!line.startsWith('http')) {
        const fullUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1) + line;
        return `${proxyBaseUrl}/proxy?url=${encodeURIComponent(fullUrl)}`;
      }

      return line;
    });

    return rewritten.join('\n');
  }

  /**
   * Test if a Chicago channel stream is accessible
   */
  async testStream(callSign, resolution = '720') {
    try {
      const result = await this.fetchManifest(callSign, resolution);
      const parsed = this.parseManifest(result.manifest);

      return {
        success: true,
        channel: result.channel,
        url: result.url,
        variants: parsed.variants.length,
        audioTracks: parsed.audioTracks.length,
        hasWidevine: parsed.widevineKeys.length > 0,
        hasFairplay: parsed.fairplayKeys.length > 0,
        widevineKeys: parsed.widevineKeys,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Test all Chicago channels
   */
  async testAllChannels() {
    const results = {};
    for (const channel of CHICAGO_LOCALS) {
      console.log(`Testing ${channel.callSign}...`);
      results[channel.callSign] = await this.testStream(channel.callSign);
    }
    return results;
  }
}

// Export singleton instance
const chicagoStream = new ChicagoDirectStream();

module.exports = {
  ChicagoDirectStream,
  chicagoStream,
  CHICAGO_LOCALS,
  CDN_NODES,
  IOS_HEADERS,
};
