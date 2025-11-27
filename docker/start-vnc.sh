#!/bin/bash
# Wait for Xvfb to be ready
sleep 2

# Start x11vnc
exec x11vnc -display :1 -forever -shared -rfbport 5901 -nopw
