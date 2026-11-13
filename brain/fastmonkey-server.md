# How the Fast Monkey server works

The code carries no comments (Skyfleet's coding style), so the reasons live here.

## Processes and ports
- `:8787` is for people: the JSON API, the web app and the control MCP (`/mcp`). `:8081` is for agents only: the
  gateway. The firewall drops everyone else on 8081.
- The app never touches Docker. agentd does, as root, on a Unix socket with a fixed command set, one command at a
  time per agent.
- Agents have no Docker restart policy, so nothing starts them before the firewall. The app keeps the ones marked
  running running (reconcile, every 30 s). At start it re-renders every agent's files, so a new release, model mode
  or seat reaches agents created before it. A new release (`BUILD`) restarts every running agent once, so each
  mounts the new plugin and CLI; the build is recorded only when every agent took it, so a failed restart is retried
  at the next start.
- `/health` is 503 unless agentd answers and its firewall check passes. `started` tells the installer this process
  from the one it replaced.

## Data and secrets
- PGlite (Postgres in WASM) in `FASTMONKEY_DATA`, through Kysely's own PGlite dialect, which runs one query or
  transaction at a time (PGlite is single-user). `install_setting` is created at import time because settings and the
  auth secret load then.
- `auth_secret` is created once; it keys every seal (AES-256-GCM) and every agent token.
- Agent token: `<id>.<hmac>` = HMAC(auth_secret, id). Nothing is stored; a deleted agent's token matches no row. The
  gateway also requires the call to come from the agent's own `/24`.
- Passwords: scrypt off the event loop (so sign-ins can't stall the gateway). An unknown name hashes a dummy, so
  timing doesn't reveal which names exist.
- `connection_event` has no foreign keys: calls stay in the audit after their agent or connection is deleted.

## People
- The first person, holding the installer's setup code, becomes the owner. A partial unique index on `role='owner'`
  makes a second owner impossible even if two sign-ups race. The owner's address becomes the Public URL until Admin
  changes it; invite links and the MCP prompt use it.
- Invites: only the token's hash is stored. Accepting is one transaction whose conditional update
  (`used_at is null and expires_at > now()`) is the single-use check.
- Removing a person keeps their row (agents and connections point at it) but deletes their sessions, OAuth grants and
  open invites, and stops their agents. Every access check treats a removed person as absent, so their agents lose
  every connection on the next call.
- Pages never send a Referer and can't be framed: setup and invite links carry secrets in the URL.
- The app trusts `X-Forwarded-Proto`/`-Host` only from 127.0.0.1 and ::1, so a TLS proxy on the same server (Caddy on
  monkey.activepieces.dev) makes the owner's first visit record an `https://` Public URL. Nobody else can spoof them.
- The control MCP takes only OAuth access tokens, never the session cookie, so another site can't drive it through a
  browser. Its 401 points MCP clients at the OAuth metadata. Its tools call the HTTP API in-process (`app.inject`), so
  they get the same validation, permissions and response shapes as the dashboard.

## Connections and the gateway
- A person can use a connection they own or one shared with everyone. An agent reaches a connection only while it
  holds a grant and its owner can use it, checked live on every call; un-sharing or removing the owner cuts it off
  at once, and grants need no restart.
- Editing an agent needs edit rights on it and access to every connection it holds, so nobody borrows a teammate's
  login through an agent.
- The gateway is plain `node:http`, so its limits are explicit: 8 requests in flight per agent, 1 MB bodies, headers
  within 10 s, 60 s per request; at most 2 calls per agent per connection at once.
- Postgres DSNs are parsed into explicit fields; any query parameter but `sslmode` is refused, because `pg` lets them
  override the host (`?host=`) or read local files (`?sslrootcert=`). `sslmode` keeps libpq's meanings, `prefer` by
  default: `pg` has no prefer/allow, so the connector tries TLS without verification, then plain (`allow` the other way).
- The address guard (`BlockList`, IPv4-mapped forms too) refuses loopback, "this host", link-local and agent networks.
  The gateway connects to the address it checked, but checks TLS against the DSN's name. Every HTTP integration
  (Convex, MCP servers, Google, OAuth discovery) goes through `guardedFetch`, an undici connector that checks the
  address of every socket it opens, so redirects and IP-literal URLs are covered too.
- Each kind is a `Connector` (`integrations/connector.ts`): `tools` and `call`. Tool lists are cached per connection
  for 5 minutes. Calls to signed-in connections run one at a time per connection, so a rotated refresh token is never
  used twice. Connection decisions: `decisions/fastmonkey-connections.md`.
- A read-only transaction doesn't stop `COPY … TO PROGRAM` or server-file access, so roles that are superusers,
  members of one, or hold `pg_execute_server_program` / `pg_*_server_files` are refused. Each query runs through a
  cursor in the extended protocol: one SELECT/VALUES statement, at most 1001 rows in memory, 8 MB on the wire, and a
  reply over 64 KB is an error rather than a silently cut one.
- `FASTMONKEY_MODEL=test` serves a deterministic OpenAI-compatible model on the gateway port: `sql: <query>` makes it call
  `call_tool` with `postgres_query`, a tool result is echoed back, anything else is echoed. Runs are free and repeatable.

## Channels
- Slack: each agent is its own Slack app in Socket Mode, so nothing reaches into the server. The app checks the bot
  token (`auth.test`) and the app-level token (`apps.connections.open`) with Slack before saving them. Channels need
  an @mention; strangers' messages are dropped without a reply.
- WhatsApp: each agent gets its own number in bot mode. The bridge drops anyone not allowed before Hermes sees them.
  agentd runs the bridge's pairing mode inside the agent's container and keeps the latest QR payload; only people who
  can edit the agent see it. Approvers are compared as `<digits>@s.whatsapp.net`.
- An agent anyone can message uses Hermes's `smart` approvals; approvals go to the owner (email, Slack ID, WhatsApp).

## Chat (threads)
- One chat per person per agent: `POST /api/threads {agentId}` returns that person's thread, creating it the first time. `POST /api/threads/:id/chat` takes only the new user message (or a retry, which drops our stored last answer and resends the message).
- Hermes keeps the history: each turn sends `X-Hermes-Session-Id: fastmonkey-<thread id>` and only the new message, so Hermes loads the session from its own `state.db` and its compression sticks (sending the whole thread made it summarize again every turn, and sessions derived from the first message collided). Our `thread.messages` is only what the dashboard shows. Research: https://claude.ai/artifact/SVAPXrNB9c78UUspB3M7KG
- The reply is relayed as the AI SDK UI message stream: text parts, `data-tool` for each `hermes.tool.progress` event, then `data-calls` with the `connection_event` rows the agent wrote during the turn (allowed, denied, failed). The answer is saved in `onEnd`, also when the person stops it.
- `health` comes from `GET /v1/models` on the agent (3 s timeout, cached 5 s, re-probed by reconcile every 30 s). Starting until it has failed for 3 minutes in a row, then not answering. `status` stays the container state, which the e2e run checks.
- Admin › Containers › View opens a dialog of cards with `docker ps -a` for agent containers (agentd's read-only `containers` command) next to each agent's wanted state; rows that disagree are tinted. Agents with no container show as `none`, and reconcile recreates the container for one that should run. In Claude mode with no seat, health is not answering: Hermes is up but its model can't sign in.
- `FASTMONKEY_AGENT_API` points every agent at one URL; dev (`scripts/fake-agentd.ts` serves a fake Hermes on :18642) and the unit tests use it. `PORT` moves the app off 8787.

## Claude seat from the browser
- Admin › Claude seat › Set up opens a blank tab on the click (so the popup isn't blocked), then runs the bundled Claude Code's `setup-token` on the server (`admin/seat-sign-in.ts`), the way Skyfleet runs `claude auth login` (`skyfleet brain/decisions/sign-in-to-claude-from-the-web.md`). The dashboard opens its claude.ai link; the pasted code is typed into it and the 1-year token it prints becomes the seat, as if pasted.
- `setup-token` prints nothing without a terminal, so it runs under `script -qfec` (util-linux) with `stty cols 4000` so the token stays on one line. The link comes from the OSC 8 hyperlink, not the wrapped text. An open sign-in lives in memory for 10 minutes in a temp `CLAUDE_CONFIG_DIR`.

## Conventions the code relies on
- Every agentd reply is validated with a Zod schema per command (`platform/agentd.ts`); a reply that doesn't match is a
  502 that says agentd and the app may be different releases. Keep the fake agentd's replies in step. agentd's own
  follow-up work (the restart after WhatsApp pairing) goes through the same per-agent queue as a closure, not a
  socket command.
- `findRow` (`platform/db.ts`) is a raw `select *`: Kysely's builder can't take the table as a type parameter. It
  refuses ids not shaped `<prefix>_<8 chars>` before querying. Connections keep their own lookup so it never loads the
  sealed config.
- Updates pass the parsed patch straight to `.set()`: Kysely skips undefined fields, and `atLeastOneField` runs on the
  parsed body (unknown keys already stripped), so an empty patch is a 400 and never reaches SQL.
- Audit events go through `record({ action, actor, target })` (evlog), e.g. `person.removed`, `agent.created`,
  `connection.shared`, `oauth.app_connected`. Background work logs structured fields (`build.applied {from, to}`,
  `reconcile.started {agent}`), never free text; tests match on those fields.
- OAuth endpoints answer RFC 6749 errors (`{ error: 'invalid_grant', error_description }`); everything else uses the
  Stripe error shape.

