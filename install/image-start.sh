#!/bin/sh
set -eu
J=/opt/openhut
LOG=/var/log/openhut
mkdir -p /data/log /data/app /data/agents /data/agent-conf /run/agentd-etc
chown openhut:openhut /data/app; chmod 0700 /data/app /data/agents /data/agent-conf
ln -sf /data/install.lock /run/openhut-install.lock
export AGENT_IMAGE="${AGENT_IMAGE:-$(cat /opt/openhut-agent/image)}" RESOLVER="${RESOLVER:-1.1.1.1}" OPENHUT_MODEL="${OPENHUT_MODEL:-claude}"
printf 'nameserver %s\n' "$RESOLVER" > /etc/agentd/resolv.conf
mark() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG/boot.log"; }
supervise() { log=$1; shift; while :; do "$@" >> "$log" 2>&1; sleep 2; done; }
pull() {
  docker image inspect "$AGENT_IMAGE" >/dev/null 2>&1 && return
  if [ "$(cat /opt/openhut-agent/image)" = "$AGENT_IMAGE" ]; then zstd -dc /opt/openhut-agent/agent.tar.zst | docker load -q; else docker pull "$AGENT_IMAGE"; fi
}
mark "boot"

"$J/install/agents-firewall.sh"
rm -f /var/run/docker.pid /var/run/docker/containerd/containerd.pid
dockerd-entrypoint.sh dockerd >> "$LOG/dockerd.log" 2>&1 &
i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 120 ] && { mark "dockerd failed"; exit 1; }; sleep 1; done
"$J/install/agents-firewall.sh"; mark "dockerd up, firewall applied"
if [ -n "$(ls -A /data/agents)" ]; then pull; else pull >> "$LOG/pull.log" 2>&1 & fi

supervise "$LOG/agentd.log" node "$J/packages/runtime/src/agentd/agentd.ts" &
i=0; until [ -S /run/agentd/agentd.sock ]; do i=$((i+1)); [ $i -gt 300 ] && { mark "agentd failed"; exit 1; }; sleep 0.2; done
( umask 077; cd "$J" && supervise "$LOG/app.log" su-exec openhut node "$J/packages/runtime/src/server/app.ts" ) &
i=0; until [ -s /data/app/Caddyfile ]; do i=$((i+1)); [ $i -gt 600 ] && { mark "no Caddyfile"; exit 1; }; sleep 0.2; done
mkdir -p /data/caddy && chown openhut:openhut /data/caddy && chmod 0700 /data/caddy
sysctl -qw net.ipv4.ip_unprivileged_port_start=80
( export XDG_DATA_HOME=/data/caddy XDG_CONFIG_HOME=/data/caddy; supervise "$LOG/caddy.log" su-exec openhut caddy run --config /data/app/Caddyfile --adapter caddyfile --watch ) &
mark "agentd, app and caddy started"
echo "openhut: up"
while :; do sleep 3600; done
