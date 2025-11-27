# DirecTV Stream Tuner

A Docker-based IPTV proxy that turns DirecTV Stream into an M3U playlist compatible with apps like TvMate, VLC, and other IPTV players.

## Features

- **Tuner Architecture**: Simulates traditional TV tuners - one Chrome instance per tuner
- **HLS Streaming**: Captures DirecTV video via FFmpeg and serves as HLS streams
- **M3U Playlist**: Generates M3U playlists compatible with IPTV apps
- **Auto Channel Switching**: Automatically switches channels when requested
- **Smart Video Detection**: Waits for video to be ready before starting capture
- **noVNC Access**: Built-in VNC viewer to see what Chrome is doing
- **348 Channels**: Extensive channel list with smart matching

## Quick Start

### Docker Hub

```bash
docker pull sunnyside1/directvtunner:latest
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
    image: sunnyside1/directvtunner:latest
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
    image: sunnyside1/directvtunner:latest
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
    image: sunnyside1/directvtunner:latest
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

### Option 4: Custom Bridge Network

For multi-container setups where containers need to communicate.

```yaml
version: '3.8'
services:
  dvr-tuner1:
    image: sunnyside1/directvtunner:latest
    container_name: dvr-tuner1
    ports:
      - "7070:7070"
      - "6080:6080"
      - "5900:5900"
      - "9222:9222"
    volumes:
      - ./chrome-profile:/data/chrome-profile
      - ./streams:/data/streams
    networks:
      - dvr_network
    restart: unless-stopped

networks:
  dvr_network:
    driver: bridge
```

---

## First-Time Setup

1. Start the container using one of the network configurations above
2. Access noVNC at `http://<IP>:6080`
3. Log into DirecTV Stream in the Chrome browser with **your own credentials**
4. The login session will be saved in the `chrome-profile` volume for future use

**Important:** The Docker image does NOT include any DirecTV credentials. Each user must log in with their own DirecTV Stream subscription.

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /playlist.m3u` | M3U playlist for IPTV apps |
| `GET /stream/:channelId` | Stream a specific channel |
| `GET /channels` | List all available channels |
| `GET /tuners` | Check tuner status |
| `GET /health` | Health check |

---

## Usage

### Add to VLC/TvMate

Add this URL as your M3U playlist:
```
http://<SERVER_IP>:7070/playlist.m3u
```

### Direct Stream

Open a specific channel:
```
http://<SERVER_IP>:7070/stream/cnn
http://<SERVER_IP>:7070/stream/espn
```

### Reduce VLC Latency

To reduce playback delay by 2-3 seconds:
- VLC Preferences → Input/Codecs → Network caching: `500` (default is 1000)
- Or use command line: `vlc --network-caching=500`

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
│                    Playwright Automation                     │
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

## Configuration

Edit `app/config.js` to customize:

- `numTuners`: Number of simultaneous streams (default: 1)
- `port`: HTTP server port (default: 7070)
- `resolution`: Video resolution (default: 1280x720)
- `videoBitrate`: Video bitrate (default: 3M)

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

---

## License

MIT License
