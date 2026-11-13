# Fast Monkey v1: verification plan

## The goal being verified

One command installs Fast Monkey on a server. Fast Monkey deploys many Hermes agents. Each agent:
- runs in its own isolated container;
- has its own instructions and channel;
- reaches team data only through one MCP gateway, which holds the keys and checks per-agent grants on every call.

Everything is managed from a email-and-password dashboard, or from a person's own AI assistant over the control MCP, signed in with OAuth.

The test story comes from scoping. A **Dev** agent may query the team's Orders database; a **Sales** agent may not. Neither can reach:
- the other agent;
- the server;
- the database directly;
- the customer's LAN;
- the cloud metadata address.

## What the v1 slice is

| Part | In this repo | Blueprint parts not in the slice |
|---|---|---|
| Control plane | An npm-workspaces + Turborepo monorepo laid out like Skyfleet: `packages/app` (Fastify, Kysely on PGlite, domain modules), `packages/web` (React, Vite, TanStack Query), `packages/common` (the Zod Mini API contract), `packages/agentd`, `packages/e2e`. Node 22.18+ runs the TypeScript directly. The API is resource-oriented with Stripe's shapes (`brain/decisions/fastmonkey-api-follows-skyfleet.md`) | |
| Sign-in | The installer prints a one-time link, `/setup?code=…`; the page sends the code with the first person's email and password (`POST /api/people {setupCode}`), making them the **owner**. Then setup closes, and people join only through **invite links** an owner or admin makes (`POST /api/invites`; one use, 7 days, member or admin; only the token's hash is stored; pending ones listed and revocable). Joining is `POST /api/people {inviteToken}`. An owner or admin can **remove** a person (not the owner): their sessions and OAuth apps stop at once and their agents stop. Passwords: async scrypt, and an unknown name costs the same as a wrong password. Session cookie (HttpOnly, SameSite=Strict). Invite links and the MCP address use the Public URL, editable on Admin | |
| Agent gateway `:8081` | `list_tools` / `describe_tool` / `call_tool`. Per-agent HMAC token, bound to the agent's own subnet. Live `reachable()` = the agent's grants that its owner can still use (a removed owner can use nothing). Per agent: at most 16 connections (firewall), 8 requests in flight, 1 MB per request, headers within 10 s, 60 s per request. One audit row per call, including refused, busy and malformed calls. A connection's page shows its calls (`/api/connection-events`); calls no connection allowed are listed by agent (`/api/connection-events?agentId=`, which admins can read for deleted agents too). Events page with `limit`/`startingAfter` and a real `hasMore`; only people who can use a connection (or admins) see its calls | Connectors other than Postgres |
| Connector | Postgres. Each call runs as one cursor in the extended protocol inside a read-only transaction, so it's exactly one SELECT/VALUES statement, held to 15 s and 1000 rows. A reply over 64 KB is refused as too large for the agent, and the read stops at 8 MB, so memory stays bounded. At most 2 calls per agent per connection run at once. Refused connections: ones that log in as a superuser, as a member of one, or as a role that can run server programs or touch server files. The address guard blocks loopback, "this host", link-local and agent networks, by IP (IPv4-mapped too) or by name. The gateway connects to the address it checked, but checks TLS against the DSN's name. `sslmode` keeps libpq's meanings (`require`, `verify-ca`, `verify-full`), and it's the only connection-string option allowed. `verify-*` trusts public CAs only; a private CA can't be configured in v1 | Convex, PostHog, Linear, Google, Custom MCP, Tailscale |
| Connectors beyond Postgres | Convex (deploy key), PostHog and Linear (their MCP servers, OAuth with dynamic registration), Gmail, Drive and Google Workspace (Google's MCP servers, OAuth through the customer's Google client set in Admin), any MCP server (URL plus a header, or OAuth), and Tailscale (agentd joins the server to the tailnet). Every outbound request goes through `guardedFetch`, which refuses loopback, link-local and agent addresses on every socket. Unit tests cover the guard (names, literals, redirects) and a whole sign-in against a local OAuth MCP server. | Real sign-ins to PostHog, Linear and Google, and a real tailnet: they need accounts. |
| Control MCP `:8787/mcp` (Admin calls it "AI assistant") | Sign-in is OAuth 2.1, from Skyfleet: the client registers itself, the person approves it on `/mcp/authorize` while signed in, PKCE, 1-hour access tokens and rotating refresh tokens; Admin lists connected apps and disconnects them. OAuth is the only way in: there are no personal tokens, and a session cookie is never accepted. Its tools call the HTTP API in-process (`app.inject`), so they get the dashboard's validation, permissions and response shapes: `list_agents`, `get_agent`, `create_agent`, `update_agent`, `delete_agent`, `list_grants`, `create_grant`, `delete_grant`, `list_connections`, `get_connection`, `create_connection`, `update_connection`, `delete_connection`, `list_connection_events`, `list_channels`, `list_people`, `delete_person`, `list_invites`, `create_invite`, `delete_invite`, `get_admin`, `update_admin` | The three-tool front (search/describe/call) |
| agentd | Runs as root on a Unix socket with a fixed command set: `create apply start stop restart-now rm ps health wa-pair wa-unlink ts-up ts-status ts-down`. It runs one command at a time per agent. It refuses to create, start or restart an agent unless the firewall check passes; concurrent health checks share one firewall check. Every 30 s a watchdog re-applies the firewall, or stops every agent if it can't. Before each start it clears Hermes's stale PID file: under gVisor with `--init` Hermes is always PID 2, so the old file would stop it from starting. `wa-pair` runs Hermes's WhatsApp bridge in pairing mode inside the agent's own container and keeps its latest QR payload; when the phone links, or after 5 minutes without a scan, it restarts the agent | |
| Agent container | Block A of the isolation plan: gVisor, uid 10000, read-only root, cap-drop ALL, no-new-privileges, pids/memory/CPU limits, own `/24`. Mounted read-only:<br>• its config, .env, SOUL.md and Claude settings;<br>• `plugins/`: the one vendored plugin, the Claude seat plugin, pinned;<br>• the `claude` CLI, pinned 2.1.311;<br>• the WhatsApp bridge with its dependencies, prepared once per image on the host (the image has no npm);<br>• `hooks/` and both channel-approval folders, empty.<br>`platforms/` and `.claude/` are mounts of their own, so they can't be renamed away. **No Docker restart policy**: only agentd starts agents, and the app restarts the ones marked running every 30 s | Our own image (the official Hermes image runs here, pinned by digest) |
| Firewall | Block B of the isolation plan. Two chains are loaded in one `iptables-restore` commit:<br>• `AGENT`, reached from DOCKER-USER, for agents' outbound traffic: DNS to the resolver and HTTPS (443), nothing else;<br>• `AGENT-IN`, reached from INPUT: agents reach only the gateway on 8081, at most 16 connections each, and nobody else reaches 8081.<br>`ip rule` 5200 is added too. Each jump is kept as the first rule of its chain. It's applied before dockerd starts and whenever agentd starts. `agents-firewall.sh --check` compares both chains, both jumps (as first rules) and the ip rule with what was applied. `/health` returns 503 unless that check passes; it reads a result at most 5 s old | |
| Model | `FASTMONKEY_MODEL=test` runs a deterministic OpenAI-compatible model behind the gateway port, so runs are free and repeatable. `claude` mode (the default) renders the seat plugin config and puts the seat token in each agent's .env. The app re-renders every agent's files when it starts | A live Claude seat turn (needs the customer's `setup-token`) |
| Channels | Each agent can have its own **Slack app** (Socket Mode; the dashboard links to Slack with our manifest filled in; the app checks both tokens with Slack before saving them) and its own **WhatsApp number** (bot mode, linked by scanning a QR shown in the dashboard). Who may message it: the owner plus listed IDs or numbers, or anyone; strangers get no reply. Approvals go to the owner (their email, Slack ID and WhatsApp number); an agent anyone can message uses Hermes's `smart` approvals. The tests talk to each agent through Hermes's own API server inside its network, which the dashboard doesn't show | A message sent from a live Slack workspace, and a phone scanning the QR (see "Not verified here") |
| Hermes settings the build needed | `tools.tool_search.enabled: "off"`: Hermes hides MCP tools behind its own search by default, and our gateway already discloses tools progressively. `platform_toolsets.api_server` names our server. `API_SERVER_KEY` must be 16+ characters. `HERMES_GATEWAY_LOCK_DIR` is in `/tmp`, a fresh tmpfs (Slack needs it writable) | |

## Install and the e2e run

How the installer works, and how `npm run e2e` runs it on Docker Desktop (a bare server, the install, a tampered upgrade, the real upgrade, a restart, the caches and what lands in `packages/e2e/results/`), is in `brain/fastmonkey-gotchas.md`.

## Checks

Each check is one `node:test` test in `packages/e2e/src/e2e.ts`, which names what it proves and what it expects; a run's `packages/e2e/results/e2e-report.md` lists them all with the actual values.

## Mock parity

The approved mock is the **Mock** tab of the Fast Monkey blueprint artifact (https://claude.ai/artifact/Ez9NRphiPZsmNdU2kD8JG5). The React dashboard reuses the approved CSS. Parity is checked in Chrome on a laptop instance (`fake-agentd.ts` + `seed-ui.ts`) and on the run's own deployment, signed in with the run's owner account (`packages/e2e/results/.test-credentials.json`).

| Mock screen | Built as in the mock | Differences |
|---|---|---|
| Agents, New agent | yes | — |
| Agent: one page, no tabs. Left: name with Reroll on the avatar, instructions preview, skills. Right: status, model dropdown, owner; channels; connections | yes | Slack and WhatsApp work. The mock's Reroll, skill upload, Memories row and per-connection tool access aren't in this build, so the page leaves them out. Stop/Start and Delete have coloured text with a neutral border |
| Connections; a connection: Activity on the left, details, sharing and agents on the right; add Postgres | yes | Sharing with one person isn't in this build; other connector kinds are listed, not installable |
| People: invite person, the invite link, pending invites, remove | yes | The mock's "Add person" with a password became an invite link |
| Admin: Claude seat, Google, Server (Public URL editable), AI assistant (connected apps, access token) | yes | The mock's Google, Backups and 5-hour window aren't in this build, so the page leaves them out |
| Sign in, owner sign-up, joining by invite, a used invite, the OAuth consent page | yes | Split layout: the form on the left, the agents on the right |

**User sign-off on parity: pending.**

## Not verified here, and how it will be

| Item | Why not here | How |
|---|---|---|
| A live Claude seat turn | Needs the customer's `claude setup-token` | On the Beelink with a real seat: `update_admin {seatToken}`, then one chat per model; isolation plan tests 11, 12, 14, 15 |
| The systemd path: units, `prepare.sh`, firewall-before-Docker ordering under systemd | The test server boots with `host-start.sh` (no systemd in a container) | Fresh Debian 13 on the Beelink: run the curl command, reboot, then run `e2e.ts after-restart` |
| The apt branch, Node from nodejs.org, the installer installing Docker | The test server is Alpine with Docker present | The same Beelink install (Debian without Docker) |
| Boot on non-systemd hosts (OpenRC) | Nothing starts Fast Monkey at boot there. The installer says so. Agents have no restart policy, so they stay stopped until `host-start.sh` runs | v1 supports systemd hosts for unattended reboots |
| A live Slack message and a phone scanning the WhatsApp QR | Need a real workspace and a real phone. Here, CH1 proves the app talks to Slack, CH2 that WhatsApp hands out a real pairing code inside the agent's firewall, and unit tests the rendered settings | One test workspace and one test number on the Beelink: connect both from the dashboard, then the D-checks over each channel |
| Kata (L3), real hardware reboot, the real EC2 metadata service, Tailscale subnet routes | Need KVM, real hardware, a cloud VM and a tailnet. (Here, 169.254.169.254 is a stand-in listener.) | Isolation plan tests 6 and 7 on the Beelink; one EC2 instance for metadata |
| Memory per agent at scale | Docker Desktop numbers aren't the Beelink's | Isolation plan test 4 |

## Accepted risks in v1

- **Plain HTTP on 8787.** Passwords, cookies and tokens travel unencrypted unless the customer keeps the port private (Tailscale or an SSH tunnel) or puts TLS in front. The installer says so. The setup code stops anyone else from claiming the owner account.
- **An agent reads its own `.env`.** That includes its channel key, its own Slack tokens and, in claude mode, the seat token. Hermes inside the agent needs them to hold its own Slack connection and drive the Claude CLI.
- **Invite links are bearer links for 7 days.** Whoever opens one first gets the account. Owners and admins see pending links and can revoke them, and can remove a person afterwards.
- **WhatsApp linking runs the bridge's pairing mode inside the agent's container** for up to 5 minutes. A phone that scans the code links its number to that agent; only people who can edit the agent see the code.
- **An agent can write its own cron jobs** (`cron/jobs.json`, though the cronjob toolset is off). They run as that agent with its own grants: persistence, not escalation. Scheduling is a later feature, and its UI will own this file.
- **No per-agent disk quota.** One agent can fill `/data`. Quotas (XFS project quota or a loop image) come later.
- **An agent writes its own skills** (`skills/` in its home). Instructions planted by a message can persist there, as they can in its memories. They run with that agent's grants only.
- **Code execution is on by default**, with a switch per agent. It runs in the same sandbox as the shell, which every agent already has.
- **Private database CAs.** `verify-ca`/`verify-full` work with publicly trusted certificates only; a private CA can't be configured in v1 (use `require`, which encrypts without checking).
- **Root on the server can read everything.** `auth_secret` sits next to the sealed DSNs in `/data/app`, which is mode 0700.

## Pass criteria

1. `npm run e2e` exits 0 on a fresh run: every check in all three phases passes, and the report says the tree matches what the run tested. `npx turbo run build typecheck test` passes.
2. The result files exist and match the report.
3. Three reviewer agents return **zero comments**. Each is briefed only with this plan, the code, the results and read-only access to the live server:
   - **Senior software engineer**: is the code correct and minimal, and does it do what this plan claims?
   - **Security / SRE**: does the evidence prove each isolation and permission claim, and is anything exploitable that the checks miss?
   - **QA / verification**: does every check test what it says, could any pass falsely, and is anything in the goal unverified without being listed above?

   Every comment is either fixed (and the run repeated) or answered with evidence, until all three say zero.
4. The user signs off on mock parity (see above).
