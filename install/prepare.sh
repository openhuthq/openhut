#!/bin/sh
set -eu
[ -f /etc/jakebox/env ] && . /etc/jakebox/env
mkdir -p /var/log/jakebox /data/app /data/agents /data/agent-conf /etc/agentd
chown jakebox:jakebox /data/app; chmod 0700 /data/app /data/agents /data/agent-conf
printf 'nameserver %s\n' "${RESOLVER:-1.1.1.1}" > /etc/agentd/resolv.conf
