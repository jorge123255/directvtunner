#!/bin/bash
# Start PulseAudio in system mode for capturing Chrome audio

# Clean up any stale PulseAudio files
rm -rf /tmp/pulse-* /run/pulse 2>/dev/null

# Create runtime directory
mkdir -p /run/pulse
chmod 755 /run/pulse

# Start PulseAudio with a virtual null sink for capturing audio
exec pulseaudio \
    --system \
    --disallow-exit \
    --disallow-module-loading=0 \
    --load="module-null-sink sink_name=virtual_speaker sink_properties=device.description=VirtualSpeaker" \
    --load="module-native-protocol-unix auth-anonymous=1" \
    --log-level=notice
