// M3U Playlist Generator - Creates M3U playlists for IPTV clients
// Supports multiple providers and content types

// Generate M3U header
function generateHeader() {
  return '#EXTM3U\n\n';
}

// Generate single movie entry
function generateMovieEntry(movie, providerId, host, options = {}) {
  const { groupPrefix = 'Movies' } = options;

  const logo = movie.poster || '';
  const year = movie.year ? ` (${movie.year})` : '';
  const rating = movie.rating ? ` [${movie.rating.toFixed(1)}]` : '';
  const category = movie.category || movie.genres?.[0] || 'Movies';
  const group = `${groupPrefix} - ${category}`;

  const extinf = [
    `#EXTINF:-1`,
    `tvg-id="${providerId}-${movie.tmdbId}"`,
    `tvg-name="${movie.title}"`,
    `tvg-logo="${logo}"`,
    `group-title="${group}"`,
  ].join(' ');

  const title = `${movie.title}${year}${rating}`;
  const url = `http://${host}/vod/${providerId}/${movie.tmdbId}/stream`;

  return `${extinf},${title}\n${url}\n`;
}

// Generate playlist for a provider's movies
function generateProviderPlaylist(movies, providerId, host, options = {}) {
  const { includeHeader = false, groupPrefix } = options;

  let m3u = includeHeader ? generateHeader() : '';

  for (const movie of movies) {
    m3u += generateMovieEntry(movie, providerId, host, { groupPrefix });
  }

  return m3u;
}

// Generate combined playlist for multiple providers
function generateCombinedPlaylist(providerCatalogs, host) {
  let m3u = generateHeader();
  m3u += `# VOD Playlist - Generated ${new Date().toISOString()}\n\n`;

  for (const { providerId, providerName, movies } of providerCatalogs) {
    if (movies && movies.length > 0) {
      m3u += `# ${providerName}\n`;
      m3u += generateProviderPlaylist(movies, providerId, host, {
        groupPrefix: providerName
      });
      m3u += '\n';
    }
  }

  return m3u;
}

// Generate VOD JSON catalog (for APIs)
function generateVodJson(movies, providerId, options = {}) {
  const { host = 'localhost' } = options;

  return {
    generated: new Date().toISOString(),
    provider: providerId,
    totalMovies: movies.length,
    movies: movies.map(movie => ({
      id: movie.tmdbId,
      title: movie.title,
      year: movie.year,
      genres: movie.genres || [movie.category],
      rating: movie.rating,
      poster: movie.poster,
      backdrop: movie.backdrop,
      description: movie.description,
      hasStream: movie.hasStream || false,
      streamUrl: `http://${host}/vod/${providerId}/${movie.tmdbId}/stream`
    }))
  };
}

// Legacy format for backward compatibility with cineby-movies.js
function generateLegacyM3U(movies, host) {
  let m3u = '';

  for (const movie of movies) {
    const logo = movie.poster || '';
    const category = movie.category || 'Movies';
    m3u += `#EXTINF:-1 tvg-id="cineby-${movie.id}" tvg-name="${movie.title}" tvg-logo="${logo}" group-title="Cineby - ${category}",${movie.title}${movie.year ? ` (${movie.year})` : ''}\n`;
    m3u += `http://${host}/cineby/${movie.id}/stream\n`;
  }

  return m3u;
}

module.exports = {
  generateHeader,
  generateMovieEntry,
  generateProviderPlaylist,
  generateCombinedPlaylist,
  generateVodJson,
  generateLegacyM3U
};
