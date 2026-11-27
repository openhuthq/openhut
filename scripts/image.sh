#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
REPO="${1:?image.sh <repository, like ghcr.io/openhuthq> <tags> [docker buildx build flags]; BUILD names the build, OUT (dist) gets install.sh; RUNTIME_IMAGE or MAIN_IMAGE uses that image instead of building it; ONLY=runtime or ONLY=main stops after that image and prints it}"
TAGS="${2?image.sh <repository> <tags, or empty to push by digest only>}"
shift 2
OUT="${OUT:-dist}"
if [ -z "${BUILD:-}" ]; then
  [ "$(git rev-parse --is-shallow-repository)" = false ] || { echo "image.sh needs the full git history to number the build (fetch-depth: 0), or BUILD" >&2; exit 1; }
  BUILD="$(sed -n 's/^  "version": "\([0-9]*\.[0-9]*\)\..*/\1/p' packages/runtime/package.json).$((100 + $(git rev-list --count HEAD -- install packages/runtime packages/common packages/app vendor)))"
fi
mkdir -p "$OUT"
build() { # <image> <target> [flags]: builds and pushes, prints <image>@<digest>
  name=$1 target=$2; shift 2
  tags=; for tag in $TAGS; do tags="$tags -t $REPO/$name:${tag#v}"; done
  docker buildx build -f install/Dockerfile --target "$target" --build-arg AGENT_IMAGE="$(cat install/agent-image)" --build-arg BUILD="$BUILD" \
    --metadata-file "$OUT/$name.json" $tags "$@" . >&2
  digest="$(sed -n 's/.*"containerimage.digest": *"\(sha256:[0-9a-f]*\)".*/\1/p' "$OUT/$name.json")"
  [ -n "$digest" ] || { echo "image.sh: the $name build didn't report a digest" >&2; exit 1; }
  echo "$REPO/$name@$digest"
}
RUNTIME="${RUNTIME_IMAGE:-$(build openhut-runtime runtime "$@")}"
[ "${ONLY:-}" != runtime ] || { echo "$RUNTIME"; exit; }
MAIN="${MAIN_IMAGE:-$(build openhut main --build-arg RUNTIME_IMAGE="$RUNTIME" "$@")}"
[ "${ONLY:-}" != main ] || { echo "$MAIN"; exit; }
sed -e "s|@OPENHUT_IMAGE@|$MAIN|" -e "s|@OPENHUT_RUNTIME_IMAGE@|$RUNTIME|" -e "s|@OPENHUT_BUILD@|$BUILD|" install/install.sh > "$OUT/install.sh"
echo "$OUT/install.sh pins $MAIN and $RUNTIME (build $BUILD)"
