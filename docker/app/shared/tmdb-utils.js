// Shared TMDB Utilities - Genre mapping and metadata helpers
// Used by all VOD providers (Cineby, CinemaOS, etc.)

// TMDB Genre ID to Name mapping
const GENRE_MAP = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
};

// Reverse lookup: name to ID
const GENRE_NAME_TO_ID = Object.fromEntries(
  Object.entries(GENRE_MAP).map(([id, name]) => [name, parseInt(id)])
);

// Get genre name from ID
function getGenreName(genreId) {
  return GENRE_MAP[genreId] || 'Unknown';
}

// Get genre ID from name
function getGenreId(genreName) {
  return GENRE_NAME_TO_ID[genreName] || null;
}

// Convert genre IDs array to names
function genreIdsToNames(genreIds) {
  if (!genreIds || !Array.isArray(genreIds)) return [];
  return genreIds.map(id => GENRE_MAP[id]).filter(Boolean);
}

// Get primary genre from genre_ids array
function getPrimaryGenre(genreIds, fallback = 'Movies') {
  if (!genreIds || genreIds.length === 0) return fallback;
  return GENRE_MAP[genreIds[0]] || fallback;
}

// Normalize movie data from various API formats to standard internal format
function normalizeMovie(apiMovie, options = {}) {
  const { provider = 'unknown', source = 'API' } = options;

  // Extract year from various date formats
  let year = null;
  if (apiMovie.year) {
    year = apiMovie.year;
  } else if (apiMovie.release_date) {
    year = parseInt(apiMovie.release_date.split('-')[0]);
  } else if (apiMovie.releaseDate) {
    year = parseInt(apiMovie.releaseDate.split('-')[0]);
  }

  // Get genre names
  const genreIds = apiMovie.genre_ids || apiMovie.genreIds || [];
  const genres = apiMovie.genres || genreIdsToNames(genreIds);

  // Get primary category
  const category = getPrimaryGenre(genreIds, source);

  // Build poster URL
  let poster = apiMovie.poster || apiMovie.poster_path;
  if (poster && poster.startsWith('/')) {
    poster = `https://image.tmdb.org/t/p/w500${poster}`;
  }

  // Build backdrop URL
  let backdrop = apiMovie.backdrop || apiMovie.image || apiMovie.backdrop_path;
  if (backdrop && backdrop.startsWith('/')) {
    backdrop = `https://image.tmdb.org/t/p/original${backdrop}`;
  }

  return {
    id: (apiMovie.id || apiMovie.tmdbId).toString(),
    tmdbId: apiMovie.id || apiMovie.tmdbId,
    title: apiMovie.title || apiMovie.name,
    year,
    releaseDate: apiMovie.release_date || apiMovie.releaseDate || null,
    genres,
    genreIds,
    category,
    rating: apiMovie.vote_average || apiMovie.rating || 0,
    description: apiMovie.overview || apiMovie.description || '',
    poster,
    backdrop,
    mediaType: apiMovie.media_type || apiMovie.mediaType || 'movie',
    source,
    provider
  };
}

// Get all genre names
function getAllGenres() {
  return Object.values(GENRE_MAP);
}

module.exports = {
  GENRE_MAP,
  GENRE_NAME_TO_ID,
  getGenreName,
  getGenreId,
  genreIdsToNames,
  getPrimaryGenre,
  normalizeMovie,
  getAllGenres
};
