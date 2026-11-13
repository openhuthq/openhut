#!/bin/sh
# Pulls the agent image if it isn't here yet: AGENT_IMAGE from /etc/jakebox/env when the operator set one,
# otherwise this release's pin (install/agent-image), so an upgrade that moves the pin reaches new agents.
set -eu
IMG="${AGENT_IMAGE:-$(cat "$(dirname "$0")/agent-image")}"
docker image inspect "$IMG" >/dev/null 2>&1 || docker pull -q "$IMG"
"$(dirname "$0")/whatsapp-bridge.sh" || echo "whatsapp bridge: not prepared; WhatsApp stays off until the next start" >&2
