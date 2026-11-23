#!/bin/sh
set -eu
command -v flock >/dev/null 2>&1 && { exec 8>/run/openhut-pull.lock; flock 8; }
IMG="${AGENT_IMAGE:-$(cat "$(dirname "$0")/agent-image")}"
BUNDLE=/opt/openhut-agent
if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  if [ "$(cat "$BUNDLE/image" 2>/dev/null)" = "$IMG" ]; then zstd -dc "$BUNDLE/agent.tar.zst" | docker load -q; else docker pull "$IMG"; fi
fi
"$(dirname "$0")/whatsapp-bridge.sh" || echo "whatsapp bridge: not prepared; WhatsApp stays off until the next start" >&2
