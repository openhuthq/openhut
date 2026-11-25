#!/bin/sh
# C1. `openhut-boot.sh join` (root, before each start): moves the env the Cloud wrote to /home/user/.openhut/env into
# /etc/openhut/env (0600, the openhut user's), keeping only the names below, and deletes the original.
# `openhut-boot.sh` (the openhut user): boot.mjs starts the current pack, checks updates in the background, falls back after 60 s.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
if [ "${1:-}" = join ]; then
  FROM=${OPENHUT_JOIN_FILE:-/home/user/.openhut/env} TO=${OPENHUT_ENV_FILE:-/etc/openhut/env}
  [ -f "$FROM" ] || exit 0
  install -d -o openhut -g openhut -m 700 "$(dirname "$TO")"
  ( umask 077; grep -E '^(OPENHUT_JOIN|OPENHUT_API_URL|OPENHUT_WEB_URL)=[A-Za-z0-9_.:/@-]*$' "$FROM" > "$TO.tmp" || true )
  chown openhut:openhut "$TO.tmp" && mv "$TO.tmp" "$TO"
  rm -f "$FROM"
  exit 0
fi
exec node "$HERE/boot.mjs"
