#!/bin/sh
set -eu
RESOLVER="${RESOLVER:-1.1.1.1}"
AGENTS=10.200.0.0/16
APPLIED=/run/openhut/firewall.rules
current() { iptables -S AGENT && iptables -S AGENT-IN && iptables -S DOCKER-USER | sed -n 2p && iptables -S INPUT | sed -n 2p && ip rule show | grep "to $AGENTS lookup main"; }

if [ "${1:-}" = --check ]; then
  [ -f "$APPLIED" ] && [ "$(current 2>/dev/null)" = "$(cat "$APPLIED")" ]
  exit
fi

iptables -N DOCKER-USER 2>/dev/null || true
iptables-restore --noflush <<RULES
*filter
:AGENT - [0:0]
:AGENT-IN - [0:0]
-A AGENT -o tailscale0 -j DROP
-A AGENT -d $RESOLVER/32 -p udp --dport 53 -j RETURN
-A AGENT -d $RESOLVER/32 -p tcp --dport 53 -j RETURN
-A AGENT -d 169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10 -j DROP
-A AGENT -p tcp --dport 443 -j RETURN
-A AGENT -j DROP
-A AGENT-IN -s $AGENTS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
-A AGENT-IN -s $AGENTS -p tcp --dport 8081 --syn -m connlimit --connlimit-above 16 --connlimit-mask 24 -j DROP
-A AGENT-IN -s $AGENTS -p tcp --dport 8081 -j ACCEPT
-A AGENT-IN -s $AGENTS -j DROP
-A AGENT-IN -p tcp --dport 8081 -j DROP
COMMIT
RULES
first() { chain=$1; shift; [ "$(iptables -S "$chain" | sed -n 2p)" = "-A $chain $*" ] && return; while iptables -D "$chain" "$@" 2>/dev/null; do :; done; iptables -I "$chain" 1 "$@"; }
first DOCKER-USER -s "$AGENTS" -j AGENT
first INPUT -j AGENT-IN
ip rule show | grep -q "to $AGENTS lookup main" || ip rule add to "$AGENTS" lookup main priority 5200
mkdir -p "$(dirname "$APPLIED")" && current > "$APPLIED"
echo "firewall: AGENT ($(iptables -S AGENT | wc -l) rules), AGENT-IN ($(iptables -S AGENT-IN | wc -l)), first in DOCKER-USER and INPUT, ip rule 5200"
