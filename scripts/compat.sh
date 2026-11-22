#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
PREV="${1:?usage: scripts/compat.sh <previous release tag, like v0.1.1>}"
HERE=$(pwd)
WORK=$(mktemp -d)
OLD="$WORK/old"
trap 'kill $RUNTIME $AGENTD 2>/dev/null || true; git worktree remove --force "$OLD" 2>/dev/null || true; rm -rf "$WORK"' EXIT
RUNTIME= AGENTD=
DEV_KEY=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update('dev').digest('hex'))")
git worktree add --detach "$OLD" "$PREV" >/dev/null
(cd "$OLD" && npm ci --no-audit --no-fund --loglevel=error >/dev/null)

prev_version=${PREV#v}
for name in MIN_APP_VERSION MIN_RUNTIME_VERSION; do
  min=$(sed -n "s/^export const $name = '\(.*\)'$/\1/p" packages/common/src/admin/admin.ts)
  [ -z "$min" ] && continue
  [ "$(printf '%s\n%s\n' "$min" "$prev_version" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$min" ] ||
    { echo "compat: $name is $min, past the previous release $prev_version; an app or runtime one release behind couldn't talk to this one" >&2; exit 1; }
  echo "ok   $name $min is at or below the previous release $prev_version"
done

run() {
  data=$(mktemp -d "/tmp/oh-compat.XXXX")
  (cd "$1" && exec env OPENHUT_SANDBOX=memory AGENTD_DATA="$data/agentd" AGENTD_SOCK="$data/agentd.sock" node packages/runtime/src/agentd/agentd.ts) >"$WORK/agentd.log" 2>&1 &
  AGENTD=$!
  i=0; until [ -S "$data/agentd.sock" ]; do i=$((i+1)); [ $i -gt 120 ] && { cat "$WORK/agentd.log"; exit 1; }; sleep 0.5; done
  (cd "$1" && exec env PORT=8795 OPENHUT_GATEWAY_PORT=18095 OPENHUT_DATA="$data" AGENTD_SOCK="$data/agentd.sock" OPENHUT_MODEL=test OPENHUT_CLIENT_KEY_SHA256="$DEV_KEY" node packages/runtime/src/server/app.ts) >"$WORK/runtime.log" 2>&1 &
  RUNTIME=$!
  i=0; until curl -fs -o /dev/null -H 'authorization: Bearer dev' http://127.0.0.1:8795/api/me; do i=$((i+1)); [ $i -gt 120 ] && { cat "$WORK/runtime.log"; exit 1; }; sleep 0.5; done
  echo "--- the $2 client against the $3 runtime"
  status=0; node "$HERE/scripts/compat.ts" "$4" http://127.0.0.1:8795 || status=$?
  kill "$RUNTIME" "$AGENTD" 2>/dev/null || true; wait "$RUNTIME" "$AGENTD" 2>/dev/null || true; RUNTIME= AGENTD=
  rm -rf "$data"
  return $status
}
run "$OLD" new "$PREV" "$HERE"
run "$HERE" "$PREV" new "$OLD"
echo "compat: this release and $PREV work together both ways"
