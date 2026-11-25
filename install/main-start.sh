#!/bin/sh
set -eu
J=/opt/openhut
mkdir -p /data/app /data/log
chown openhut:openhut /data/app; chmod 0700 /data/app
touch /data/install.lock /data/update.request; chmod 0666 /data/update.request
[ -s /data/here.token ] || (umask 077; printf 'ohj_%s\n' "$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')" > /data/here.token)
TOKEN=$(cat /data/here.token)
export OPENHUT_HERE_TOKEN_SHA256="$(printf '%s' "$TOKEN" | sha256sum | cut -c1-64)"
runtime() {
  i=0; until curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 300 ] && return 1; sleep 1; done
  docker container inspect openhut-runtime >/dev/null 2>&1 && return 0
  RUNTIME_IMAGE=$(cat $J/RUNTIME_IMAGE) OPENHUT_NETWORK=openhut OPENHUT_NAME=openhut-runtime sh $J/install/install.sh join http://openhut:8787 "$TOKEN"
}
runtime >> /data/log/runtime-install.log 2>&1 &
cd $J
umask 077
exec su-exec openhut node $J/packages/runtime/src/server/app.ts
