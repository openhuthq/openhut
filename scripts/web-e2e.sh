#!/usr/bin/env bash
# The browser run (R1): a fresh dev stack (local cloud, runtime, the Mac's App), the web App beside it, and
# packages/desktop/scripts/web-e2e.cjs signing a browser in through the Mac. CI's gate runs it; it works on a Mac too.
set -euo pipefail
OUT=${OUT:-$(mktemp -d)}
DATA=$(mktemp -d)
mkdir -p "$OUT"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true; rm -rf "$DATA"' EXIT
wait_for() { for _ in $(seq 120); do curl -s -o /dev/null "$1" && return; sleep 1; done; echo "never came up: $1"; exit 1; }

# The web App needs an origin the Cloud treats as its web, not as this computer (localhost gets the desktop last page).
WEB_ORIGINS=http://web.localhost:5190 OPENHUT_DATA=$DATA node scripts/dev.ts > "$OUT/dev.log" 2>&1 & pids+=($!)
wait_for http://127.0.0.1:8797/health
wait_for http://localhost:5173/
OPENHUT_WEB=1 OPENHUT_API_URL=http://127.0.0.1:8792 node node_modules/vite/bin/vite.js packages/app --port 5190 --strictPort > "$OUT/web.log" 2>&1 & pids+=($!)
wait_for http://localhost:5190/

run=(node_modules/.bin/electron packages/desktop/scripts/web-e2e.cjs)
[ "$(uname)" = Linux ] && run=(xvfb-run -a node_modules/.bin/electron --no-sandbox packages/desktop/scripts/web-e2e.cjs)
start=$(date +%s)
OUT=$OUT WEB=http://web.localhost:5190/ RUNTIME=http://127.0.0.1:8797 "${run[@]}"
echo "browser run: $(( $(date +%s) - start ))s; evidence in $OUT"
