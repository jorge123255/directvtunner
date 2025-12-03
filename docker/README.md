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
# CPU-only (default)
docker pull sunnyside1/directvtuner:latest

# NVIDIA GPU accelerated (single or multi-tuner)
docker pull sunnyside1/directvtuner:nvidia-multi

# Intel VAAPI accelerated (single or multi-tuner)
docker pull sunnyside1/directvtuner:intel-vaapi
```

### Image Tags

| Tag | Description | Hardware |
|-----|-------------|----------|
| `latest` | CPU-only encoding (libx264) | Any |
| `nvidia` | NVIDIA NVENC single-tuner | NVIDIA GPU (GTX 600+) |
| `nvidia-multi` | NVIDIA NVENC multi-tuner | NVIDIA GPU (GTX 600+) |
| `intel-vaapi` | Intel VA-API (single or multi-tuner) | Intel CPU with iGPU |

### Multi-Tuner Support

All GPU images support multi-tuner via the `DVR_NUM_TUNERS` environment variable:
- Set `DVR_NUM_TUNERS=3` for 3 simultaneous tuners
- Each tuner runs its own Chrome instance and Xvfb display
- Each tuner has its own noVNC port (6080, 6081, 6082)
- Requires separate DirecTV login per tuner (via VNC)

### Auto-Recovery

All images include automatic recovery from Chrome crashes:
- Detects stale CDP (Chrome DevTools Protocol) connections
- Automatically reconnects with exponential backoff
- Periodic health checks every 30 seconds
- No manual container reboots needed

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

## GPU Acceleration (NVIDIA)

For significantly better performance and lower CPU usage, use the NVIDIA GPU-accelerated image.

### Requirements

1. **NVIDIA GPU** with NVENC support (GTX 600 series or newer)
2. **NVIDIA drivers** installed on the host
3. **nvidia-container-toolkit** installed

### Install nvidia-container-toolkit

```bash
# Ubuntu/Debian
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Docker Compose with NVIDIA GPU

```yaml
version: '3.8'
services:
  dvr-tuner-nvidia:
    image: sunnyside1/directvtuner:nvidia
    container_name: dvr-tuner-nvidia
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=video,compute,utility
    ports:
      - "7070:7070"
      - "6080:6080"
      - "5900:5900"
      - "9222:9222"
    volumes:
      - ./chrome-profile:/data/chrome-profile
      - ./streams:/data/streams
    restart: unless-stopped
```

### Docker Run with NVIDIA GPU

```bash
# Single tuner
docker run -d \
  --name dvr-tuner-nvidia \
  --runtime=nvidia \
  --gpus all \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=video,compute,utility \
  -p 7070:7070 \
  -p 6080:6080 \
  -v ./dvr-data:/data \
  -e TZ=America/New_York \
  sunnyside1/directvtuner:nvidia-multi

# Multi-tuner (3 tuners)
docker run -d \
  --name dvr-tuner-nvidia \
  --runtime=nvidia \
  --gpus all \
  --shm-size=2g \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=video,compute,utility \
  -p 7070:7070 \
  -p 6080:6080 \
  -p 6081:6081 \
  -p 6082:6082 \
  -v ./dvr-data:/data \
  -e TZ=America/New_York \
  -e DVR_NUM_TUNERS=3 \
  sunnyside1/directvtuner:nvidia-multi
```

**Multi-tuner login:**
- Tuner 0: `http://YOUR_IP:6080`
- Tuner 1: `http://YOUR_IP:6081`
- Tuner 2: `http://YOUR_IP:6082`

### NVENC Settings (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `DVR_NVENC_PRESET` | `p4` | Encoding preset: p1 (fastest) to p7 (best quality) |
| `DVR_NVENC_TUNE` | `ll` | Tuning: `ll` (low latency), `ull` (ultra low latency), `hq` (high quality) |
| `DVR_NVENC_RC` | `vbr` | Rate control: `vbr`, `cbr`, `cq` |
| `DVR_NVENC_BFRAMES` | `0` | B-frames (0 for lowest latency) |

### GPU Monitoring

The web GUI (Status tab) shows real-time GPU stats:
- GPU Name & Driver Version
- GPU Utilization %
- Encoder Utilization %
- VRAM Usage
- Temperature
- Power Draw
- Active Encoder Sessions

### Performance Comparison

| Metric | CPU (libx264) | GPU (NVENC) |
|--------|---------------|-------------|
| CPU Usage | 80-100% | 5-15% |
| Encoding Speed | ~1x realtime | ~5-10x realtime |
| Latency | Higher | Lower |
| Quality at bitrate | Slightly better | Good |

---

## GPU Acceleration (Intel VA-API)

For Intel CPUs with integrated graphics, use the VA-API accelerated image.

### Requirements

1. **Intel CPU with iGPU** (4th gen Core or newer recommended)
2. **VA-API drivers** installed on host (usually automatic on Linux)
3. Access to `/dev/dri` device

### Docker Run with Intel VA-API

