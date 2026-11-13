#!/bin/sh
set -eu
IMG="${AGENT_IMAGE:-$(cat "$(dirname "$0")/agent-image")}"
DIR=/var/lib/fastmonkey/whatsapp-bridge
[ -f "$DIR/.image" ] && [ "$(cat "$DIR/.image")" = "$IMG" ] && exit 0
NEW="$DIR.new"
rm -rf "$NEW" && mkdir -p "$(dirname "$DIR")"
C=$(docker create "$IMG")
docker cp "$C:/opt/hermes/scripts/whatsapp-bridge" "$NEW" >/dev/null || { docker rm "$C" >/dev/null; exit 1; }
docker rm "$C" >/dev/null
(cd "$NEW" && npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null)
node -e 'const c=require("crypto"),f=require("fs"),d=process.argv[1];f.writeFileSync(d+"/node_modules/.hermes-pkg-hash",c.createHash("sha256").update(f.readFileSync(d+"/package.json")).digest("hex").slice(0,16))' "$NEW"
printf '%s\n' "$IMG" > "$NEW/.image"
chown -R root:root "$NEW" && chmod -R go-w,a+rX "$NEW"
rm -rf "$DIR" && mv "$NEW" "$DIR"
echo "whatsapp bridge: ready for $IMG"
