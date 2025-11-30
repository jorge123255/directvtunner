# DirecTV Stream Tuner

A Docker-based IPTV proxy that turns DirecTV Stream into an M3U playlist compatible with apps like TvMate, VLC, and other IPTV players.

## Features

### DirecTV Live TV
- **Tuner Architecture**: Simulates traditional TV tuners - one Chrome instance per tuner
- **HLS Streaming**: Captures DirecTV video via FFmpeg and serves as HLS streams
- **M3U Playlist**: Generates M3U playlists compatible with IPTV apps
- **Auto Channel Switching**: Automatically switches channels when requested
- **Smart Video Detection**: Waits for video to be ready before starting capture
- **noVNC Access**: Built-in VNC viewer to see what Chrome is doing
- **348 Channels**: Extensive channel list with smart matching
- **EPG (Electronic Program Guide)**: Full XMLTV EPG with 830+ channels
- **Auto-refresh EPG**: Automatically updates every 4 hours

### CinemaOS Movies (23,000+ Movies)
- **Massive Movie Library**: 23,000+ deduplicated movies from CinemaOS
- **Auto-refresh Database**: Automatically scans for new movies every 6 hours
- **Incremental Updates**: Only fetches new content (efficient)
- **Full Metadata**: Posters, ratings, genres, year, overview
- **VOD with Pause/Rewind**: Native HLS playback support
- **Direct API Integration**: Uses CinemaOS scraper API for stream URLs

### Cineby TV Shows (3,000+ Shows) - NEW!
- **Extensive TV Library**: 3,000+ TV shows from TMDB
- **Auto-refresh Database**: Automatically scans for new shows every 1 hour
- **Hourly Updates**: TV shows update more frequently for new episodes
- **Full Metadata**: Posters, ratings, genres, year, overview
- **Categories**: Popular, Top Rated, On The Air, Airing Today
- **Direct Streaming**: Uses CinemaOS scraper API for stream URLs

### Additional VOD Providers
- **Cineby**: Additional movie source with browser-based extraction

---

## Docker Hub

```bash
docker pull sunnyside1/directvtuner:latest
```

---

## Quick Start

```bash
docker run -d \
  --name dvr-tuner \
  -p 7070:7070 \
  -p 6080:6080 \
  -p 9222:9222 \
  -v ./chrome-profile:/data/chrome-profile \
  sunnyside1/directvtuner:latest
```

---

## Network Configuration

This container works with different Docker networking modes. Choose the one that fits your setup:

### Option 1: Bridge Network (Simplest - Recommended for Most Users)

Standard Docker networking with port mapping. Works everywhere.

```yaml
version: '3.8'
services:
  dvr-tuner1:
    image: sunnyside1/directvtuner:latest
    container_name: dvr-tuner1
    ports:
      - "7070:7070"   # IPTV API
      - "6080:6080"   # noVNC web viewer
      - "5900:5900"   # VNC
      - "9222:9222"   # Chrome debugging
    volumes:
      - ./chrome-profile:/data/chrome-profile
      - ./streams:/data/streams
    restart: unless-stopped
```

**Access URLs:**
- Playlist: `http://YOUR_HOST_IP:7070/playlist.m3u`
- noVNC: `http://YOUR_HOST_IP:6080`

---

### Option 2: Host Network (Simple, No Port Conflicts)

Container shares the host's network stack directly.

```yaml
version: '3.8'
services:
  dvr-tuner1:
    image: sunnyside1/directvtuner:latest
    container_name: dvr-tuner1
    network_mode: host
    volumes:
      - ./chrome-profile:/data/chrome-profile
      - ./streams:/data/streams
    restart: unless-stopped
```

**Access URLs:**
- Playlist: `http://YOUR_HOST_IP:7070/playlist.m3u`
- noVNC: `http://YOUR_HOST_IP:6080`

**Note:** All ports are exposed directly on the host. Make sure ports 7070, 6080, 5900, 9222 are not in use.

---

### Option 3: Macvlan Network (Container Gets Its Own IP)

Container gets a dedicated IP on your LAN - appears as a separate device. Best for Unraid and advanced setups.

**Step 1: Create macvlan network (one-time setup)**

```bash
# Adjust these for your network:
# - parent: your network interface (eth0, br0, bond0, etc.)
# - subnet: your LAN subnet
# - gateway: your router IP
# - ip-range: range of IPs for containers

docker network create -d macvlan \
  --subnet=192.168.1.0/24 \
  --gateway=192.168.1.1 \
  --ip-range=192.168.1.90/29 \
  -o parent=eth0 \
  macvlan_net
```

**Step 2: Docker Compose**