```bash
# Single tuner
docker run -d \
  --name dvr-tuner-intel \
  --device /dev/dri:/dev/dri \
  -p 7070:7070 \
  -p 6080:6080 \
  -v ./dvr-data:/data \
  -e TZ=America/New_York \
  sunnyside1/directvtuner:intel-vaapi

# Multi-tuner (3 tuners)
docker run -d \
  --name dvr-tuner-intel \
  --device /dev/dri:/dev/dri \
  -p 7070:7070 \
  -p 6080:6080 \
  -p 6081:6081 \
  -p 6082:6082 \
  -v ./dvr-data:/data \
  -e TZ=America/New_York \
  -e DVR_NUM_TUNERS=3 \
  sunnyside1/directvtuner:intel-vaapi
```

**Multi-tuner login:**
- Tuner 0: `http://YOUR_IP:6080`
- Tuner 1: `http://YOUR_IP:6081`
- Tuner 2: `http://YOUR_IP:6082`

**Optional:** Add `--privileged` flag to enable GPU utilization monitoring in the web UI (uses `intel_gpu_top`). Without it, VA-API encoding still works fine.

### Docker Compose with Intel VA-API

Use the provided `docker-compose.intel-multi.yml`:

```bash
docker-compose -f docker-compose.intel-multi.yml up -d
```

### Intel GPU Monitoring

The web GUI shows Intel GPU stats:
- GPU Name & Driver Version
- VA-API Support Status
- Video Engine Utilization (when streaming)
- Render Device Path

**Note:** `--privileged` flag is optional - only needed for `intel_gpu_top` GPU utilization monitoring in the web UI. VA-API encoding works without it.

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
/docker
├── Dockerfile                       # CPU-only base image
├── Dockerfile.nvidia                # NVIDIA NVENC image
├── Dockerfile.intel                 # Intel VA-API image
├── docker-compose.yml               # Basic single-tuner
├── docker-compose.nvidia-multi.yml  # NVIDIA multi-tuner
├── docker-compose.intel-multi.yml   # Intel VA-API multi-tuner
├── supervisord.conf
├── start-*.sh                       # Startup scripts
└── app/
    ├── stream-proxy.js              # Main server
    ├── directv-epg.js               # EPG service with auto-refresh
    ├── cinemaos-db-manager.js       # Movie database with auto-refresh
    ├── cineby-tv-manager.js         # TV show database with auto-refresh
    ├── tuner-manager.js             # DirecTV tuner management
    ├── gpu-monitor.js               # GPU detection & monitoring
    ├── ffmpeg-capture.js            # FFmpeg capture with HW accel
    ├── config.js                    # Configuration
    ├── channels.js                  # Channel definitions
    ├── providers/
    │   ├── base-provider.js         # Base provider class
    │   ├── cinemaos/                # CinemaOS provider (direct API)
    │   └── cineby/                  # Cineby provider
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

## Low Resource Mode (NAS / Synology / Weak Hardware)

If you're experiencing high CPU usage, memory issues, or crashes on NAS devices or lower-powered hardware, use these environment variables to reduce resource usage:

### Environment Variables

| Variable | Effect |
|----------|--------|
| `DVR_LOW_RESOURCE_CHROME=true` | Reduces Chrome memory usage (~30-40% less RAM) |
| `DVR_LOW_RESOURCE_FFMPEG=true` | Faster encoding, lower CPU (~20-30% less CPU) |

You can use one or both depending on your needs.

### What Each Mode Does

**DVR_LOW_RESOURCE_CHROME=true:**
- Disables extensions, plugins, and unused Chrome features
- Reduces JavaScript memory allocation
- Uses 1280x720 window instead of 1920x1080
- Disables background processes

**DVR_LOW_RESOURCE_FFMPEG=true:**
- Uses `superfast` preset instead of `veryfast`
- Reduces video to 720p @ 2Mbps (vs 1080p @ 4Mbps)
- Disables B-frames and reduces reference frames
- Lower audio bitrate (96k vs 128k)

### Example: Full Low Resource Mode

```bash
docker run -d \
  --name dvr-tuner \
  -p 7070:7070 \
  -p 6080:6080 \
  -v ./dvr-data:/data \
  -e DVR_LOW_RESOURCE_CHROME=true \
  -e DVR_LOW_RESOURCE_FFMPEG=true \
  -e DVR_NUM_TUNERS=1 \
  --memory=2g \
  sunnyside1/directvtuner:latest
```

### Additional Tips for NAS Users

- **Use single tuner**: Set `DVR_NUM_TUNERS=1` (each tuner uses ~500MB-1GB RAM)
- **Limit Docker memory**: Add `--memory=2g` to prevent runaway usage
- **Use GPU acceleration if available**: Intel VA-API or NVIDIA significantly reduces CPU
- **Reduce shm-size**: Add `--shm-size=512m` for single tuner

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

## ☕ Support

If you find this project useful and want to support its development, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/gszulc)

Your support helps me:
- Dedicate more time to adding new features
- Fix bugs quickly
- Maintain documentation
- Keep the project alive long-term

Thank you! 🙏

---

## License

MIT License
