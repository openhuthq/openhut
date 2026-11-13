#!/bin/sh
# Folders, modes and the agents' resolver file. Run before agentd starts (by host-start.sh, and by jakebox-agentd.service).
set -eu
[ -f /etc/jakebox/env ] && . /etc/jakebox/env
mkdir -p /var/log/jakebox /data/app /data/agents /data/agent-conf /etc/agentd
chown jakebox:jakebox /data/app; chmod 0700 /data/app /data/agents /data/agent-conf   # the app DB holds auth_secret
printf 'nameserver %s\n' "${RESOLVER:-1.1.1.1}" > /etc/agentd/resolv.conf
