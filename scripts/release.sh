#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
BASE="${BASE:-https://fastmonkey.dev}"
BUILD="${BUILD:-$(date -u +%Y%m%d%H%M%S)}"
cleanup() { rm -f BUILD; [ ! -f install/agent-image.keep ] || mv install/agent-image.keep install/agent-image; }
trap cleanup EXIT
if [ -n "${PIN:-}" ]; then cp install/agent-image install/agent-image.keep; printf '%s\n' "$PIN" > install/agent-image; fi
rm -rf dist && mkdir dist
npm -w @fastmonkey/web run build >/dev/null
printf '%s\n' "$BUILD" > BUILD
if tar --version 2>/dev/null | grep -q 'GNU tar'; then ROOT='--owner=0 --group=0 --numeric-owner'; else ROOT='--uid 0 --gid 0 --uname root --gname root --no-mac-metadata'; fi
COPYFILE_DISABLE=1 tar $ROOT --no-xattrs \
  --exclude node_modules --exclude .turbo --exclude agent-image.keep \
  -czf dist/fastmonkey.tgz BUILD package.json package-lock.json install vendor \
  packages/app/package.json packages/app/src packages/common packages/agentd \
  packages/web/package.json packages/web/dist packages/e2e/package.json packages/site/package.json
SUM=$(shasum -a 256 dist/fastmonkey.tgz | cut -d' ' -f1)
sed -e "s|https://fastmonkey.dev|$BASE|g" -e "s|@FASTMONKEY_SHA256@|$SUM|" install/install.sh > dist/install.sh
echo "dist/: build $BUILD, install.sh (FASTMONKEY_URL=$BASE), fastmonkey.tgz $(du -h dist/fastmonkey.tgz | cut -f1) sha256 $SUM"
