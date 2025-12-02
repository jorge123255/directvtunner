#!/bin/bash
# Wait for Xvfb and PulseAudio to be ready
sleep 5

# Clean up stale Chrome lock files (prevents "profile in use" errors after container restart)
CHROME_PROFILE="/data/chrome-profile"
if [ -d "$CHROME_PROFILE" ]; then
    echo "Cleaning up Chrome lock files..."
    rm -f "$CHROME_PROFILE/SingletonLock" \
          "$CHROME_PROFILE/SingletonCookie" \
          "$CHROME_PROFILE/SingletonSocket" 2>/dev/null
    echo "Chrome lock files cleaned"
fi

export DISPLAY=:1
export PULSE_SERVER=unix:/run/pulse/native

# Configure Chrome to use the virtual PulseAudio sink
export PULSE_SINK=virtual_speaker

# Start Chrome with remote debugging enabled in kiosk mode (hides URL bar)
exec google-chrome-stable \
    --remote-debugging-port=9222 \
    --remote-debugging-address=0.0.0.0 \
    --user-data-dir=/data/chrome-profile \
    --no-first-run \
    --no-default-browser-check \
    --disable-background-networking \
    --disable-sync \
    --disable-translate \
    --disable-gpu \
    --window-size=1920,1080 \
    --window-position=0,0 \
    --kiosk \
    --autoplay-policy=no-user-gesture-required \
    --disable-dev-shm-usage \
    --no-sandbox \
    --alsa-output-device=pulse \
    "https://stream.directv.com"
