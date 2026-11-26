#!/bin/sh
set -eu
J=/opt/openhut
mkdir -p /data/app /data/log /data/caddy /data/update
chown -R openhut:openhut /data/app /data/caddy /data/update; chmod 0700 /data/app /data/caddy; chmod 0755 /data/update
touch /data/install.lock
[ -s /data/here.token ] || (umask 077; printf 'ohj_%s\n' "$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')" > /data/here.token)
TOKEN=$(cat /data/here.token)
export OPENHUT_HERE_TOKEN_SHA256="$(printf '%s' "$TOKEN" | sha256sum | cut -c1-64)"
supervise() { log=$1; shift; while :; do "$@" >> "$log" 2>&1; sleep 2; done; }
runtime() {
  i=0; until curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 300 ] && return 1; sleep 1; done
  docker container inspect openhut-runtime >/dev/null 2>&1 && return 0
  R=$(cat $J/RUNTIME_IMAGE)
  if [ -d /data/agents ]; then
    c=$(mktemp -d); echo '{}' > "$c/config.json"; docker --config "$c" pull -q "$R" >/dev/null; rm -rf "$c"
    docker run --rm -v openhut-data:/old -v openhut-runtime-data:/data --entrypoint sh "$R" -c 'mkdir -p /data && cp -a /old/agents /old/agent-conf /data/ 2>/dev/null; true'
    rm -rf /data/agents /data/agent-conf
    docker volume rm openhut >/dev/null 2>&1 || true
  fi
  RUNTIME_IMAGE=$R OPENHUT_NETWORK=openhut OPENHUT_NAME=openhut-runtime sh $J/install/install.sh join http://openhut:8787 "$TOKEN"
}
runtime >> /data/log/runtime-install.log 2>&1 &
caddy() {
  i=0; until [ -s /data/app/Caddyfile ]; do i=$((i+1)); [ $i -gt 600 ] && return 1; sleep 0.2; done
  XDG_DATA_HOME=/data/caddy XDG_CONFIG_HOME=/data/caddy supervise /data/log/caddy.log su-exec openhut /usr/local/bin/caddy run --config /data/app/Caddyfile --adapter caddyfile --watch
}
[ -n "${OPENHUT_PROXY:-}" ] || caddy &
cd $J
umask 077
exec su-exec openhut node $J/packages/runtime/src/server/app.ts
