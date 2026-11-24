#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
case "${1:-}" in
  key) exec node scripts/release-key.ts key "${2:?release.sh key <new key file>}" ;;
  sign) dir="${2:?release.sh sign <release folder> [version] [release-key.ts flags]}"; shift 2; exec node scripts/release-key.ts sign "${RELEASE_KEY:?RELEASE_KEY must name the release key file}" "$dir" "$@" ;;
esac
BASE="${BASE:-https://openhut.dev}"
OUT="${OUT:-dist}"
if [ -z "${BUILD:-}" ]; then
  [ "$(git rev-parse --is-shallow-repository)" = false ] || { echo "release.sh needs the full git history to number the release (fetch-depth: 0)." >&2; exit 1; }
  BUILD="$(sed -n 's/^  "version": "\([0-9]*\.[0-9]*\)\..*/\1/p' packages/runtime/package.json).$((100 + $(git rev-list --count HEAD -- install packages/runtime packages/common packages/tunnel vendor)))"
fi
cleanup() { rm -f BUILD; [ ! -f install/agent-image.keep ] || mv install/agent-image.keep install/agent-image; }
trap cleanup EXIT
if [ -n "${PIN:-}" ]; then cp install/agent-image install/agent-image.keep; printf '%s\n' "$PIN" > install/agent-image; fi
rm -rf "$OUT" && mkdir -p "$OUT"
printf '%s\n' "$BUILD" > BUILD
if tar --version 2>/dev/null | grep -q 'GNU tar'; then ROOT='--owner=0 --group=0 --numeric-owner'; else ROOT='--uid 0 --gid 0 --uname root --gname root --no-mac-metadata'; fi
COPYFILE_DISABLE=1 tar $ROOT --no-xattrs \
  --exclude node_modules --exclude .turbo --exclude agent-image.keep \
  -czf "$OUT/openhut.tgz" BUILD package.json package-lock.json install vendor \
  packages/runtime/package.json packages/runtime/src packages/runtime/test/agentd packages/common \
  packages/app/package.json packages/desktop/package.json packages/desktop/src/release-key.mjs packages/e2e/package.json packages/docs/package.json packages/phone/package.json
MIN_APP=$(sed -n "s/^export const MIN_APP_VERSION = '\(.*\)'$/\1/p" packages/common/src/admin/admin.ts)
[ -n "$MIN_APP" ] || { echo "release.sh: no MIN_APP_VERSION in packages/common/src/admin/admin.ts" >&2; exit 1; }
SUM=$(shasum -a 256 "$OUT/openhut.tgz" | cut -d' ' -f1)
sed -e "/^OPENHUT_URL=/s|https://openhut.dev|$BASE|" -e "s|@OPENHUT_SHA256@|$SUM|" -e "s|@OPENHUT_BUILD@|$BUILD|" -e "s|@OPENHUT_TGZ@|${TGZ:-$BASE/openhut.tgz}|" -e "s|@OPENHUT_MIN_APP@|$MIN_APP|" -e "s|@OPENHUT_IMAGE@|${IMAGE:-@OPENHUT_IMAGE@}|" install/install.sh > "$OUT/install.sh"
echo "$OUT/: build $BUILD, install.sh (OPENHUT_URL=$BASE, image ${IMAGE:-not pinned yet}, tarball ${TGZ:-$BASE/openhut.tgz}), openhut.tgz $(du -h "$OUT/openhut.tgz" | cut -f1) sha256 $SUM"
[ -z "${RELEASE_KEY:-}" ] || node scripts/release-key.ts sign "$RELEASE_KEY" "$OUT" "$BUILD"
