// Cineby Provider Configuration

module.exports = {
  id: 'cineby',
  name: 'Cineby',
  baseUrl: 'https://www.cineby.gd',
  features: ['movies', 'tv'],

  // M3U8 CDN URL patterns for network interception
  m3u8Patterns: [
    /tasteful-wire\.workers\.dev.*\.m3u8/,
    /daring-look\.workers\.dev.*\.m3u8/,
    /embarrassed-caption\.workers\.dev.*\.m3u8/,
    /cloudspark.*\.m3u8/,
    /megafiles\.store.*\.m3u8/,
    /\.m3u8(\?|$)/
  ],

  // Segment URL patterns for playlist rewriting
  segmentPatterns: [
    // Match relative URLs like /raindust78.online/file2/...
    /^(\/[a-z0-9-]+\.(online|live|wiki|site|store)\/[^\n]+)$/gm
  ],

  // Play button selectors
  playButtonSelectors: [
    '#ButtonPlay',
    '[data-testid="play-button"]',
    'button:has-text("Play")',
    '.play-button'
  ],

  // Browse page configuration for catalog expansion
  browse: {
    // API endpoint pattern (buildId is dynamic)
    getDataUrl: (buildId, type = 'movie') =>
      `/_next/data/${buildId}/en/browse/${type}.json?type=${type}`,

    // Genre tabs available on browse page
    genreTabs: [
      'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
      'Documentary', 'Drama', 'Family', 'Fantasy', 'History',
      'Horror', 'Music', 'Mystery', 'Romance', 'Sci-Fi',
      'TV Movie', 'Thriller', 'War', 'Western'
    ],

    // Sort options
    sortOptions: [
      'vote_average.desc',
      'popularity.desc',
      'release_date.desc'
    ],

    // Scrolls per genre for infinite scroll loading
    scrollsPerGenre: 3,

    // Delay between requests (ms)
    requestDelay: 500
  },

  // Timeouts
  timeouts: {
    navigation: 20000,
    m3u8Capture: 30000,
    playButton: 3000
  }
};
