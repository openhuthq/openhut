---
status: accepted
---
# OpenHut installs into one Docker container

Superseded in part on 2026-11-17 by `desktop-app.md`: on a Mac or a Linux desktop, OpenHut is the desktop app with no Docker. This stays the install for Linux servers and for a Mac that already runs Docker Desktop.

## Decision
`curl -fsSL https://openhut.dev | sh` runs OpenHut in one privileged container named `openhut` (pinned `docker:28-dind`, volume `openhut` for its Docker), on Linux and on a Mac with Docker Desktop. No sudo unless Docker is missing on Linux, which the script installs from apt or apk. Inside the container the script does the usual install. A server that already has `/opt/openhut` keeps upgrading in place.

## Context
2026-11-17, from Erich's first try (Skyfleet `brain/meetings/zeitmaker/2026-11-17-erich-tries-openhut.md`). His Claude said OpenHut needed root and made a throwaway VM, because he didn't want it to break the Beelink that runs his other agents. The owner asked for one line that works on a Beelink, a Mac or a VPS, with Docker installed if missing and the dashboard shown before the image is pulled.

## Why
A native install changes the host: Docker's runtimes, iptables, systemd units, Node in `/usr/local`, and a Docker restart on every install (which stops every container on the box). In a container none of that leaves it, and `docker rm -f openhut && docker volume rm openhut` undoes everything. It is also the path e2e tests on every run; the systemd path never was.

## Consequences
`--privileged` is not a security wall: the container can reach the host like a root install could. Agents keep gVisor and the firewall, applied in the container's network namespace. Port 8787 was published on all interfaces until 2026-11-17; now the server listens on loopback only and is reached with `tailscale serve` (`auth-is-local-socket-or-tailscale.md`). Data lives in the container, so deleting it deletes everything. The agent image pulls in the background on a first start (no agents yet); creating an agent before it's there returns a 409 that says so.
