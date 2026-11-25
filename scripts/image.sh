#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
NAME="${1:?image.sh <image name> [docker buildx build flags]; BUILD names the build, OUT (dist) gets install.sh}"
shift
OUT="${OUT:-dist}"
if [ -z "${BUILD:-}" ]; then
  [ "$(git rev-parse --is-shallow-repository)" = false ] || { echo "image.sh needs the full git history to number the build (fetch-depth: 0), or BUILD" >&2; exit 1; }
  BUILD="$(sed -n 's/^  "version": "\([0-9]*\.[0-9]*\)\..*/\1/p' packages/runtime/package.json).$((100 + $(git rev-list --count HEAD -- install packages/runtime packages/common vendor)))"
fi
mkdir -p "$OUT"
docker buildx build -f install/Dockerfile --build-arg AGENT_IMAGE="$(cat install/agent-image)" --build-arg BUILD="$BUILD" --metadata-file "$OUT/image.json" -t "$NAME" "$@" .
DIGEST="$(sed -n 's/.*"containerimage.digest": *"\(sha256:[0-9a-f]*\)".*/\1/p' "$OUT/image.json")"
[ -n "$DIGEST" ] || { echo "image.sh: the build didn't report a digest" >&2; exit 1; }
REF="${NAME%:*}@$DIGEST"
sed -e "s|@OPENHUT_IMAGE@|$REF|" -e "s|@OPENHUT_BUILD@|$BUILD|" install/install.sh > "$OUT/install.sh"
echo "$OUT/install.sh pins $REF (build $BUILD)"
