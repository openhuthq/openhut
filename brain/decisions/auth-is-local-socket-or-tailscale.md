---
status: superseded in part by app-aggregates-runtimes.md (the server mode: Tailscale identity and people)
---
# Auth is the Mac's own socket, or the tailnet login

## Decision
2026-11-17: the **Server** mode below is replaced by `app-aggregates-runtimes.md`: a remote runtime answers only the key the app enrolled, and there are no people. The **Local** mode and the agents' gateway token stand.

Owner, 2026-11-17. OpenHut has no sign-in. The server runs in one of two modes:
- **Local** (the Mac app, `OPENHUT_SOCKET` set): the server listens only on a Unix socket in the app's folder, mode 0600. Every request on it is the one owner, a person named after the macOS user and created on first start. The app's main process serves the renderer on `app://openhut` and forwards `/api/*` and `/mcp` to the socket. An AI assistant on the Mac reaches the control MCP through `packages/desktop/bin/openhut-mcp.mjs`, a stdio bridge to the socket.
- **Server** (installed by curl): the server listens on 127.0.0.1:8787 only and is published with `tailscale serve`, which adds `Tailscale-User-Login`. The server trusts that header only on loopback connections. The first login to reach a fresh server becomes the owner; an owner or admin adds others by their login. The control MCP knows people the same way.

Agents' gateway on :8081 trusts only the agent's own token (HMAC of its id), with no address check.

## Context
OpenHut became a Mac app that also manages servers over Tailscale. Passwords, session cookies, setup codes, invite links and an OAuth server for the control MCP existed only to say who someone is, and both the Mac and the tailnet already know.

## Why
- File permissions on a socket are the OS's own access control: no token to store, leak or inject, and nothing on a TCP port for a browser or another user to reach.
- Tailscale already authenticates every device and person on the tailnet, and `tailscale serve` hands the server a verified login.
- One check per caller type (socket, tailnet login, agent token) instead of five.

## Consequences
- Supersedes the sign-in parts of `openhut-api-follows-skyfleet.md` (OAuth for the control MCP, sessions, `/api/setup`, `/api/invites`) and the sign-up bullet of `openhut-v1-scope.md`.
- Any process on a server can claim any login by sending the header to 127.0.0.1:8787. Run nothing untrusted beside OpenHut.
- Whoever on the tailnet opens a fresh server first owns it: run `tailscale serve` when you're ready to open it yourself.
- Webhooks (`/hooks/:id`) and connection sign-in callbacks reach a server only through the tailnet (or Funnel). On the Mac, the app turns navigations to `http://127.0.0.1:*` into `app://openhut` so OAuth callbacks land on the socket.
- An agent's token works from anywhere it leaks to; the agent firewall and the token's secrecy are the fence.
