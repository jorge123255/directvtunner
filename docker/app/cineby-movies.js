// Cineby Movie Catalog
// Movies are fetched from cineby.gd - user must be logged in via noVNC
// URL format: https://www.cineby.gd/movie/{tmdb_id}

const movies = [
  // Sample movies - these will be populated dynamically or manually
  // The cinebyUrl uses TMDB IDs which Cineby uses for movie pages

  // Christmas Movies
  { id: 'elf', title: 'Elf', year: 2003, tmdbId: 10719, category: 'Holiday' },
  { id: 'home-alone', title: 'Home Alone', year: 1990, tmdbId: 771, category: 'Holiday' },
  { id: 'home-alone-2', title: 'Home Alone 2: Lost in New York', year: 1992, tmdbId: 772, category: 'Holiday' },
  { id: 'christmas-story', title: 'A Christmas Story', year: 1983, tmdbId: 850, category: 'Holiday' },
  { id: 'polar-express', title: 'The Polar Express', year: 2004, tmdbId: 5255, category: 'Holiday' },
  { id: 'grinch-2000', title: 'How the Grinch Stole Christmas', year: 2000, tmdbId: 8871, category: 'Holiday' },
  { id: 'christmas-vacation', title: 'National Lampoon\'s Christmas Vacation', year: 1989, tmdbId: 5825, category: 'Holiday' },
  { id: 'its-a-wonderful-life', title: 'It\'s a Wonderful Life', year: 1946, tmdbId: 1585, category: 'Holiday' },
  { id: 'miracle-on-34th', title: 'Miracle on 34th Street', year: 1994, tmdbId: 11881, category: 'Holiday' },
  { id: 'die-hard', title: 'Die Hard', year: 1988, tmdbId: 562, category: 'Holiday' },

  // Action
  { id: 'john-wick', title: 'John Wick', year: 2014, tmdbId: 245891, category: 'Action' },
  { id: 'john-wick-2', title: 'John Wick: Chapter 2', year: 2017, tmdbId: 324552, category: 'Action' },
  { id: 'john-wick-3', title: 'John Wick: Chapter 3 - Parabellum', year: 2019, tmdbId: 458156, category: 'Action' },
  { id: 'john-wick-4', title: 'John Wick: Chapter 4', year: 2023, tmdbId: 603692, category: 'Action' },
  { id: 'mad-max-fury-road', title: 'Mad Max: Fury Road', year: 2015, tmdbId: 76341, category: 'Action' },
  { id: 'mission-impossible-7', title: 'Mission: Impossible - Dead Reckoning Part One', year: 2023, tmdbId: 575264, category: 'Action' },
  { id: 'top-gun-maverick', title: 'Top Gun: Maverick', year: 2022, tmdbId: 361743, category: 'Action' },

  // Comedy
  { id: 'superbad', title: 'Superbad', year: 2007, tmdbId: 8363, category: 'Comedy' },
  { id: 'hangover', title: 'The Hangover', year: 2009, tmdbId: 18785, category: 'Comedy' },
  { id: 'step-brothers', title: 'Step Brothers', year: 2008, tmdbId: 12133, category: 'Comedy' },
  { id: 'bridesmaids', title: 'Bridesmaids', year: 2011, tmdbId: 55721, category: 'Comedy' },

  // Drama
  { id: 'shawshank', title: 'The Shawshank Redemption', year: 1994, tmdbId: 278, category: 'Drama' },
  { id: 'godfather', title: 'The Godfather', year: 1972, tmdbId: 238, category: 'Drama' },
  { id: 'forrest-gump', title: 'Forrest Gump', year: 1994, tmdbId: 13, category: 'Drama' },
  { id: 'fight-club', title: 'Fight Club', year: 1999, tmdbId: 550, category: 'Drama' },
  { id: 'oppenheimer', title: 'Oppenheimer', year: 2023, tmdbId: 872585, category: 'Drama' },

  // Sci-Fi
  { id: 'inception', title: 'Inception', year: 2010, tmdbId: 27205, category: 'Sci-Fi' },
  { id: 'interstellar', title: 'Interstellar', year: 2014, tmdbId: 157336, category: 'Sci-Fi' },
  { id: 'matrix', title: 'The Matrix', year: 1999, tmdbId: 603, category: 'Sci-Fi' },
  { id: 'blade-runner-2049', title: 'Blade Runner 2049', year: 2017, tmdbId: 335984, category: 'Sci-Fi' },
  { id: 'dune', title: 'Dune', year: 2021, tmdbId: 438631, category: 'Sci-Fi' },
  { id: 'dune-2', title: 'Dune: Part Two', year: 2024, tmdbId: 693134, category: 'Sci-Fi' },

  // Horror
  { id: 'get-out', title: 'Get Out', year: 2017, tmdbId: 419430, category: 'Horror' },
  { id: 'quiet-place', title: 'A Quiet Place', year: 2018, tmdbId: 447332, category: 'Horror' },
  { id: 'hereditary', title: 'Hereditary', year: 2018, tmdbId: 493922, category: 'Horror' },

  // Animation
  { id: 'spider-verse', title: 'Spider-Man: Into the Spider-Verse', year: 2018, tmdbId: 324857, category: 'Animation' },
  { id: 'spider-verse-2', title: 'Spider-Man: Across the Spider-Verse', year: 2023, tmdbId: 569094, category: 'Animation' },
  { id: 'toy-story', title: 'Toy Story', year: 1995, tmdbId: 862, category: 'Animation' },
  { id: 'inside-out-2', title: 'Inside Out 2', year: 2024, tmdbId: 1022789, category: 'Animation' },
];

// Build Cineby URL from TMDB ID
function getCinebyUrl(movie) {
  return `https://www.cineby.gd/movie/${movie.tmdbId}`;
}

// Get all movies
function getAllMovies() {
  return movies.map(m => ({
    ...m,
    cinebyUrl: getCinebyUrl(m)
  }));
}

// Get movie by ID
function getMovie(movieId) {
  const movie = movies.find(m => m.id === movieId);
  if (!movie) return null;
  return {
    ...movie,
    cinebyUrl: getCinebyUrl(movie)
  };
}

// Search movies by title
function searchMovies(query) {
  const q = query.toLowerCase();
  return movies
    .filter(m => m.title.toLowerCase().includes(q))
    .map(m => ({
      ...m,
      cinebyUrl: getCinebyUrl(m)
    }));
}

// Get movies by category
function getMoviesByCategory(category) {
  return movies
    .filter(m => m.category === category)
    .map(m => ({
      ...m,
      cinebyUrl: getCinebyUrl(m)
    }));
}

// Get all categories
function getCategories() {
  return [...new Set(movies.map(m => m.category))];
}

// Generate M3U entries for Cineby movies
function generateCinebyM3U(host) {
  let m3u = '';

  for (const movie of movies) {
    m3u += `#EXTINF:-1 tvg-id="cineby-${movie.id}" tvg-name="${movie.title}" group-title="Cineby - ${movie.category}",${movie.title} (${movie.year})\n`;
    m3u += `http://${host}/cineby/${movie.id}/stream\n`;
  }

  return m3u;
}

module.exports = {
  getAllMovies,
  getMovie,
  searchMovies,
  getMoviesByCategory,
  getCategories,
  generateCinebyM3U,
  getCinebyUrl
};
