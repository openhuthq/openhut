#!/bin/sh
# Prepares Hermes's WhatsApp bridge once per agent image: its code from the image, its node_modules from npm, and the
# stamp Hermes checks so it never runs npm itself. Agents can't: the image has no npm, their root is read-only and
# their egress is HTTPS only. agentd mounts the result read-only into every agent. A failure leaves WhatsApp off, not JakeBox.
set -eu
IMG="${AGENT_IMAGE:-$(cat "$(dirname "$0")/agent-image")}"
DIR="${WHATSAPP_BRIDGE:-/var/lib/jakebox/whatsapp-bridge}"
[ -f "$DIR/.image" ] && [ "$(cat "$DIR/.image")" = "$IMG" ] && exit 0
NEW="$DIR.new"
rm -rf "$NEW" && mkdir -p "$(dirname "$DIR")"
C=$(docker create "$IMG")
docker cp "$C:/opt/hermes/scripts/whatsapp-bridge" "$NEW" >/dev/null; docker rm "$C" >/dev/null
# Pure JS on any libc: sharp (optional, image thumbnails) is left out, and no install scripts run as root.
(cd "$NEW" && npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null)
node -e 'const c=require("crypto"),f=require("fs"),d=process.argv[1];f.writeFileSync(d+"/node_modules/.hermes-pkg-hash",c.createHash("sha256").update(f.readFileSync(d+"/package.json")).digest("hex").slice(0,16))' "$NEW"
printf '%s\n' "$IMG" > "$NEW/.image"
chown -R root:root "$NEW" && chmod -R go-w,a+rX "$NEW"
rm -rf "$DIR" && mv "$NEW" "$DIR"
echo "whatsapp bridge: ready for $IMG"
