#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
: "${CONSOLE_URL:?Set CONSOLE_URL to the console that installs check, like https://console.jakebox.dev.}"
: "${CONSOLE_PUBLISH_KEY:?Set CONSOLE_PUBLISH_KEY to the publish key of the console.}"
[ -f dist/release.json ] || { echo "Run scripts/release.sh and deploy dist/ to get.jakebox.dev first." >&2; exit 1; }
printf 'authorization: Bearer %s\n' "$CONSOLE_PUBLISH_KEY" | curl -sS --fail-with-body -w '\n' -H @- -H 'content-type: application/json' \
  --data-binary @dist/release.json "${CONSOLE_URL%/}/api/releases"
