#!/bin/sh
set -eu
[ -f /etc/fastmonkey/env ] && . /etc/fastmonkey/env
mkdir -p /var/log/fastmonkey /data/app /data/agents /data/agent-conf /etc/agentd
chown fastmonkey:fastmonkey /data/app; chmod 0700 /data/app /data/agents /data/agent-conf
printf 'nameserver %s\n' "${RESOLVER:-1.1.1.1}" > /etc/agentd/resolv.conf
