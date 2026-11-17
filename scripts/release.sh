#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
BASE="${BASE:-https://openhut.dev}"
if [ -z "${BUILD:-}" ]; then
  [ "$(git rev-parse --is-shallow-repository)" = false ] || { echo "release.sh needs the full git history to number the release (fetch-depth: 0)." >&2; exit 1; }
  BUILD="$(sed -n 's/^  "version": "\([0-9]*\.[0-9]*\)\..*/\1/p' packages/runtime/package.json).$(git rev-list --count HEAD)"
fi
cleanup() { rm -f BUILD; [ ! -f install/agent-image.keep ] || mv install/agent-image.keep install/agent-image; }
trap cleanup EXIT
if [ -n "${PIN:-}" ]; then cp install/agent-image install/agent-image.keep; printf '%s\n' "$PIN" > install/agent-image; fi
rm -rf dist && mkdir dist
printf '%s\n' "$BUILD" > BUILD
if tar --version 2>/dev/null | grep -q 'GNU tar'; then ROOT='--owner=0 --group=0 --numeric-owner'; else ROOT='--uid 0 --gid 0 --uname root --gname root --no-mac-metadata'; fi
COPYFILE_DISABLE=1 tar $ROOT --no-xattrs \
  --exclude node_modules --exclude .turbo --exclude agent-image.keep \
  -czf dist/openhut.tgz BUILD package.json package-lock.json install vendor \
  packages/runtime/package.json packages/runtime/src packages/runtime/test/agentd packages/common \
  packages/desktop/package.json packages/e2e/package.json packages/site/package.json packages/docs/package.json
SUM=$(shasum -a 256 dist/openhut.tgz | cut -d' ' -f1)
sed -e "s|https://openhut.dev|$BASE|g" -e "s|@OPENHUT_SHA256@|$SUM|" -e "s|@OPENHUT_BUILD@|$BUILD|" install/install.sh > dist/install.sh
echo "dist/: build $BUILD, install.sh (OPENHUT_URL=$BASE), openhut.tgz $(du -h dist/openhut.tgz | cut -f1) sha256 $SUM"
