---
status: accepted
---
# OpenHut is a desktop app on Mac and Linux

## Decision
Owner, 2026-11-17. OpenHut ships as an Electron app (`packages/desktop`) for macOS 14+ on Apple silicon (dmg, zip) and for x64 Linux (AppImage, deb). The main process serves the renderer on `app://openhut` and runs this computer's runtime (`packages/runtime`: the server and agentd) with `utilityProcess.fork`. The server runs in local mode (`OPENHUT_SOCKET`): a Unix socket in the app's folder, mode 0600, with no sign-in (`auth-is-local-socket-or-tailscale.md`). The app is a window over this runtime and the ones on computers you add (`app-aggregates-runtimes.md`). Agents run in one microsandbox microVM each (`sandbox-module.md`), so the app needs no Docker. Remote Linux servers installed by curl stay as remote runtimes, reached over Tailscale with a key the app enrolls. Windows is out of scope.

## Context
The curl install asked Mac users for Docker Desktop and a privileged container (`openhut-installs-in-one-container.md`), and people who just wanted agents on their own computer had no one-click path. The app also manages servers on the tailnet.

## Why
- One download, no Docker, no root: the app carries `msb` and libkrunfw and the hypervisor entitlement (`brain/openhut-gotchas.md`, The Mac app).
- One codebase: the same runtime runs on a server and in the app; only the sandbox and the auth mode (socket or enrolled key) differ.
- Linux desktops get the same app on KVM; Windows would need WHP or WSL2 work nobody has asked for.

## Consequences
- Supersedes `openhut-installs-in-one-container.md` for Macs and Linux desktops; the curl install stays the path for Linux servers and for a Mac that already runs Docker Desktop.
- No Intel Macs and no Linux without `/dev/kvm`: the Linux app says "This computer can't run agents" and quits.
- Releases are signed, notarized and published by `.github/workflows/desktop.yml` on a `v*` tag (`brain/openhut-deploy.md`): the Mac job, then a Linux job (AppImage and deb on ubuntu-latest) that publishes the draft.
- The packaged app carries the installer's pinned Linux `claude` CLI for the guest (`pack-backend.mjs`); microsandbox refuses to start an agent whose required mount is missing.
- If the system keychain can't be used and `secret.bin` exists, the app refuses to start and says so, rather than mint a new root secret.
- Closing the window on a Mac keeps agents running; on Linux it quits the app (no tray). VMs outlive the app either way.
- While the app is closed another local program can take 127.0.0.1:8081, and the running VMs would send it their calls (they carry only each agent's own gateway token, never a real key). The server treats a gateway it can't bind as fatal: it logs `gateway.bind_failed`, stops every running agent and exits, and the app's restart backoff tries again. Agents proving the gateway is ours (a challenge signed with the per-agent key) would close the window while closed too, but needs a check inside Hermes and the Claude CLI, so it waits.
