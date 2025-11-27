#!/bin/bash
# Wait for VNC to be ready
sleep 4

# Start noVNC
exec /opt/novnc/utils/novnc_proxy --vnc localhost:5901 --listen 6080
