// 1movies.bz Provider Configuration

module.exports = {
  id: 'onemovies',
  name: '1Movies',
  baseUrl: 'https://1movies.bz',
  features: ['movies', 'tv'],

  // API endpoints
  api: {
    home: '/home',
    episodesList: '/ajax/episodes/list',     // ?id={movieId}&_={token}
    linksList: '/ajax/links/list',           // ?eid={episodeId}&_={token}
    linksView: '/ajax/links/view',           // ?id={linkId}&_={token}
    userPanel: '/ajax/user/panel',
    subtitles: '/ajax/episode/{id}/subtitles'
  },

  // M3U8 URL patterns - generic patterns for network interception
  m3u8Patterns: [
    /\.m3u8(\?|$)/,
    /master\.m3u8/,
    /playlist\.m3u8/,
    /index\.m3u8/
  ],

  // URLs to EXCLUDE from m3u8 capture (e.g., DirecTV live streams)
  // These are matched as substrings (case-insensitive)
  m3u8ExcludePatterns: [
    'dtvcdn.com',           // DirecTV CDN
    'directv.com',          // DirecTV domain
    'live.cflare',          // Cloudflare live streaming (DirecTV uses this)
    'dfwlive',              // DirecTV live prefix
    '/Live/',               // Live content path
    '/channel(',            // DirecTV channel format
    'att.com',              // AT&T (DirecTV parent)
    'atttvnow.com'          // AT&T TV Now
  ],

  // Embed domains used by 1movies.bz
  embedDomains: [
    'rapidairmax.site'
  ],

  // Play button selectors
  playButtonSelectors: [
    'button:has-text("Watch")',
    'button:has-text("Play")',
    'a:has-text("Watch")',
    '[data-action="play"]',
    '.play-button',
    '#play-btn',
    '.btn-play',
    '[class*="play"]'
  ],

  // Server selection - click first available server
  serverSelectors: [
    '.server-item',
    '[data-link-id]',
    '.episode-server a'
  ],

  // Content sections
  sections: {
    home: '/home',
    movies: '/movies',
    tv: '/tv-series',
    genre: '/genre'
  },

  // Genre list for catalog crawling
  genres: [
    'action', 'adventure', 'animation', 'comedy', 'crime',
    'documentary', 'drama', 'family', 'fantasy', 'history',
    'horror', 'music', 'mystery', 'romance', 'sci-fi',
    'thriller', 'war', 'western'
  ],

  // Timeouts
  timeouts: {
    navigation: 30000,
    m3u8Capture: 60000,   // Longer due to multi-step process
    playButton: 5000,
    serverSelect: 3000,
    linkResolution: 15000
  },

  // Request delay between API calls (ms)
  requestDelay: 500,

  // Pages per genre to fetch
  pagesPerGenre: 10,

  // Ad-blocking patterns - domains/patterns to block
  adBlockPatterns: [
    // Common ad networks
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'google-analytics.com',
    'googletagmanager.com',
    'facebook.net',
    'facebook.com/tr',
    'ads.yahoo.com',
    'amazon-adsystem.com',
    'adnxs.com',
    'adsrvr.org',
    'adform.net',
    'rubiconproject.com',
    'pubmatic.com',
    'openx.net',
    'criteo.com',
    'taboola.com',
    'outbrain.com',
    // Pop-under/pop-up networks
    'popads.net',
    'popcash.net',
    'propellerads.com',
    'adcash.com',
    'exoclick.com',
    'trafficjunky.com',
    'juicyads.com',
    // Video ad networks
    'imasdk.googleapis.com',
    'serving-sys.com',
    'bidswitch.net',
    'casalemedia.com',
    'contextweb.com',
    // Streaming site specific
    'streamtape.com/ad',
    'dood.watch/ad',
    'mixdrop.co/ad',
    'upstream.to/ad',
    // Generic patterns
    '/ads/',
    '/ad/',
    '/advertisement/',
    '/pop/',
    '/popup/',
    'banner',
    'prebid',
    'vast.xml',
    'vpaid'
  ],

  // Close button selectors for ad overlays
  adCloseSelectors: [
    '[class*="close"]',
    '[class*="Close"]',
    '[id*="close"]',
    '[aria-label*="close"]',
    '[aria-label*="Close"]',
    'button[class*="dismiss"]',
    '.ad-close',
    '.overlay-close',
    'svg[class*="close"]'
  ]
};
