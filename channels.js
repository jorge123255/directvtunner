// DirecTV Channel Definitions
// URL format: https://stream.directv.com/watch/{ChannelName}

const channels = [
  // Sports
  { id: 'espn', name: 'ESPN', number: '206', category: 'Sports' },
  { id: 'espn2', name: 'ESPN2', number: '209', category: 'Sports' },
  { id: 'espnu', name: 'ESPNU', number: '208', category: 'Sports' },
  { id: 'espnews', name: 'ESPNews', number: '207', category: 'Sports' },
  { id: 'fs1', name: 'FS1', number: '219', category: 'Sports' },
  { id: 'fs2', name: 'FS2', number: '618', category: 'Sports' },
  { id: 'nfl-network', name: 'NFL Network', number: '212', category: 'Sports' },
  { id: 'mlb-network', name: 'MLB Network', number: '213', category: 'Sports' },
  { id: 'nba-tv', name: 'NBA TV', number: '216', category: 'Sports' },
  { id: 'nhl-network', name: 'NHL Network', number: '215', category: 'Sports' },
  { id: 'golf', name: 'Golf Channel', number: '218', category: 'Sports' },
  { id: 'tnt', name: 'TNT', number: '245', category: 'Sports' },
  { id: 'tbs', name: 'TBS', number: '247', category: 'Sports' },

  // News
  { id: 'cnn', name: 'CNN', number: '202', category: 'News' },
  { id: 'fox-news', name: 'Fox News', number: '360', category: 'News' },
  { id: 'msnbc', name: 'MSNBC', number: '356', category: 'News' },
  { id: 'cnbc', name: 'CNBC', number: '355', category: 'News' },
  { id: 'fox-business', name: 'Fox Business', number: '359', category: 'News' },
  { id: 'hln', name: 'HLN', number: '204', category: 'News' },
  { id: 'bbc-america', name: 'BBC America', number: '264', category: 'News' },

  // Entertainment
  { id: 'usa', name: 'USA Network', number: '242', category: 'Entertainment' },
  { id: 'fx', name: 'FX', number: '248', category: 'Entertainment' },
  { id: 'amc', name: 'AMC', number: '254', category: 'Entertainment' },
  { id: 'bravo', name: 'Bravo', number: '237', category: 'Entertainment' },
  { id: 'e', name: 'E!', number: '236', category: 'Entertainment' },
  { id: 'comedy-central', name: 'Comedy Central', number: '249', category: 'Entertainment' },
  { id: 'mtv', name: 'MTV', number: '331', category: 'Entertainment' },
  { id: 'vh1', name: 'VH1', number: '335', category: 'Entertainment' },
  { id: 'bet', name: 'BET', number: '329', category: 'Entertainment' },
  { id: 'syfy', name: 'Syfy', number: '244', category: 'Entertainment' },
  { id: 'paramount', name: 'Paramount Network', number: '241', category: 'Entertainment' },
  { id: 'a-and-e', name: 'A&E', number: '265', category: 'Entertainment' },
  { id: 'lifetime', name: 'Lifetime', number: '252', category: 'Entertainment' },
  { id: 'hallmark', name: 'Hallmark Channel', number: '312', category: 'Entertainment' },

  // Kids
  { id: 'disney', name: 'Disney Channel', number: '290', category: 'Kids' },
  { id: 'disney-xd', name: 'Disney XD', number: '292', category: 'Kids' },
  { id: 'disney-jr', name: 'Disney Junior', number: '289', category: 'Kids' },
  { id: 'nick', name: 'Nickelodeon', number: '299', category: 'Kids' },
  { id: 'nick-jr', name: 'Nick Jr.', number: '301', category: 'Kids' },
  { id: 'cartoon-network', name: 'Cartoon Network', number: '296', category: 'Kids' },

  // Movies
  { id: 'hbo', name: 'HBO', number: '501', category: 'Movies' },
  { id: 'hbo2', name: 'HBO2', number: '502', category: 'Movies' },
  { id: 'max', name: 'MAX', number: '515', category: 'Movies' },
  { id: 'showtime', name: 'Showtime', number: '545', category: 'Movies' },
  { id: 'starz', name: 'STARZ', number: '525', category: 'Movies' },
  { id: 'cinemax', name: 'Cinemax', number: '515', category: 'Movies' },

  // Documentary
  { id: 'discovery', name: 'Discovery', number: '278', category: 'Documentary' },
  { id: 'history', name: 'History', number: '269', category: 'Documentary' },
  { id: 'natgeo', name: 'National Geographic', number: '276', category: 'Documentary' },
  { id: 'animal-planet', name: 'Animal Planet', number: '282', category: 'Documentary' },
  { id: 'tlc', name: 'TLC', number: '280', category: 'Documentary' },
  { id: 'hgtv', name: 'HGTV', number: '229', category: 'Documentary' },
  { id: 'food-network', name: 'Food Network', number: '231', category: 'Documentary' },
  { id: 'travel', name: 'Travel Channel', number: '277', category: 'Documentary' },
];

// Generate URL for channel
// DirecTV Stream URL format - can be overridden per channel with 'url' field
function getChannelUrl(channel) {
  // If channel has explicit URL, use it
  if (channel.url) {
    return channel.url;
  }
  // Default: use channel number
  return `https://stream.directv.com/watch/${channel.number}`;
}

// Get channel by ID
function getChannel(id) {
  return channels.find(ch => ch.id === id);
}

// Get all channels with URLs
function getAllChannels() {
  return channels.map(ch => ({
    ...ch,
    url: getChannelUrl(ch),
  }));
}

// Get channels by category
function getChannelsByCategory(category) {
  return channels
    .filter(ch => ch.category.toLowerCase() === category.toLowerCase())
    .map(ch => ({
      ...ch,
      url: getChannelUrl(ch),
    }));
}

// Generate M3U playlist
function generateM3U(serverHost) {
  let m3u = '#EXTM3U\n';
  m3u += '#EXTM3U x-tvg-url=""\n\n';

  for (const ch of channels) {
    m3u += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" `;
    m3u += `tvg-chno="${ch.number}" group-title="${ch.category}",${ch.name}\n`;
    m3u += `http://${serverHost}/stream/${ch.id}\n`;
  }

  return m3u;
}

module.exports = {
  channels,
  getChannel,
  getChannelUrl,
  getAllChannels,
  getChannelsByCategory,
  generateM3U,
};
