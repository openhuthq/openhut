---
status: accepted
---
# One container per agent, on gVisor

## Decision
Each Hermes agent runs in its own hardened container (gVisor, read-only root, own network, read-only config) on the same server. A root `agentd` with fixed commands is the only thing that starts them. Kata microVMs are the safer tier, one runtime flag away.

## Context
2026-11-12. The first idea was many Hermes profiles in one container. Reviewed by SWE, SRE and design agents over 10 rounds; plan in the Isolation artifact https://claude.ai/artifact/HkoPtYictFbEH4UDAYToWY.

## Why
Hermes profiles don't sandbox, and agents read untrusted WhatsApp/email/Slack input. In one container an injected agent could read every other agent's credentials and the control plane's `auth_secret`.

## Consequences
Install is still one line. Each agent costs a container and up to 1 GB. The control plane never holds the Docker socket and never writes inside an agent's folder. An injected agent can still leak its own channel creds, memories and the shared model key.
