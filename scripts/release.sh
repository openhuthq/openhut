#!/bin/sh
# Builds what https://get.jakebox.dev serves: install.sh at "/" (with jakebox.tgz's sha256 written into it) and jakebox.tgz.
# BASE overrides the URL baked into install.sh.
set -eu
cd "$(dirname "$0")/.."
BASE="${BASE:-https://get.jakebox.dev}"
BUILD="${BUILD:-$(date -u +%Y%m%d%H%M%S)}"   # shown in /health, so an upgrade can be told apart from the release it replaced
# PIN: the e2e test's upgrade names the same image another way, to prove a new release's pin reaches agentd.
if [ -n "${PIN:-}" ]; then cp install/agent-image install/agent-image.keep; trap 'mv install/agent-image.keep install/agent-image' EXIT; printf '%s\n' "$PIN" > install/agent-image; fi
rm -rf dist && mkdir dist
npm -w @jakebox/web run build >/dev/null   # the dashboard ships built; servers never run Vite
printf '%s\n' "$BUILD" > BUILD
# Owned by root, no macOS metadata: the server extracts it as root and runs agentd and the firewall from it.
COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root --no-xattrs --no-mac-metadata \
  --exclude node_modules --exclude '*.test.ts' --exclude agent-image.keep \
  -czf dist/jakebox.tgz BUILD package.json package-lock.json install vendor \
  packages/app/package.json packages/app/src packages/common packages/agentd \
  packages/web/package.json packages/web/dist packages/e2e/package.json
rm BUILD
SUM=$(shasum -a 256 dist/jakebox.tgz | cut -d' ' -f1)
sed -e "s|https://get.jakebox.dev|$BASE|g" -e "s|@JAKEBOX_SHA256@|$SUM|" install/install.sh > dist/install.sh
echo "dist/: build $BUILD, install.sh (JAKEBOX_URL=$BASE), jakebox.tgz $(du -h dist/jakebox.tgz | cut -f1) sha256 $SUM"
