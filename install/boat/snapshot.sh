#!/bin/sh
# C1: the base Boat snapshot. Run once as root on a fresh Boat sandbox (Ubuntu 24.04) from a checkout of this repo, then save the
# sandbox as a snapshot that the Cloud creates every Cloud computer from:
#   sudo sh install/boat/snapshot.sh && boat snapshot save <sandbox> openhut-cloud-<yyyymmdd>
# Rebuilt only when this base changes: the OS packages, Node, PGlite (the node_modules the app pack expects, SHELL_API in
# packages/desktop/src/packs.mjs), the openhut user and openhut-boot. The runtime itself comes as signed packs at the first boot.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NODE=24.22.2 NODE_SHA256=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75 # nodejs.org/dist/v24.22.2/SHASUMS256.txt

export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -y -q --no-install-recommends ca-certificates curl xz-utils tar
if [ "$(node --version 2>/dev/null)" != "v$NODE" ]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-x64.tar.xz" -o /tmp/node.tar.xz
  echo "$NODE_SHA256  /tmp/node.tar.xz" | sha256sum -c -
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm /tmp/node.tar.xz
fi
PGLITE=$(node -p "require('$ROOT/package-lock.json').packages['node_modules/@electric-sql/pglite'].version")

id openhut >/dev/null 2>&1 || useradd --system --home-dir /var/lib/openhut --create-home --shell /usr/sbin/nologin openhut
install -d -o openhut -g openhut -m 700 /var/lib/openhut /etc/openhut
install -d -m 755 /opt/openhut/boot /opt/openhut/backend
install -m 755 "$ROOT/install/boat/openhut-boot.sh" /opt/openhut/boot/
install -m 644 "$ROOT/install/boat/boot.mjs" "$ROOT/packages/desktop/src/packs.mjs" "$ROOT/packages/desktop/src/release-key.mjs" /opt/openhut/boot/
printf '{"type":"module","private":true}\n' > /opt/openhut/boot/package.json
[ -d "/opt/openhut/backend/node_modules/@electric-sql/pglite" ] || npm install --prefix /opt/openhut/backend --no-save --no-audit --no-fund "@electric-sql/pglite@$PGLITE"
install -m 644 "$ROOT/install/boat/openhut.service" /etc/systemd/system/openhut.service
systemctl daemon-reload && systemctl enable openhut.service
echo "openhut: base ready (Node $NODE, PGlite $PGLITE). Start it with: systemctl start openhut"
