#!/bin/bash
# Start Xvfb virtual display
rm -f /tmp/.X1-lock
exec Xvfb :1 -screen 0 1920x1080x24
