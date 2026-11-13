#!/bin/sh
# Block B of the isolation plan. Runs before dockerd starts and whenever agentd starts; agentd's watchdog runs
# `agents-firewall.sh --check` every 30 s and re-applies it when the check fails.
# Both chains are replaced in one iptables-restore commit, so there is never a moment with a partial rule set:
#   AGENT     agents' traffic leaving the server (reached from DOCKER-USER): DNS to the resolver and HTTPS, nothing else
#   AGENT-IN  traffic to the server itself: agents reach only the gateway on 8081, at most 16 connections each, and
#             nobody else reaches 8081
set -eu
RESOLVER="${RESOLVER:-1.1.1.1}"
AGENTS=10.200.0.0/16
APPLIED=/run/jakebox/firewall.rules   # the rule set as iptables reports it right after applying; --check compares with it
# Each jump must be the FIRST rule of its chain, or a rule above it could let agent traffic skip our chains.
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
# Put each jump first: drop any copies, then insert at the top.
first() { chain=$1; shift; [ "$(iptables -S "$chain" | sed -n 2p)" = "-A $chain $*" ] && return; while iptables -D "$chain" "$@" 2>/dev/null; do :; done; iptables -I "$chain" 1 "$@"; }
first DOCKER-USER -s "$AGENTS" -j AGENT
first INPUT -j AGENT-IN
# Agent networks always route locally, ahead of Tailscale's table 52.
ip rule show | grep -q "to $AGENTS lookup main" || ip rule add to "$AGENTS" lookup main priority 5200
mkdir -p "$(dirname "$APPLIED")" && current > "$APPLIED"
echo "firewall: AGENT ($(iptables -S AGENT | wc -l) rules), AGENT-IN ($(iptables -S AGENT-IN | wc -l)), first in DOCKER-USER and INPUT, ip rule 5200"
