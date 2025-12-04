#!/bin/bash
# Sync Chrome profile from tuner 0 to all other tuners
# This copies the login session/cookies so users only need to log in once
#
# Usage: sync-chrome-profiles.sh [--restart]
#   --restart: Also restart Chrome instances after syncing (recommended)

NUM_TUNERS=${DVR_NUM_TUNERS:-1}
SOURCE_PROFILE="/data/chrome-profile-0"
RESTART_CHROME=false

# Parse arguments
if [ "$1" = "--restart" ]; then
    RESTART_CHROME=true
fi

echo "========================================"
echo "Chrome Profile Sync"
echo "========================================"

# Check if source profile exists and has login data
if [ ! -d "$SOURCE_PROFILE" ]; then
    echo "ERROR: Source profile $SOURCE_PROFILE does not exist"
    echo "Please log in to tuner 0 first (via noVNC on port 6080)"
    exit 1
fi

# Check for login indicators (cookies, local storage)
if [ ! -f "$SOURCE_PROFILE/Default/Cookies" ] && [ ! -d "$SOURCE_PROFILE/Default/Local Storage" ]; then
    echo "WARNING: Source profile may not have login data yet"
    echo "Make sure you've logged into DirecTV on tuner 0 first"
fi

if [ "$NUM_TUNERS" -le 1 ]; then
    echo "Only 1 tuner configured, nothing to sync"
    exit 0
fi

echo "Syncing profile from tuner 0 to tuners 1-$((NUM_TUNERS - 1))..."

# Stop Chrome instances for tuners 1+ before copying (to avoid corruption)
echo "Stopping Chrome instances for tuners 1+..."
for i in $(seq 1 $((NUM_TUNERS - 1))); do
    DEBUG_PORT=$((9222 + i))
    # Find and kill Chrome on this debug port
    pkill -f "remote-debugging-port=${DEBUG_PORT}" 2>/dev/null || true
done

# Give Chrome time to fully stop
sleep 2

# Copy ONLY auth-related files (not the whole profile) to each tuner
# This preserves each tuner's independent session/tab state
AUTH_FILES="Cookies Cookies-journal Login\ Data Login\ Data-journal Web\ Data Web\ Data-journal"
AUTH_DIRS="Local\ Storage Session\ Storage IndexedDB"

for i in $(seq 1 $((NUM_TUNERS - 1))); do
    TARGET_PROFILE="/data/chrome-profile-${i}"

    echo "Copying auth files to tuner $i..."

    # Create target profile and Default directory if they don't exist
    mkdir -p "$TARGET_PROFILE/Default"

    # Copy auth files
    for file in Cookies Cookies-journal "Login Data" "Login Data-journal" "Web Data" "Web Data-journal"; do
        if [ -f "$SOURCE_PROFILE/Default/$file" ]; then
            cp "$SOURCE_PROFILE/Default/$file" "$TARGET_PROFILE/Default/" 2>/dev/null || true
        fi
    done

    # Copy auth directories
    for dir in "Local Storage" "Session Storage" "IndexedDB"; do
        if [ -d "$SOURCE_PROFILE/Default/$dir" ]; then
            rm -rf "$TARGET_PROFILE/Default/$dir" 2>/dev/null
            cp -r "$SOURCE_PROFILE/Default/$dir" "$TARGET_PROFILE/Default/" 2>/dev/null || true
        fi
    done

    # Remove lock files that would prevent Chrome from starting
    rm -f "$TARGET_PROFILE/SingletonLock" \
          "$TARGET_PROFILE/SingletonCookie" \
          "$TARGET_PROFILE/SingletonSocket" 2>/dev/null

    echo "  -> Copied auth files to $TARGET_PROFILE"
done

echo ""
echo "Profile sync complete!"

# Restart Chrome instances if requested
if [ "$RESTART_CHROME" = true ]; then
    echo ""
    echo "Restarting Chrome instances..."

    BASE_DEBUG_PORT=${CHROME_DEBUG_PORT:-9222}
    LOW_RESOURCE_CHROME=${DVR_LOW_RESOURCE_CHROME:-false}

    # Build Chrome flags
    CHROME_FLAGS=(
        "--no-first-run"
        "--no-default-browser-check"
        "--disable-background-networking"
        "--disable-sync"
        "--disable-translate"
        "--disable-gpu"
        "--window-position=0,0"
        "--kiosk"
        "--autoplay-policy=no-user-gesture-required"
        "--disable-dev-shm-usage"
        "--no-sandbox"
        "--alsa-output-device=pulse"
    )

    if [ "$LOW_RESOURCE_CHROME" = "true" ]; then
        CHROME_FLAGS+=(
            "--disable-extensions"
            "--disable-plugins"
            "--disable-software-rasterizer"
            "--disable-features=TranslateUI,BlinkGenPropertyTrees,AudioServiceOutOfProcess"
            "--disable-component-update"
            "--disable-background-timer-throttling"
            "--disable-backgrounding-occluded-windows"
            "--disable-renderer-backgrounding"
            "--disable-hang-monitor"
            "--disable-ipc-flooding-protection"
            "--memory-pressure-off"
            "--js-flags=--max-old-space-size=256"
            "--window-size=1280,720"
        )
    else
        CHROME_FLAGS+=(
            "--window-size=1920,1080"
        )
    fi

    for i in $(seq 1 $((NUM_TUNERS - 1))); do
        DISPLAY_NUM=$((i + 1))
        DEBUG_PORT=$((BASE_DEBUG_PORT + i))
        PROFILE_DIR="/data/chrome-profile-${i}"
        AUDIO_SINK="virtual_speaker_${i}"

        echo "Starting Chrome for tuner $i on display :${DISPLAY_NUM}..."

        DISPLAY=:${DISPLAY_NUM} \
        PULSE_SERVER=unix:/run/pulse/native \
        PULSE_SINK=${AUDIO_SINK} \
        google-chrome-stable \
            --remote-debugging-port=${DEBUG_PORT} \
            --remote-debugging-address=0.0.0.0 \
            --user-data-dir=${PROFILE_DIR} \
            "${CHROME_FLAGS[@]}" \
            "https://stream.directv.com" &
    done

    echo ""
    echo "Chrome instances restarted. All tuners should now be logged in!"
else
    echo ""
    echo "NOTE: Chrome instances were stopped for tuners 1+"
    echo "Run with --restart flag to restart them, or restart the container"
    echo ""
    echo "  sync-chrome-profiles.sh --restart"
fi

echo ""
echo "========================================"
