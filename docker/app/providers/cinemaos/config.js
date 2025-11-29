// CinemaOS Provider Configuration

module.exports = {
  id: 'cinemaos',
  name: 'CinemaOS',
  baseUrl: 'https://cinemaos.live',
  features: ['movies'],  // Movies only for now

  // API endpoints
  api: {
    tmdb: '/api/tmdb',
    // These may be used for stream resolution
    fuckit: '/api/fuckit',
    neoResources: '/api/neo/resources',
    videoplatform: '/api/videoplatform/'
  },

  // M3U8 URL patterns - need browser exploration to discover
  // Starting with generic patterns
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

  // Play button selectors
  playButtonSelectors: [
    'button:has-text("Watch")',
    'button:has-text("Play")',
    'a:has-text("Watch")',
    '[data-action="play"]',
    '.play-button',
    '#play-btn'
  ],

  // Content sections
  sections: {
    movies: '/movie',
    tv: '/tv',
    anime: '/anime',
    sports: '/livesports',
    iptv: '/iptv',
    collection: '/collection'
  },

  // Timeouts (longer due to obfuscated link resolution)
  timeouts: {
    navigation: 30000,
    m3u8Capture: 45000,
    playButton: 5000,
    linkResolution: 15000
  },

  // Request parameters for TMDB API
  tmdbParams: {
    language: 'en-US',
    sortBy: 'popularity.desc'
  },

  // Movie categories to fetch (each is a different requestID)
  movieCategories: [
    'popularMovie',
    'latestMovie',
    'topRatedMovie',
    'upcomingMovie'
  ],

  // Number of pages to fetch per category
  pagesPerCategory: 3,

  // Request delay between API calls (ms)
  requestDelay: 300,

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
