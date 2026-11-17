---
name: openhut-move-to-container
description: Move a native OpenHut install (/opt/openhut, systemd units) into the one-container setup, keeping people, agents, connections and the Claude seat.
---
Done on internal on 2026-11-17: about 2 minutes of downtime, everything kept. Run as root on the server.

1. Stop and back up: `systemctl stop openhut openhut-agentd`, stop the agent containers (`docker ps -q --filter label=openhut.agent | xargs -r docker stop`), then `tar --numeric-owner -czf /root/openhut-native-backup-<date>.tgz /data/app /data/agents /data/agent-conf /etc/openhut`.
2. Retire the native install so it can come back: `systemctl disable openhut openhut-agentd openhut-firewall` (this also drops `docker.service.requires/openhut-firewall.service`; leave it and Docker won't start after a reboot once step 3 is done), then `mv /opt/openhut /opt/openhut.native`.
3. Run `curl -fsSL https://openhut.dev | sh`. With no `/opt/openhut` it makes the `openhut` container.
4. Copy the data in from a script file, not a `sh -c` string (a `pkill -f` pattern in a command line matches the shell running it): `docker exec openhut pkill -f '^node /opt/openhut/packages'`, empty `/data/app /data/agents /data/agent-conf` inside, then `tar --numeric-owner -C / -cf - data/app data/agents data/agent-conf etc/openhut/env | docker exec -i openhut tar --numeric-owner -C / -xf -`.
5. `docker exec openhut chown -R openhut:openhut /data/app` (the container's `openhut` user has a different uid than the host's), then `docker restart openhut`. The app recreates every running agent from its folder.

Rollback: `docker rm -f openhut && docker volume rm openhut`, `mv /opt/openhut.native /opt/openhut`, `systemctl enable --now openhut-firewall openhut-agentd openhut`. Once the move is settled, reclaim the old agent image, the stopped `ag-*` containers, `/opt/openhut.native` and the host's `/data`.
