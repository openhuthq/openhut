# Agent sandboxing survey (2026-11-17)

How other agent products isolate agents, and what OpenHut needs. Full notes with every source were in a research pass on 2026-11-17; this is the summary. Decision: `decisions/sandbox-module.md`.

## Recommendation
- **Linux servers:** Docker + gVisor (`runsc`) + host iptables, gVisor required. systrap needs no KVM, so it works on a VPS ([gVisor platforms](https://gvisor.dev/docs/architecture_guide/platforms/)).
- **Desktop:** one microsandbox microVM per agent. It is the only option that is zero-install, a VM per agent, and blocks LAN, Tailscale, metadata and the host on the host side ([microsandbox network](https://raw.githubusercontent.com/superradcompany/microsandbox/main/docs/security/network.mdx)). Pin it, keep the fence self-check.
- **Fallbacks:** the `docker:dind` curl install on a Mac with Docker; WSL2 on Windows.
- **Don't build** an Apple `container` backend (no egress filtering, macOS 26 only) or a Seatbelt/bubblewrap one (agent and Chromium on the host; Goose shipped and removed one, [PR #10900](https://github.com/aaif-goose/goose/pull/10900)).
- **When two backends hurt:** a bundled Linux VM running the server stack, or NVIDIA OpenShell, which has OpenHut's shape and already runs Hermes ([architecture](https://docs.nvidia.com/openshell/about/architecture.md)).
- **Next gain:** keep the model key out of the sandbox with a placeholder the gateway swaps.

## Products, one line each
- **OpenClaw:** agent on the host; Docker sandbox for tools only, off by default; keys readable by the agent; many 2026 incidents ([sandboxing](https://docs.openclaw.ai/gateway/sandboxing)).
- **DuskBot:** correction to our notes, it uses no microVMs. Its "Local VM" is a Docker, Podman or Apple `container` desktop; engines run on the host; the bubblewrap box with a public-only proxy is Linux cloud only; VPS desktops use gVisor and a host fence ([bot-box.md](https://github.com/DuskBotAI/duskbot/blob/7791c1f06691a47e8ddf057e9fc34ff191746797/docs/bot-box.md)).
- **Grok Bot (xAI):** one Firecracker microVM per user, shared by all their Bots ([security FAQ](https://docs.x.ai/grok-bot/security-faq)).
- **Hermes Agent:** host by default; its own SECURITY.md says wrap the whole process when input is untrusted, which OpenHut does ([SECURITY.md](https://github.com/NousResearch/hermes-agent/blob/main/SECURITY.md)).
- **NanoClaw:** agent in a container per session, credential proxy, egress open unless locked down ([SECURITY.md](https://raw.githubusercontent.com/qwibitai/nanoclaw/main/docs/SECURITY.md)).
- **Claude Code, Codex, Cursor, Gemini CLI:** agent on the host, commands in Seatbelt or bubblewrap behind a proxy allowlist ([srt](https://github.com/anthropic-experimental/sandbox-runtime/blob/0bbebed0aa9a8e628dc4df8bc30293550a1988eb/README.md)).
- **Claude Cowork:** started with the agent in a VM, now host with a VM for tools ([Anthropic](https://www.anthropic.com/research/how-we-contain-claude)).
- **Docker Sandboxes (`sbx`):** microVM per sandbox, host proxy, credentials injected ([security](https://docs.docker.com/ai/sandboxes/security/)).
- **OpenHands:** agent server in Docker per conversation, no egress allowlist.
- **Meta Muse:** cloud VM per user, a separate agent approves all egress.

## Open items
- `runsc` systrap inside a libkrun or Lima guest (works in Docker Desktop's VM).
- RAM and start time of a microsandbox VM against a gVisor container for the Hermes image.
- Whether Hermes's `execute_code` runs in its Docker backend or on the host (its docs disagree).
- Apple `container`: LAN reachability by default. gVisor CVE-2026-96812 seen only on an aggregator.
