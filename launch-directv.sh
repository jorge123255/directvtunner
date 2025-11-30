#!/bin/bash
# Launch DirecTV player using Chrome with remote debugging
# This bypasses anti-bot detection by using real Chrome
#
# Usage: ./launch-directv.sh [channel-url]
# Example: ./launch-directv.sh "https://stream.directv.com/watch/ESPN"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROME_PROFILE="$SCRIPT_DIR/chrome-debug-profile"
CHANNEL_URL="${1:-}"

# Check if Chrome is already running with remote debugging
if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
    echo "[launch-directv] Chrome already running on port 9222"
else
    # Kill any stale Chrome debug instances
    pkill -f "remote-debugging-port=9222" 2>/dev/null
    sleep 1

    echo "[launch-directv] Starting Chrome with remote debugging..."
    echo "[launch-directv] Profile directory: $CHROME_PROFILE"

    # Start Chrome in background with remote debugging
    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
        --remote-debugging-port=9222 \
        --user-data-dir="$CHROME_PROFILE" \
        --no-first-run \
        --no-default-browser-check \
        2>/dev/null &

    CHROME_PID=$!
    echo "[launch-directv] Chrome started with PID: $CHROME_PID"

    # Wait for Chrome to be ready
    sleep 3
fi

echo "[launch-directv] Connecting to Chrome..."

# Run the connection script with optional channel URL
cd "$SCRIPT_DIR"
if [ -n "$CHANNEL_URL" ]; then
    echo "[launch-directv] Channel URL: $CHANNEL_URL"
    node connect-existing-chrome.js "$CHANNEL_URL"
else
    node connect-existing-chrome.js
fi
