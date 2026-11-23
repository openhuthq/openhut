#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
DIR="${1:?image.sh <release folder> <image name> [docker buildx build flags]}"
NAME="${2:?image.sh <release folder> <image name> [docker buildx build flags]}"
shift 2
AGENT="$(tar -xzOf "$DIR/openhut.tgz" install/agent-image)"
docker buildx build -f install/Dockerfile --build-arg AGENT_IMAGE="$AGENT" --metadata-file "$DIR/image.json" -t "$NAME" "$@" "$DIR"
DIGEST="$(sed -n 's/.*"containerimage.digest": *"\(sha256:[0-9a-f]*\)".*/\1/p' "$DIR/image.json")"
[ -n "$DIGEST" ] || { echo "image.sh: the build didn't report a digest" >&2; exit 1; }
REF="${NAME%:*}@$DIGEST"
sed -i.bak "s|@OPENHUT_IMAGE@|$REF|" "$DIR/install.sh" && rm -f "$DIR/install.sh.bak"
echo "$DIR/install.sh pins $REF"