```yaml
version: '3.8'
services:
  dvr-tuner1:
    image: sunnyside1/directvtuner:latest
    container_name: dvr-tuner1
    networks:
      macvlan_net:
        ipv4_address: 192.168.1.92  # Pick an IP in your range
    volumes:
      - ./chrome-profile:/data/chrome-profile
      - ./streams:/data/streams
    restart: unless-stopped

networks:
  macvlan_net:
    external: true
```

**Access URLs:**
- Playlist: `http://192.168.1.92:7070/playlist.m3u`
- noVNC: `http://192.168.1.92:6080`

**Note:** With macvlan, the container has its own IP but cannot communicate with the Docker host directly. Use a macvlan shim interface if you need host-to-container communication.

---

## First-Time Setup

1. Start the container using one of the network configurations above
2. Access noVNC at `http://<IP>:6080`
3. Log into DirecTV Stream in the Chrome browser with **your own credentials**
4. The login session will be saved in the `chrome-profile` volume for future use

**Important:** The Docker image does NOT include any DirecTV credentials. Each user must log in with their own DirecTV Stream subscription.

---

## API Endpoints

### DirecTV Live TV

| Endpoint | Description |
|----------|-------------|
| `GET /playlist.m3u` | M3U playlist for IPTV apps |
| `GET /stream/:channelId` | Stream a specific channel |
| `GET /channels` | List all available channels |
| `GET /tuners` | Check tuner status |
| `GET /health` | Health check |

### DirecTV EPG

| Endpoint | Description |
|----------|-------------|
| `GET /tve/directv/epg.xml` | XMLTV EPG data |
| `GET /tve/directv/playlist.m3u` | M3U with EPG tvg-id mapping |
| `GET /tve/directv/channels` | List channels from EPG |
| `GET /tve/directv/epg/status` | EPG refresh status |
| `POST /tve/directv/epg/refresh` | Manual EPG refresh |

### CinemaOS Movies (23,000+)

| Endpoint | Description |
|----------|-------------|
| `GET /cinemaos/playlist.m3u` | M3U playlist with all movies |
| `GET /cinemaos/stats` | Database statistics |
| `GET /cinemaos/auto-refresh/status` | Auto-refresh status |
| `POST /cinemaos/auto-refresh/start?hours=6` | Start/change auto-refresh interval |
| `POST /cinemaos/auto-refresh/stop` | Stop auto-refresh |
| `POST /cinemaos/update` | Manual incremental update |
| `POST /cinemaos/fetch-full` | Full database refresh (30-60 min) |
| `POST /cinemaos/generate-playlist` | Regenerate M3U playlist |

### VOD Streaming (Unified)

| Endpoint | Description |
|----------|-------------|
| `GET /vod/providers` | List all VOD providers |
| `GET /vod/:provider/catalog` | Provider movie catalog |
| `GET /vod/:provider/:contentId/stream` | Stream a movie |
| `GET /vod/:provider/playlist.m3u` | Provider-specific M3U |
| `GET /vod/combined-playlist.m3u` | Combined M3U from all providers |

### Cineby Movies

| Endpoint | Description |
|----------|-------------|
| `GET /cineby-playlist.m3u` | Cineby movies M3U |
| `GET /cineby/movies` | List all Cineby movies |
| `GET /cineby/:movieId/stream` | Stream a Cineby movie |

### Cineby TV Shows (3,000+)

| Endpoint | Description |
|----------|-------------|
| `GET /tv/playlist.m3u` | M3U playlist with all TV shows |
| `GET /tv/stats` | Database statistics |
| `GET /tv/auto-refresh/status` | Auto-refresh status |
| `POST /tv/auto-refresh/start?hours=1` | Start/change auto-refresh interval |
| `POST /tv/auto-refresh/stop` | Stop auto-refresh |
| `POST /tv/update` | Manual incremental update |
| `POST /tv/fetch-full` | Full database refresh |
| `POST /tv/generate-playlist` | Regenerate M3U playlist |

---

## Usage

### Add to TvMate / IPTV Apps

**For Movies:**
```
http://<SERVER_IP>:7070/cinemaos/playlist.m3u
```

**For TV Shows:**
```
http://<SERVER_IP>:7070/tv/playlist.m3u
```

**For Live TV with EPG:**
```
Playlist: http://<SERVER_IP>:7070/tve/directv/playlist.m3u
EPG URL:  http://<SERVER_IP>:7070/tve/directv/epg.xml
```

### VLC

```bash
vlc http://<SERVER_IP>:7070/cinemaos/playlist.m3u
```

### Direct Stream

Open a specific channel:
```
http://<SERVER_IP>:7070/stream/cnn
http://<SERVER_IP>:7070/stream/espn
```

