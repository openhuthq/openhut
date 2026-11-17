---
status: accepted
---
# OpenHut connections: keys, vendors' own MCP servers, and a customer Google client

## Decision

Owner, 2026-11-13: build every integration in the catalog, each opening a wide two-pane connect dialog (what agents get
and how it stays safe on the left, numbered steps on the right) and each connection getting its own page.

- **Keys**: Postgres (DSN), Convex (deploy key, ported from Skyfleet), and a custom MCP server (URL plus an optional
  `Name: value` header). The key is tested before it's saved.
- **Sign-ins through the vendor's own MCP server**: PostHog (`mcp.posthog.com/mcp`) and Linear (`mcp.linear.app/mcp`)
  register OpenHut themselves (OAuth dynamic registration, PKCE), like Skyfleet's remote MCP connections. A custom
  MCP server can sign in the same way.
- **GitHub** (owner, 2026-11-14) is a bot: a GitHub App the person registers from the connect dialog (GitHub's
  manifest flow: name it, press Create on GitHub, pick its repositories). OpenHut keeps the app's private key
  sealed and mints one-hour installation tokens. They go to GitHub's own MCP server (`api.githubcopilot.com/mcp/`) as
  the bearer, so commits and pull requests show as `name[bot]`, and to the agent through the `github_git_credentials`
  tool, which returns the `git config` lines for cloning and pushing from its terminal as the bot. This replaces the
  pasted personal token of 2026-11-13 and reverses "agents do not `git clone`": the owner wants real clones, the
  token that enters the container dies in an hour and reaches only the installed repositories, and agents could
  already reach github.com on 443. The key itself never leaves the server.
- **Google** (Gmail, Drive, Workspace = Docs, Sheets, Slides and Calendar) uses Google's MCP servers
  (`<product>mcp.googleapis.com/mcp/v1`). Google has no dynamic registration, so an owner or admin pastes a Google
  OAuth client (Web application) once, in Admin or in step 1 of the dialog; OpenHut runs the OAuth itself.
- **Excalidraw** (owner, 2026-11-16) takes no key and no sign-in: one native tool, `excalidraw_draw`, turns boxes,
  arrows and notes into a drawing, encrypts it on this server and stores it on excalidraw.com the way its own Share
  button does, then returns the `excalidraw.com/#json=<id>,<key>` link. Excalidraw's public MCP server
  (`mcp.excalidraw.com`) was tried first and dropped: its drawing tool only renders inside chat apps that show its
  widget, and its upload tool takes finished Excalidraw JSON that the widget builds in the browser, so an agent in
  Slack got shapes with no labels. Excalidraw+ has a real MCP server, but it needs a paid workspace.
- The Tailscale connection (joining a runtime to a tailnet so connections reach private hosts) was removed on
  2026-11-17 (owner: not relevant). Tailscale stays only for adding computers. The `tailscale` settings row is left in
  place, unread.
- Every kind is one `Connector` (`tools`, `call`) in `integrations/`; agents see `<kind>_<tool>` names through the gateway.

## Context

The catalog listed eight services as "Not in this build yet". Skyfleet already had Convex and remote-MCP OAuth code.

## Why

- Vendors' MCP servers carry their own tools and keep them current; writing our own Linear or Gmail tools would be
  maintenance with no gain.
- A self-hosted install can't share one Google client across customers, and Google won't register one per install.

## Consequences

- Sign-ins in progress live in memory for 15 minutes; a restart mid-sign-in means starting it again.
- The OAuth callback can't use the session cookie (`SameSite=Strict` isn't sent on the provider's redirect), so the
  unguessable `state` binds the sign-in to the person who started it, and works once.
- PostHog's sign-in asks for every scope its server lists (the MCP SDK uses `scopes_supported`).
- Google's scopes: Gmail modify + compose (no tool sends), Drive readonly + file, Docs/Sheets/Slides write, Calendar
  events. Restricted scopes mean the consent screen should be Internal.
- An Excalidraw link is public to anyone who has it and can't be taken back, so the tool tells agents to leave
  secrets out. Someone who already has a drawing open on excalidraw.com is asked whether to replace it when they open
  a link. Text sizes are estimated (0.55 of the font size per character), since measuring needs a browser.
