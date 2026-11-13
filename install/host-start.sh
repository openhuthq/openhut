#!/bin/sh
set -eu
J=/opt/jakebox
set -a; [ -f /etc/jakebox/env ] && . /etc/jakebox/env; set +a
export RESOLVER="${RESOLVER:-1.1.1.1}" JAKEBOX_MODEL="${JAKEBOX_MODEL:-claude}"
LOG=/var/log/jakebox
"$J/install/prepare.sh"
mark() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG/boot.log"; }
mark "boot"

"$J/install/agents-firewall.sh"; mark "firewall applied"
if ! docker info >/dev/null 2>&1; then
  rm -f /var/run/docker.pid /var/run/docker/containerd/containerd.pid
  mark "dockerd launching"
  if command -v dockerd-entrypoint.sh >/dev/null 2>&1; then dockerd-entrypoint.sh dockerd >> "$LOG/dockerd.log" 2>&1 &
  else dockerd >> "$LOG/dockerd.log" 2>&1 & fi
  i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 120 ] && { mark "dockerd failed"; exit 1; }; sleep 1; done
  mark "dockerd up"
fi
"$J/install/agents-firewall.sh"; mark "firewall reapplied"
"$J/install/pull-image.sh"

pkill -f "$J/install/supervise.sh" 2>/dev/null || true
pkill -f "^node $J/packages/agentd/src/agentd.ts" 2>/dev/null || true
pkill -f "^node $J/packages/app/src/app.ts" 2>/dev/null || true
sleep 1; rm -f /run/agentd/agentd.sock
RUNAS="runuser -u jakebox --"; command -v su-exec >/dev/null 2>&1 && RUNAS="su-exec jakebox"
export APP_GID="$(id -g jakebox)" SETUP_CODE="${SETUP_CODE:-}"
"$J/install/supervise.sh" "$LOG/agentd.log" node "$J/packages/agentd/src/agentd.ts" &
i=0; until [ -S /run/agentd/agentd.sock ]; do i=$((i+1)); [ $i -gt 300 ] && { mark "agentd failed"; exit 1; }; sleep 0.2; done
( umask 077; cd "$J" && exec "$J/install/supervise.sh" "$LOG/app.log" $RUNAS node "$J/packages/app/src/app.ts" ) &
mark "agentd and app started"
echo "jakebox: up"
[ $$ -eq 1 ] && while :; do sleep 3600; done
exit 0
