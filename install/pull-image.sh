#!/bin/sh
set -eu
command -v flock >/dev/null 2>&1 && { exec 8>/run/openhut-pull.lock; flock 8; }
IMG="${AGENT_IMAGE:-$(cat "$(dirname "$0")/agent-image")}"
docker image inspect "$IMG" >/dev/null 2>&1 || docker pull "$IMG"
"$(dirname "$0")/whatsapp-bridge.sh" || echo "whatsapp bridge: not prepared; WhatsApp stays off until the next start" >&2
