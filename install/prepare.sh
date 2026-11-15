#!/bin/sh
set -eu
[ -f /etc/openhut/env ] && . /etc/openhut/env
mkdir -p /var/log/openhut /data/app /data/agents /data/agent-conf /etc/agentd
chown openhut:openhut /data/app; chmod 0700 /data/app /data/agents /data/agent-conf
printf 'nameserver %s\n' "${RESOLVER:-1.1.1.1}" > /etc/agentd/resolv.conf
