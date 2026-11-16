---
status: accepted
---
# The browser runs in the agent's own container: agent-browser, a switch, watch and take over

## Decision
An agent browses with agent-browser (Vercel Labs, Apache-2.0) inside its own gVisor container, driving the Chromium in the Hermes image. **Browser** is a switch on the agent, off by default; switching it recreates the container with agent-browser mounted read-only. People who can edit the agent see a still picture on its page (only while the page is open), a live view in a new tab, and can take over. Hermes's own browser toolset stays off.

## Context
2026-11-16, owner's calls in one session: not a connection but a switch on the agent; a small preview, live only on demand in a new tab; take over from the first release; agents will log in to sites; no separate browser container. Design, options and evidence: https://claude.ai/artifact/JYrTkduUEnqd3aD7hsWh3m (tab B, revision 3); mock: https://claude.ai/artifact/VYh5iesUZJnrvWExyfFWSs.

## Why
- agent-browser already has what we need: short commands for the agent, a JPEG stream over a WebSocket, mouse and keyboard input on that stream, persistent profiles, and an action policy re-read on every command (that is how Take over pauses the agent).
- Same container: no new process outside a sandbox, no new network, no firewall change. The browser reaches exactly what the agent's shell reaches.
- Steel hands agents full CDP control; neko needs a desktop stack and WebRTC ports the firewall and the tunnel don't pass; our own CDP code would repeat agent-browser.

## Consequences
- The agent can read its browser's cookies (they are in its home). A login given to an agent can be copied by a tricked agent. Use accounts made for the agent.
- Take over is cooperative: the agent could start its own agent-browser without our policy. It pauses the agent we wrote the instructions for, not a hostile one.
- Visits aren't in the gateway's audit log; they are shell commands in the agent's session.
- A browsing agent needs Large (2 GB): heavy news sites took a 1 GB agent to 980 MB.
- The Chromium is the Hermes image's (145 on 2026-11-16, twelve behind stable). It updates only with the image pin. Carrying our own Chrome is the next step.
- The column is `agent.web_browser`: a build on 2026-11-13 left a `browser` column defaulting to true.
