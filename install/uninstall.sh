#!/bin/sh
set -u
[ "$(id -u)" = 0 ] || { echo 'fastmonkey: run as root: sudo sh /opt/fastmonkey/install/uninstall.sh' >&2; exit 1; }
printf 'This deletes every agent and all Fast Monkey data. It cannot be undone. Type "uninstall" to go on: '
read -r answer || answer=
[ "$answer" = uninstall ] || { echo 'Nothing removed.'; exit 1; }

if [ -d /run/systemd/system ]; then
  systemctl disable --now fastmonkey.service fastmonkey-agentd.service 2>/dev/null
  systemctl disable fastmonkey-firewall.service 2>/dev/null
  rm -f /etc/systemd/system/fastmonkey*.service
  systemctl daemon-reload
fi
pkill -f /opt/fastmonkey/install/supervise.sh 2>/dev/null
pkill -f '^node /opt/fastmonkey/packages/agentd/src/agentd.ts' 2>/dev/null
pkill -f '^node /opt/fastmonkey/packages/app/src/app.ts' 2>/dev/null

if command -v docker >/dev/null 2>&1; then
  docker ps -aq --filter label=fastmonkey.agent | xargs -r docker rm -f >/dev/null
  docker network ls -q --filter label=fastmonkey.agent | xargs -r docker network rm >/dev/null
  [ ! -f /opt/fastmonkey/install/agent-image ] || docker rmi "$(cat /opt/fastmonkey/install/agent-image)" >/dev/null 2>&1
fi

iptables -D DOCKER-USER -s 10.200.0.0/16 -j AGENT 2>/dev/null
iptables -D INPUT -j AGENT-IN 2>/dev/null
iptables -F AGENT 2>/dev/null && iptables -X AGENT
iptables -F AGENT-IN 2>/dev/null && iptables -X AGENT-IN
ip rule del to 10.200.0.0/16 lookup main priority 5200 2>/dev/null

rm -rf /opt/fastmonkey /opt/fastmonkey.new /opt/fastmonkey.old /opt/fastmonkey.failed /run/fastmonkey-install.lock /etc/fastmonkey /data/app /data/agents /data/agent-conf \
  /etc/agentd /var/lib/fastmonkey /var/cache/fastmonkey /var/log/fastmonkey /var/log/fastmonkey-boot.log /run/fastmonkey /run/agentd
rmdir /data 2>/dev/null
if command -v userdel >/dev/null 2>&1; then userdel fastmonkey 2>/dev/null; else deluser fastmonkey 2>/dev/null; delgroup fastmonkey 2>/dev/null; fi
echo 'Fast Monkey is removed. Docker, gVisor and Node stay installed.'
