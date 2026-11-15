#!/bin/sh
set -eu
IMG="${AGENT_IMAGE:-$(cat "$(dirname "$0")/agent-image")}"
docker image inspect "$IMG" >/dev/null 2>&1 || docker pull -q "$IMG"
"$(dirname "$0")/whatsapp-bridge.sh" || echo "whatsapp bridge: not prepared; WhatsApp stays off until the next start" >&2
