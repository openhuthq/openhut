#!/bin/sh
set -eu
mkdir -p /data/etc /data/log /run/agentd-etc
chmod 0700 /data/etc
ln -sf /data/install.lock /run/openhut-install.lock
export AGENT_IMAGE="${AGENT_IMAGE:-$(cat /opt/openhut-agent/image)}"
exec /opt/openhut/install/host-start.sh
