#!/bin/bash
# Wait for Chrome to be ready
sleep 10

cd /app
export DISPLAY=:1
export DVR_NUM_TUNERS=1
export DVR_HLS_DIR=/data/streams

exec node stream-proxy.js
