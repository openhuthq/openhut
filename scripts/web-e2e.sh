#!/usr/bin/env bash
set -euo pipefail
OUT=${OUT:-$(mktemp -d)}
DATA=$(mktemp -d)
mkdir -p "$OUT"
trap 'kill "$dev" 2>/dev/null || true; rm -rf "$DATA" 2>/dev/null || true' EXIT
wait_for() { for _ in $(seq 120); do curl -s -o /dev/null "$1" && return; sleep 1; done; echo "never came up: $1"; exit 1; }

OPENHUT_DATA=$DATA node scripts/dev.ts > "$OUT/dev.log" 2>&1 & dev=$!
wait_for http://127.0.0.1:8797/health
wait_for http://localhost:5173/

start=$(date +%s)
OUT=$OUT WEB=http://localhost:5173/ node scripts/web-e2e.mjs
echo "browser run: $(( $(date +%s) - start ))s; evidence in $OUT"
