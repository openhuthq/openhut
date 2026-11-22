#!/bin/sh
set -u
[ "$(id -u)" = 0 ] || { echo 'openhut: run as root: sudo sh /opt/openhut/install/uninstall.sh' >&2; exit 1; }
printf 'This deletes every agent and all OpenHut data. It cannot be undone. Type "uninstall" to go on: '
read -r answer || answer=
[ "$answer" = uninstall ] || { echo 'Nothing removed.'; exit 1; }

if [ -d /run/systemd/system ]; then
  systemctl disable --now openhut.service openhut-agentd.service 2>/dev/null
  systemctl disable openhut-firewall.service 2>/dev/null
  rm -f /etc/systemd/system/openhut*.service
  systemctl daemon-reload
fi
pkill -f /opt/openhut/install/supervise.sh 2>/dev/null
pkill -f '^node /opt/openhut/packages/.*agentd\.ts' 2>/dev/null
pkill -f '^node /opt/openhut/packages/.*/app\.ts' 2>/dev/null

if command -v docker >/dev/null 2>&1; then
  docker ps -aq --filter label=openhut.agent | xargs -r docker rm -f >/dev/null
  docker network ls -q --filter label=openhut.agent | xargs -r docker network rm >/dev/null
  [ ! -f /opt/openhut/install/agent-image ] || docker rmi "$(cat /opt/openhut/install/agent-image)" >/dev/null 2>&1
fi

iptables -D DOCKER-USER -s 10.200.0.0/16 -j AGENT 2>/dev/null
iptables -D INPUT -j AGENT-IN 2>/dev/null
iptables -F AGENT 2>/dev/null && iptables -X AGENT
iptables -F AGENT-IN 2>/dev/null && iptables -X AGENT-IN
ip rule del to 10.200.0.0/16 lookup main priority 5200 2>/dev/null
! grep -qx OPENHUT_ROUTE=tailnet /etc/openhut/env 2>/dev/null || ! command -v tailscale >/dev/null 2>&1 || tailscale serve --tcp=8788 off >/dev/null 2>&1

rm -rf /opt/openhut /opt/openhut.new /opt/openhut.old /opt/openhut.failed /run/openhut-install.lock /etc/openhut /data/app /data/app.before-update /data/app.before-update.env /data/agents /data/agent-conf \
  /etc/agentd /var/lib/openhut /var/cache/openhut /var/log/openhut /var/log/openhut-boot.log /run/openhut /run/agentd
rmdir /data 2>/dev/null
if command -v userdel >/dev/null 2>&1; then userdel openhut 2>/dev/null; else deluser openhut 2>/dev/null; delgroup openhut 2>/dev/null; fi
echo 'OpenHut is removed. Docker, gVisor and Node stay installed.'