---

## Auto-Refresh Schedule

| Service | Interval | Description |
|---------|----------|-------------|
| DirecTV EPG | 4 hours | Updates channel guide (830+ channels) |
| CinemaOS Movies | 6 hours | Scans for new movies (incremental) |
| Cineby TV Shows | 1 hour | Scans for new TV shows/episodes (incremental) |

---

## Database Statistics

### CinemaOS Movies
- **23,148 unique movies** (deduplicated across categories)
- **Categories**: popularMovie, latestMovie, topRatedMovie, upcomingMovie
- **Genres**: Action, Comedy, Drama, Horror, Sci-Fi, Thriller, and more
- **Full metadata**: Posters, backdrops, ratings, vote counts, release dates, overviews

### Cineby TV Shows
- **3,167 unique TV shows** (deduplicated across categories)
- **Categories**: popular, top_rated, on_the_air, airing_today
- **Genres**: Drama, Comedy, Sci-Fi & Fantasy, Crime, Animation, and more
- **Full metadata**: Posters, backdrops, ratings, vote counts, first air dates, overviews

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Container                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │   Xvfb   │  │  Chrome  │  │  FFmpeg  │  │  Node.js │    │
│  │ (Display)│  │ (Browser)│  │(Capture) │  │ (Server) │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│        │            │             │             │           │
│        └────────────┴─────────────┴─────────────┘           │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Stream Proxy (port 7070)                │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  • DirecTV Live Streams                             │    │
│  │  • EPG Service (auto-refresh every 4 hours)         │    │
│  │  • CinemaOS Movies (auto-refresh every 6 hours)     │    │
│  │  • Cineby TV Shows (auto-refresh every 1 hour)      │    │
│  │  • VOD Providers (Cineby)                           │    │
│  │  • HLS Proxy with header injection                  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            │
                     HLS Stream Output
                            │
              ┌─────────────┴─────────────┐
              │                           │
         ┌────┴────┐               ┌──────┴──────┐
         │  VLC    │               │  TvMate     │
         └─────────┘               └─────────────┘
```

---

## Files Structure

```
/app
├── stream-proxy.js          # Main server
├── directv-epg.js           # EPG service with auto-refresh
├── cinemaos-db-manager.js   # Movie database with auto-refresh
├── cineby-tv-manager.js     # TV show database with auto-refresh
├── tuner-manager.js         # DirecTV tuner management
├── channels.js              # Channel definitions
├── providers/
│   ├── base-provider.js     # Base provider class
│   ├── cinemaos/            # CinemaOS provider (direct API)
│   └── cineby/              # Cineby provider
└── data/
    ├── cinemaos-movies-db.json  # Movie database (23K+ movies)
    ├── cinemaos-movies.m3u      # Movie M3U playlist
    ├── cineby-tv-db.json        # TV show database (3K+ shows)
    ├── cineby-tv.m3u            # TV show M3U playlist
    └── epg-cache.json           # EPG cache
```

---

## Configuration

Edit `app/config.js` to customize:

- `numTuners`: Number of simultaneous streams (default: 1)
- `port`: HTTP server port (default: 7070)
- `resolution`: Video resolution (default: 1280x720)
- `videoBitrate`: Video bitrate (default: 3M)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TUNER_HOST` | `localhost:7070` | Host for stream URLs in M3U |
| `DATA_DIR` | `/app/data` | Data directory for databases |
| `CHROME_DEBUG_PORT` | `9222` | Chrome DevTools Protocol port |

---

## Adding Channels

Edit `app/channels.js` to add/modify channels:

```javascript
{
  id: 'cnn',
  name: 'CNN',
  number: 202,
  category: 'News',
  searchTerms: ['cnn', 'cable news network']
}
```

---

## Troubleshooting

### Container won't start
- Check if ports are already in use: `netstat -tulpn | grep 7070`
- Try host network mode to avoid port conflicts

### Can't access from other devices
- Bridge mode: Make sure you're using the host's IP, not `localhost`
- Macvlan: Container has its own IP - use that IP directly
- Check firewall rules on the host

### Stream not playing
- Access noVNC to verify Chrome is logged into DirecTV
- Check `/health` endpoint for status
- Look at container logs: `docker logs dvr-tuner1`

### High latency
- Reduce VLC network caching to 500ms
- Current FFmpeg settings use 1-second HLS segments (already optimized)

### CinemaOS movies not loading
- Check `/cinemaos/stats` for database status
- Verify auto-refresh is running: `/cinemaos/auto-refresh/status`
- Manual update: `POST /cinemaos/update`

---

## License

MIT License
