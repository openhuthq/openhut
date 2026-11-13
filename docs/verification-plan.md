# JakeBox v1: verification plan

## The goal being verified

One command installs JakeBox on a server. JakeBox deploys many Hermes agents. Each agent:
- runs in its own isolated container;
- has its own instructions and channel;
- reaches team data only through one MCP gateway, which holds the keys and checks per-agent grants on every call.

Everything is managed from a username-and-password dashboard, or from a person's own AI assistant over the control MCP, signed in with OAuth.

The test story comes from scoping. A **Dev** agent may query the team's Orders database; a **Sales** agent may not. Neither can reach:
- the other agent;
- the server;
- the database directly;
- the customer's LAN;
- the cloud metadata address.

## What the v1 slice is

| Part | In this repo | Blueprint parts not in the slice |
|---|---|---|
| Control plane | An npm-workspaces + Turborepo monorepo laid out like Skyfleet: `packages/app` (Fastify, Kysely on PGlite, domain modules), `packages/web` (React, Vite, TanStack Query), `packages/common` (the Zod Mini API contract), `packages/agentd`, `packages/e2e`. Node 22.18+ runs the TypeScript directly. The API is resource-oriented with Stripe's shapes (`brain/decisions/jakebox-api-follows-skyfleet.md`) | |
| Sign-in | The installer prints a one-time link, `/setup?code=…`; the page sends the code with the first person's username and password (`POST /api/people {setupCode}`), making them the **owner**. Then setup closes, and people join only through **invite links** an owner or admin makes (`POST /api/invites`; one use, 7 days, member or admin; only the token's hash is stored; pending ones listed and revocable). Joining is `POST /api/people {inviteToken}`. An owner or admin can **remove** a person (not the owner): their sessions and OAuth apps stop at once and their agents stop. Passwords: async scrypt, and an unknown name costs the same as a wrong password. Session cookie (HttpOnly, SameSite=Strict). Invite links and the MCP address use the Public URL, editable on Admin | |
| Agent gateway `:8081` | `list_tools` / `describe_tool` / `call_tool`. Per-agent HMAC token, bound to the agent's own subnet. Live `reachable()` = the agent's grants that its owner can still use (a removed owner can use nothing). Per agent: at most 16 connections (firewall), 8 requests in flight, 1 MB per request, headers within 10 s, 60 s per request. One audit row per call, including refused, busy and malformed calls. A connection's page shows its calls (`/api/connection-events`); calls no connection allowed are listed by agent (`/api/connection-events?agentId=`, which admins can read for deleted agents too). Events page with `limit`/`startingAfter` and a real `hasMore`; only people who can use a connection (or admins) see its calls | Connectors other than Postgres |
| Connector | Postgres. Each call runs as one cursor in the extended protocol inside a read-only transaction, so it's exactly one SELECT/VALUES statement, held to 15 s and 1000 rows. A reply over 64 KB is refused as too large for the agent, and the read stops at 8 MB, so memory stays bounded. At most 2 calls per agent per connection run at once. Refused connections: ones that log in as a superuser, as a member of one, or as a role that can run server programs or touch server files. The address guard blocks loopback, "this host", link-local and agent networks, by IP (IPv4-mapped too) or by name. The gateway connects to the address it checked, but checks TLS against the DSN's name. `sslmode` keeps libpq's meanings (`require`, `verify-ca`, `verify-full`), and it's the only connection-string option allowed. `verify-*` trusts public CAs only; a private CA can't be configured in v1 | Convex, PostHog, Linear, Google, Custom MCP, Tailscale |
| Control MCP `:8787/mcp` (Admin calls it "AI assistant") | Sign-in is OAuth 2.1, from Skyfleet: the client registers itself, the person approves it on `/mcp/authorize` while signed in, PKCE, 1-hour access tokens and rotating refresh tokens; Admin lists connected apps and disconnects them. OAuth is the only way in: there are no personal tokens, and a session cookie is never accepted. Its tools call the HTTP API in-process (`app.inject`), so they get the dashboard's validation, permissions and response shapes: `list_agents`, `get_agent`, `create_agent`, `update_agent`, `delete_agent`, `list_grants`, `create_grant`, `delete_grant`, `list_connections`, `get_connection`, `create_connection`, `update_connection`, `delete_connection`, `list_connection_events`, `list_channels`, `list_people`, `delete_person`, `list_invites`, `create_invite`, `delete_invite`, `get_admin`, `update_admin` | The three-tool front (search/describe/call) |
| agentd | Runs as root on a Unix socket with a fixed command set: `create apply start stop restart-now rm ps health wa-pair wa-unlink`. It runs one command at a time per agent. It refuses to create, start or restart an agent unless the firewall check passes; concurrent health checks share one firewall check. Every 30 s a watchdog re-applies the firewall, or stops every agent if it can't. Before each start it clears Hermes's stale PID file: under gVisor with `--init` Hermes is always PID 2, so the old file would stop it from starting. `wa-pair` runs Hermes's WhatsApp bridge in pairing mode inside the agent's own container and keeps its latest QR payload; when the phone links, or after 5 minutes without a scan, it restarts the agent | |
| Agent container | Block A of the isolation plan: gVisor, uid 10000, read-only root, cap-drop ALL, no-new-privileges, pids/memory/CPU limits, own `/24`. Mounted read-only:<br>• its config, .env, SOUL.md, skills and Claude settings;<br>• `plugins/`: the one vendored plugin, the Claude seat plugin, pinned;<br>• the `claude` CLI, pinned 2.1.311;<br>• the WhatsApp bridge with its dependencies, prepared once per image on the host (the image has no npm);<br>• `hooks/` and both channel-approval folders, empty.<br>`platforms/` and `.claude/` are mounts of their own, so they can't be renamed away. **No Docker restart policy**: only agentd starts agents, and the app restarts the ones marked running every 30 s | Our own image (the official Hermes image runs here, pinned by digest) |
| Firewall | Block B of the isolation plan. Two chains are loaded in one `iptables-restore` commit:<br>• `AGENT`, reached from DOCKER-USER, for agents' outbound traffic: DNS to the resolver and HTTPS (443), nothing else;<br>• `AGENT-IN`, reached from INPUT: agents reach only the gateway on 8081, at most 16 connections each, and nobody else reaches 8081.<br>`ip rule` 5200 is added too. Each jump is kept as the first rule of its chain. It's applied before dockerd starts and whenever agentd starts. `agents-firewall.sh --check` compares both chains, both jumps (as first rules) and the ip rule with what was applied. `/health` returns 503 unless that check passes; it reads a result at most 5 s old | |
| Model | `JAKEBOX_MODEL=test` runs a deterministic OpenAI-compatible model behind the gateway port, so runs are free and repeatable. `claude` mode (the default) renders the seat plugin config and puts the seat token in each agent's .env. The app re-renders every agent's files when it starts | A live Claude seat turn (needs the customer's `setup-token`) |
| Channels | Each agent can have its own **Slack app** (Socket Mode; the dashboard links to Slack with our manifest filled in; the app checks both tokens with Slack before saving them) and its own **WhatsApp number** (bot mode, linked by scanning a QR shown in the dashboard). Who may message it: the owner plus listed IDs or numbers, or anyone; strangers get no reply. Approvals go to the owner (their username, Slack ID and WhatsApp number); an agent anyone can message uses Hermes's `smart` approvals. The tests talk to each agent through Hermes's own API server inside its network, which the dashboard doesn't show | A message sent from a live Slack workspace, and a phone scanning the QR (see "Not verified here") |
| Hermes settings the build needed | `tools.tool_search.enabled: "off"`: Hermes hides MCP tools behind its own search by default, and our gateway already discloses tools progressively. `platform_toolsets.api_server` names our server. `API_SERVER_KEY` must be 16+ characters. `HERMES_GATEWAY_LOCK_DIR` is in `/tmp`, a fresh tmpfs (Slack needs it writable) | |

## Install: one command

Run as root: `curl -fsSL https://get.jakebox.dev | sh`. `install/install.sh` does the following:
1. Installs what's missing: Docker, gVisor `20261109.0`, and Node 22.
   - With **apk**, Node is Alpine's `nodejs` package.
   - With **apt**, Node is v22.23.5 from nodejs.org.
   - Either way it then requires Node 22.18 or newer.
   - If dockerd is already running, it signals dockerd to reload, then requires that Docker knows the `runsc` runtime.
2. Downloads JakeBox and Claude Code 2.1.311.
3. Checks every download against a checksum **written into the installer itself**: the gVisor sha512, the Node and Claude Code sha256, and the JakeBox tarball's sha256, which `scripts/release.sh` bakes in. A tampered mirror can't swap a file (I0 tests this).
4. Extracts each release into a clean `/opt/jakebox.new`, owned by root and writable by nobody else, and swaps it in whole, so nothing from an earlier release lingers.
5. Writes `/etc/jakebox/env` (mode 0600). On a re-run it keeps what's there and only fills in missing keys.
6. Starts JakeBox:
   - on a systemd server, with units (`jakebox-firewall` before `docker.service`; `prepare.sh` and the image pull before agentd);
   - otherwise, with `install/host-start.sh`, in the same order.
7. Waits for the **new** app to answer `/health`. Each release carries a build id, and `/health` reports it together with the process start time.
8. Prints the owner sign-up link, `http://IP:8787/setup?code=…`. The first person to open it becomes the owner.

Before agentd starts, `pull-image.sh` pulls the pinned Hermes image and `whatsapp-bridge.sh` prepares the WhatsApp bridge for it (code from the image, dependencies from npm, without optional or install scripts), once per image. If that fails, WhatsApp stays off; JakeBox still starts.

Running the command again with a newer release upgrades in place. It keeps `/data`, the settings, the tokens and the agents. The Hermes image follows each release's pin unless `AGENT_IMAGE` was set as an override. The new app restarts every running agent once, so each mounts the new release's plugin and CLI. After that, every 30 s it restarts any running agent whose files are newer than its start.

## Where it runs

Locally on the Mac, in Docker Desktop. Run `npm run e2e` (`packages/e2e/e2e.sh`). It needs:
- Docker Desktop;
- Node 22.18+ on the Mac;
- 127.0.0.1:8098, :8099 and :8787 free.

What it does:
1. Fingerprints every source file it ships or tests (`results/sources.sha256`), packages release `e2e-1` (`scripts/release.sh`, which also builds the web app) and serves it on the Mac as a stand-in for `get.jakebox.dev`.
2. Empties the cached Docker volume of every container, network and volume, keeping only images.
3. Starts a **bare** `docker:dind` container as the server: Alpine with Docker binaries and nothing of ours. The only preparation is `apk add curl`, because that image has no curl and a real server does.
4. Starts one listener **outside** the server, with an address in each private range (10.99.0.10, 172.29.0.10, 192.168.77.10) and at 169.254.169.254. The server is attached to those networks, so it reaches them and an agent's "blocked" can only come from our firewall.
5. Runs the steps in order:
   - an install from a mirror that serves `jakebox.tgz` with one byte changed, which must be refused;
   - the one-line install (`JAKEBOX_MODEL=test`);
   - **main**;
   - release `e2e-2`, whose image pin names the same image as `docker.io/…`, installed over the running server with the same command and no settings (an upgrade);
   - **after-upgrade**;
   - `docker restart` of the server;
   - **after-restart**.
6. Writes `packages/e2e/results/` (gitignored).

Caches reused between runs:
- Docker images (the 3 GB agent image, postgres);
- Alpine packages;
- the verified Claude Code download.

Because of these caches, the first-time image pull and package downloads aren't re-measured on every run.

## Checks

Every check is automated in `packages/e2e/src/e2e.ts`. Each one records the expected value and the actual one in `results/e2e-<phase>.json`, and `results/e2e-report.md` is one table of them all. The report also compares the tree with `sources.sha256` and fails if any source changed after the run. Checks match exact gateway replies: Hermes's untrusted-content wrapper is stripped first. Connector checks (D5, K*) call the gateway straight from Dev's network with Dev's token: the same door Hermes uses. Hermes itself pauses a server for 59 s after three refused calls in a row. A run passes only when every check passes.

**main**

| ID | What it proves | How |
|---|---|---|
| I0 | A tampered download is refused | On a throwaway server: `tamper.log` has "checksum mismatch: …jakebox.tgz", installer exit 1, no `/opt/jakebox`. The real install then starts from a bare server |
| I1 | One command installs JakeBox | `install.log` has every step and "JakeBox is running", with no checksum or tar warnings |
| I2 | Code root runs is root's | Nothing under `/opt/jakebox` (symlinks aside) is owned by another user or group, or is group/world-writable |
| I3 | The database (holds `auth_secret`) and settings are private | `/data/app` 700 jakebox; its Postgres folder 700 jakebox; `/etc/jakebox/env` 600 root; agent folders 700 root |
| A1 | Setup needs the printed code | Wrong code: 403 on `setupCode`, and setup still open |
| A2 | The installer's link signs up the owner in one step | The install printed the `/setup?code=` link; posting the code with a username and password makes the owner and a session cookie, HttpOnly and SameSite=Strict |
| A3 | Setup closes; sign-in checks the password and doesn't reveal names | Setup again: 403 and closed. Wrong password: 401. Unknown user: 401. Right password: 200 with a session. Five unknown-name sign-ins take 0.5–2× as long as five wrong-password ones |
| A4 | The control MCP takes only OAuth access tokens | No token: 401 with `resource_metadata`; a session cookie alone: 401; a made-up `jbo_` token: 401; signing in with OAuth (register, approve, PKCE) gives a `jbo_` token the rest of the run uses |
| A5 | Only one owner | `list_people` is `[owner]` |
| B1 | One control MCP sets everything up | `create_connection`, two `create_agent`, `create_grant` to Dev only (`list_grants` shows it) |
| B2 | One container per agent | `list_agents`: 2 running |
| B3 | The gateway keeps the DB password | Not in any control MCP reply, the connection and agent API objects, any file in the agent's folders, or the logs |
| C1 | The container spec is block A | `docker inspect`: pinned digest, runsc, 10000:10000, ro root, unprivileged, ALL dropped and none added, no-new-privileges, pids 512, 1 GiB, 1 CPU, exactly one network at `.2`, restart policy `no` |
| C2 | It sees only its own files | Mount list (source → destination) is exactly the 12 expected (the 11 before plus the WhatsApp bridge, read-only), plus 4 tmpfs |
| D1 | Hermes boots under gVisor | Both API servers answer within 4 min |
| D2 | A message in, a reply out | "hello there" → exactly "ECHO: hello there" |
| D3 | A granted agent reads team data only through the gateway | Dev: `n = 42`, `revenue = 9030.00` |
| D4 | No grant, no data | Sales: exactly "Denied: no connection grants postgres_query to this agent." |
| D5 | Even a granted agent can't write, though its DB role can | Control: the role itself deletes 42 rows inside a rolled-back transaction. Through the gateway, `delete`, `nextval()` ("read-only transaction") and `select 1; commit; delete` ("cannot insert multiple commands") all fail. The table still has 42 rows and the sequence is unmoved |
| E1 | Revoke works on the next call | "Denied …" and a new `denied` audit row |
| E2 | Re-grant works on the next call | `seven = 7` |
| E3 | Activity is per connection | `/api/connection-events?connectionId=` lists Dev's calls through Orders DB with Dev's name; Sales' denial (no connection) is listed by `list_connection_events {agentId}` |
| K1 | 15 s limit, which a call can't lift for the next one | `pg_sleep(20)` fails with "statement timeout" in 14–19 s. It fails the same way after a call has set `statement_timeout` to 0 |
| K2 | 1000-row cap | 2000-row query → 1000 rows, `truncated: true` |
| K3 | No data-modifying CTE | `with d as (delete …)` fails; 42 rows |
| K4 | Connections that could escape read-only are refused | A superuser, a `pg_read_server_files` role and a NOINHERIT member of `postgres` each → "Refused: …" |
| K5 | Address guard | 127.0.0.1, `[::ffff:127.0.0.1]`, 169.254.169.254, the gateway's own `10.200.x.1`, 0.0.0.0, `[::1]` and `localhost` (by name) → 7 × "Refused address" |
| K6 | No host override or local files in a DSN | `?host=127.0.0.1` and `?sslrootcert=…` → refused at create |
| K7 | Ambiguous and malformed calls fail cleanly | "More than one connection …"; "Unknown arguments: evil" |
| K8 | Results are whole or refused, never cut | 600 rows (~40 KB) arrive and parse; ~1 MB → "Result too large for the agent"; ~20 MB → "Result too large: over 8 MB"; the app still answers |
| K9 | At most 2 calls per agent per connection at once | 3 parallel 4-second queries: 2 run, 1 "Busy" |
| K10a | TLS through the live gateway | Connections with `sslmode=require`, `verify-full`, `verify-ca` to a TLS Postgres whose certificate comes from a test CA: require gives `ssl: true`; verify-full and verify-ca refuse the untrusted certificate |
| K10b | TLS name checks, with the CA trusted | `pgQuery` in a scratch process that trusts the test CA: `verify-full` right name ok, wrong name fails, untrusted CA fails; `verify-ca` wrong name ok, untrusted CA fails. (The deployed app trusts public CAs only, so this part is checked outside it) |
| D6 | Exactly one audit row per call | Dev's and Sales' outcome counts equal what the test made: allowed / denied / failed |
| F1 | uid 10000 on gVisor's kernel | `/proc/version` says gvisor |
| F2 | It can't change its own limits | Writes **and renames** fail on: config, .env, SOUL.md, skills, hooks, plugins, both channel-approval folders, `platforms/`, `.claude/`, Claude settings, the CLI, root FS |
| F3 | No caps, no sockets | CapEff 0; no Docker or agentd socket |
| F4 | Network allows only the gateway, DNS to its resolver, and HTTPS | From Sales, open: the gateway, 1.1.1.1:443, example.com:443, UDP DNS to its resolver. Blocked: dashboard, Dev's API server, the team DB, the three LAN listeners, 169.254.169.254, 1.1.1.1:80, 8.8.8.8:53 (TCP and UDP), and the mail ports 993/465/587. **Every blocked target answers the server itself** |
| F5 | Own .env readable (accepted risk), nobody else's | Own key visible; C2 shows no other agent's folder mounted |
| F6 | A stolen token is useless elsewhere | Dev's token from Sales: 401; from Dev: 200 |
| F7 | Only agents reach 8081 | From the team DB's network: 8081 gives no HTTP answer at all; 8787 answers |
| P0 | People join only by invite; a link works once and can be revoked | `create_invite` gives a link; `GET /api/invite-links/:token` 200 (member); joining makes a member with a session; the same link again 410; an unknown link 410; a revoked admin link 410 |
| P1 | A member manages their own agent from the dashboard | Create, start, edit instructions over the API with their session (all 200); container running |
| P2 | A member can't overreach | Deleting Dev, granting a private connection, inviting people, removing the owner and setting the seat are all 403; Dev still exists |
| P3 | The owner filter in `reachable()` | Shared: Helper reads `n = 42`. Un-shared: Helper is denied on its next call |
| P4 | A member deletes their own agent | Deleted; container gone |
| P5 | Removing a person ends their access at once | After `delete_person`: their session 401, their OAuth app's token 401, sign-in 401, their running agent stopped, they're off the People list |
| O1 | An MCP client signs in with OAuth | Metadata points at `/mcp/authorize`; dynamic registration; a code with the wrong PKCE verifier fails; the right one gives `jbo_`/`jbr_` tokens; tools work with them; refresh rotates and the old refresh token stops working; Admin lists the app |
| CH1 | Slack checks tokens with Slack | Fake tokens: slack.com answers `invalid_auth`, the API returns 400 on `botToken`, nothing saved |
| CH2 | WhatsApp links from inside the agent | Linking Dev: `.env` has bot mode with the owner's and the allowed number; approvers include the owner's WhatsApp; within 2 min the channel shows a real WhatsApp pairing payload (`2@…`), fetched through the agent's own firewall |
| CH3 | Unlinking WhatsApp cleans up | Deleted; no session files left; no `WHATSAPP_` lines in `.env` |
| U1 | Claude mode renders the seat | In a scratch database with `JAKEBOX_MODEL=claude`, the config has the plugin provider, `sonnet`, and `haiku` for side tasks. `.env` has `CLAUDE_CODE_OAUTH_TOKEN`. No test model |
| U2 | Agents have the pinned CLI and plugin | `claude --version` is 2.1.311 inside Dev; `hermes plugins list` shows the plugin |
| U3 | The seat is set over the control MCP and never shown | `update_admin {seatToken}` ok; `GET /api/admin` says the seat is set; the token isn't in any reply or test-mode `.env` |
| G1 | Stop/start keep the container, and the agent is back fast | exited → running; same container id; its API server answers within max(30 s, 2 × D1's first boot) |
| G2 | Editing instructions restarts the agent, which then uses them | New `StartedAt`. `SOUL.md` read **inside** the container has v2. The agent replies "ECHO: hello again" |
| G3 | Delete cleans up | Container, network and both folders gone |
| W1 | No firewall, no agents | DOCKER-USER jump removed: `/health` 503 `firewall: false`; starting Dev is refused "firewall is off" |
| W2 | The watchdog repairs it | Within 30 s: firewall back, health ok, "re-applied the firewall" in agentd.log. The app then starts Dev, which answers |
| W2b | One missing rule counts, and it's repaired in the right order | AGENT-IN's agent DROP deleted: health 503. Within 30 s: health ok and the chains identical to `firewall.txt` |
| W2c | A rule slipped above a jump is caught | An ACCEPT inserted above INPUT's jump: health 503. Within 30 s: health ok and the jump is INPUT's first rule again |
| K11 | One agent can't tie up the app | 30 connections from Dev with unfinished headers: at most 16 get through the firewall. Then 12 slow uploads of a 900 KB body: all but 8 get 429. `/health` answers meanwhile, and the agent works again afterwards |
| K12 | The gateway's own request limits | From Dev: a 2 MB body → 413; headers left unfinished → 408 or closed after 10–15 s |
| W3 | If it can't repair it, agents stop | Firewall script made unrunnable and jump removed: "stopped 1 agents" in agentd.log, Dev exited, health 503. Once fixed: health ok, Dev running and answering |

**Unit tests** (`npx turbo run test`; `packages/app/test` mirrors `src/`: `team/team-service.test.ts` against a scratch database, `agents/hermes-files.test.ts` on the pure renderer): an invite stores only its token's hash; an expired invite is refused; an admin invite makes an admin who can invite; a taken username leaves the invite unused; two people racing for one invite, exactly one gets in; the owner can't be removed and a removed person can't sign in; the rendered Hermes files for no channel, Slack for listed people (tokens, allowlist with the owner, approvals to the owner's Slack ID) and WhatsApp open to anyone (bot mode, `*`, smart approvals, the owner's WhatsApp approves).

**after-upgrade** (release `e2e-2` installed over `e2e-1` with the same command, no settings passed)

| ID | What it proves | How |
|---|---|---|
| UP1 | Upgrade keeps the settings and agentd follows the new release's pin | "JakeBox is running"; `/etc/jakebox/env` byte-identical (still `JAKEBOX_MODEL=test`, no `AGENT_IMAGE` stored); the new pin is the `docker.io/…` form, and agentd's own `health` reports exactly that image |
| UP2 | The new release replaced the old | `/health` 200 with agentd, build `e2e-1` → `e2e-2`; `/opt/jakebox/BUILD` says `e2e-2`. Exactly 1 agentd and 1 app with new PIDs, 2 supervisors. A file only the old release had is gone |
| UP3 | Data, tokens and agents survive; running agents restart once onto the new release | Old token works. Dev is in the same container. "new build e2e-1 -> e2e-2" in app.log; Dev restarted, its instructions intact, and the plugin folder it mounts is present. Setup is still closed |
| UP4 | Still works | Dev answers `n = 42` |

**after-restart** (`docker restart` of the server)

| ID | What it proves | How |
|---|---|---|
| H1 | Firewall first, agents last | `boot.log` lines in order: firewall applied, dockerd launching, dockerd up, agentd and app. Dev started at least 1 s after the last of them |
| H2 | The same firewall | AGENT, AGENT-IN, both jumps and the `ip rule` are identical to the main phase's `firewall.txt` |
| H3 | JakeBox, not Docker, brings agents back | Dev running and answering within 4 min; restart policy `no`; a new "reconcile: started" line |
| H4 | Still works end to end | Dev answers `n = 42` |
| H5 | Isolation holds after the restart | The F4 probe again, from Dev: every row ok |
| H6 | Health is honest | 200 `{ok, agentd, firewall: true}` |

## Results

All of the following is in `packages/e2e/results/` (gitignored), regenerated by every run:
- `e2e-report.md`, plus `e2e-main.json`, `e2e-after-upgrade.json` and `e2e-after-restart.json`, and `sources.sha256`.
- `tamper.log`, `install.log` and `upgrade.log`, with the setup code redacted.
- `boot.log`, `agentd.log` and `app.log`.
- `dev-container-spec.json`: the applied spec with each mount's source and the image digest.
- `dev-config.yaml`: tokens redacted.
- `firewall.txt`, `activity.json`, and the isolation probes' full matrices.

Screenshots of **this** deployment's dashboard are taken after a passing run, in Chrome through Claude in Chrome, signed in with the run's generated owner account (`results/.test-credentials.json`): Agents, Dev, Orders DB (its Activity lists the run's real gateway calls), Connections, Admin and People. `packages/e2e/src/plan-tab.ts` builds the blueprint's Test plan tab from the three JSON files, this plan's "Not verified here" and "Accepted risks", and those shots.

## Mock parity

The approved mock is the **Mock** tab of the JakeBox blueprint artifact (https://claude.ai/artifact/Ez9NRphiPZsmNdU2kD8JG5). The React dashboard reuses the approved CSS. Parity is checked in Chrome on a laptop instance (`fake-agentd.ts` + `seed-ui.ts`) and on the run's own deployment.

| Mock screen | Built as in the mock | Differences |
|---|---|---|
| Agents, New agent | yes | — |
| Agent: one page, no tabs. Left: name with Reroll on the avatar, instructions preview, skills. Right: status, model dropdown, owner; channels; connections | yes | Slack and WhatsApp work. Skill upload and Reroll are shown but disabled ("Not in this build yet"). The mock's Memories row and per-connection tool access aren't in this build, so the page leaves them out. Stop/Start and Delete have coloured text with a neutral border |
| Connections; a connection: Activity on the left, details, sharing and agents on the right; add Postgres | yes | Sharing with one person isn't in this build; other connector kinds are listed, not installable |
| People: invite person, the invite link, pending invites, remove | yes | The mock's "Add person" with a password became an invite link |
| Admin: Claude seat, Google, Server (Public URL editable), AI assistant (connected apps, access token) | yes | Google, Backups and the 5-hour window are disabled |
| Sign in, owner sign-up, joining by invite, a used invite, the OAuth consent page | yes | Split layout: the form on the left, the agents on the right |

**User sign-off on parity: pending.**

## Not verified here, and how it will be

| Item | Why not here | How |
|---|---|---|
| A live Claude seat turn | Needs the customer's `claude setup-token` | On the Beelink with a real seat: `update_admin {seatToken}`, then one chat per model; isolation plan tests 11, 12, 14, 15 |
| The systemd path: units, `prepare.sh`, firewall-before-Docker ordering under systemd | The test server boots with `host-start.sh` (no systemd in a container) | Fresh Debian 13 on the Beelink: run the curl command, reboot, then run `e2e.ts after-restart` |
| The apt branch, Node from nodejs.org, the installer installing Docker | The test server is Alpine with Docker present | The same Beelink install (Debian without Docker) |
| Boot on non-systemd hosts (OpenRC) | Nothing starts JakeBox at boot there. The installer says so. Agents have no restart policy, so they stay stopped until `host-start.sh` runs | v1 supports systemd hosts for unattended reboots |
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
- **An upgrade keeps each agent's container.** A new release restarts every running agent once and its files are re-rendered, but changes to container flags reach an agent only when it is deleted and created again.
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
