# OpenHut

Agents for a team, self-hosted only (owner, 2026-11-25: `openhut-private: brain/decisions/self-hosted-two-images.md`): one
`curl -fsSL https://openhut.dev | sh` on your own Linux server runs the web app and the runtime. A runtime runs many Hermes agents,
each its own Docker container (under gVisor when the machine allows it, checked at startup), with their own Slack app and WhatsApp
number. Agents reach team data only through the runtime's gateway, which holds every key and checks each agent's grants on every
call. You manage it from the app, or by asking an agent to change its own name, instructions, channels or connections, which you
approve in the app (`openhut-private: brain/decisions/agents-change-themselves.md`). No hosted Cloud, no release signing.
Scope and decisions: `openhut-private: brain/decisions/`.

## Packages

An npm-workspaces monorepo run with Turborepo, laid out like Skyfleet.

- **`packages/runtime`** — `@openhut/runtime`, one runtime: two processes built, shipped and updated as one package.
  `src/server/` is the API (Fastify, Kysely on PGlite), grouped by domain: `platform/` (config, db, secrets, settings,
  errors, evlog logging, the typed agentd client), `team/`, `agents/` (agents, grants), `channels/`,
  `connections/`, `gateway/` (the agents' MCP gateway and key broker on :8081), `admin/`, and `integrations/<service>/`.
  What an agent's Hermes gets comes from plugins: `src/plugins/<name>/index.ts` is `definePlugin({ name, agent, tools, asks, on, slackAction, wakes, start, migrate, routes, afterTurn, connectorCall })`,
  where `agent()` returns that feature's `AgentPart` (instructions, secrets, model auth, sub-agent limits, and Hermes-only config and env under `native.hermes`), and `tools` its MCP tools (zod `input` and
  `run(input, { agent, origin })`). `src/core/` holds no feature code: `plugins.ts` is the ordered list (its order is the
  SOUL.md order; two plugins with one tool name fail at boot), `agent.ts` is `AutonomousAgent`, the only agent interface the server uses (`agent.setup`, `chat`, `content`, `status`, `attach`, `activity`), implemented by
  the Hermes driver in `src/adapters/hermes/`, whose `render.ts` merges the parts into `config.yaml` (written as JSON), `.env`, `SOUL.md` and `auth.json`, and `mcp.ts` serves every plugin's tools on the gateway's MCP server. A tool
  with `local: true` runs inside Hermes instead, `on` maps agent events (`message.arriving`, `reply.drafted`, `subagent.started`, `subagent.stopped`, `content.written`) to handlers, and `slackAction` takes Slack
  buttons by prefix: the one Hermes plugin, `vendor/hermes-plugins/openhut`, registers what `adapters/hermes/events.ts`'s manifest
  lists and calls the gateway's `/tools/<name>`, `/hooks/<hook>` (its `EVENTS` maps each Hermes hook to an agent event) and `/slack-actions` for each (hooks whose answer Hermes ignores, everything but `pre_*` and `transform_*`, are sent from a background thread, so a slow gateway never holds the agent). `wakes` are turns the
  runtime wants the agent to take (routine runs and webhook calls from inbox, answered asks):
  `core/wakes.ts` lists every plugin's due wakes as `[OpenHut <plugin>:<id>] <text>`. The chat plugin runs on the server every app wake and every
  inbox wake for the app or Discord (`runsOnServer`, `nudge(agentId)` runs them at once). The Hermes plugin polls `/wakes` (every 2 s while the gateway is unreachable; when it answers again the plugin wakes Hermes's `openhut` MCP server, which Hermes parks for 300 s after 5 failed reconnects) only for the rest (asks answered in Slack, Telegram or WhatsApp, and their inbox wakes).
  `server/chat/` is the hub for every channel OpenHut runs itself (Discord now): `index.ts` is `chat.receive` (save the inbound messages, then the `chat-turn` durable job, `latest` per thread),
  `chat.send` (an agent post: save, then deliver) and `chat.flush`, with the `chat-deliver` job (`each` per thread) that posts each saved reply and marks it `delivery: sent` or, after the last try, `failed`.
  `bots.ts` (started by the chat plugin's `start`, kept in step with every `agent.*`/`channel.*` event and a 10 s poll; a channel whose gateway isn't connected comes back with `offline`, its reason) runs one Chat SDK bot per running agent with a Discord channel (its gateway resident in the server, state in PGlite through `state-pg`): a mention in an allowed channel starts a Discord thread, a message in a thread we know needs no mention, DMs are dropped, and on start it reads what it missed in threads heard from in the last day.
  Hermes gets no Discord token and no Discord platform; it's reached only through its API. Every thread lives in one channel (`chat_thread.channel`, `web` by default, and `place` for where it posts): a non-web thread is read only on the web (409 on its chat).
  A turn answers every unanswered user message at once (after the newest reply's `metadata.answered`), the Hermes session is the thread id (`<id>.<n>` after a lost turn), and an inbound message's id comes from its platform id, so a replay is saved once.
  A webhook or routine that posts in Discord gets a Discord thread; a webhook's first delivered answer starts the Discord thread. `post_message` and `notify` to Discord go through `chat.send`. Threads besides an agent's own app chat (id = agent id) are `chat_thread` rows (`th_*`). Every turn our server runs (web chat, Discord, app and inbox wakes) goes through `threads/turns.ts`: one queue per agent (a promise chain), and for each thread its turns in memory with every AI SDK `UIMessageChunk` so far, written to `thread_chunk` about once a second. The thread's `activeTurn` is set from the moment a turn is queued until its reply is folded from the chunks and saved. `POST /api/threads/:id/chat` saves the person's message, queues a turn and answers with that turn's stream; `GET /api/threads/:id/stream` replays the running turn from its first chunk and then follows it live (204 when none), which the app's `useChat` uses to resume after a refresh, a thread switch, a dropped connection or in a second tab, whenever the thread says it has an `activeTurn`. A turn runs on its own, not on the request that started it: a person who leaves mid-reply still gets the whole reply saved, and only `POST /api/threads/:id/stop` ends it early (the Hermes adapter then posts `/v1/runs/<chatcmpl id>/stop` before it closes the stream: Hermes queues every turn of a session and keeps a turn running when its request just disconnects, so the next turn would wait behind it in silence). A turn that waits, in our per-agent queue or in Hermes's (the adapter asks `GET /v1/runs/<id>` on each keepalive until the turn speaks), streams a transient `data-status` chunk (`Waiting for an earlier task to finish`, then `''` when it starts) that the app shows under the reply; `hermes.status` events come through the same way. A reply is deleted only when the person asks to regenerate it. At boot a turn cut off by a restart is saved from its chunks with a note. The app's `/api/events` socket only carries what may be lost: `join`/`leave`/`typing` up (`common/src/live.ts`), and `threads/live.ts` keeps each thread's viewers, typing (5 s) and agent state (thinking, working on a step, replying) in memory, sending `presence`; the reply itself never goes over the socket. Every socket also gets `agents` (on connect, then at most every 250 ms when something changes): each agent the person can use with its activity (idle, working, waiting on an ask), status, health, busy or typed-in threads and running sub-agents, so the sidebar never polls. A webhook's message carries `metadata.source` and `metadata.payload`, which `common/src/webhooks/summary.ts` turns into a card. `start()` runs at boot.
  A plugin also owns its tables (`migrate`, run by `platform/db.ts` after the core tables, in list order), its API
  (`routes: () => ({ '/api/<prefix>': controller })`, registered by `app.ts`; two plugins with one prefix fail at boot)
  and a part under the app chat's reply (`afterTurn`, like asks' `data-asks`). The subagents plugin keeps each agent's running sub-agents in memory from the `subagent.started`/`subagent.stopped` events and serves them at `/api/agents/:id/subagents` for the sidebar.
  Anything an agent needs its owner's OK for is an ask: a plugin declares its kinds as `asks: { <kind>: defineAsk({ input, title, run,
  tool?, answer?, declined? }) }`, and `core/asks.ts` owns the rest (the `ask` table, `/api/asks`, an MCP tool per kind with `tool`,
  the notes the agent gets, the sweep that expires them, and one wake per chat once nothing there is open or 30 s after its last answer). Every ask carries a `description` (`AskDescription` in `core/plugin.ts`: one sentence for the owner, 3 to 120 characters), shown under the title on every card and on the answered line; app asks (connect, approval, key) show the app's logo, not the agent's face. Its whole API is `asks.create` (returns the text for the agent) and
  `asks.approve` (owner-checked and idempotent); `run` may run twice after a crash, so keep it repeatable.
  The app builds each ask's card from its `title`, `why` and `form` (the JSON schema of `answer`); a kind with its own row exports it from
  `features/<feature>/asks.tsx` as `rows` (found by `app/asks.ts`, which hands them to the ask cards), like `connect_app`'s checklist row and connect dialog, a kind that only adds to the card exports `extras`, like `update_self`'s instructions diff, `add_webhook`'s address and secret and `add_channel`'s QR step, and a kind with its own card exports `cards`, like `call_tool`'s Allow / Always allow / Not now card (no Always allow for a destructive action). A form field longer than 1000 characters folds the card's fields behind **Edit**. A sign-in
  started for an ask carries its id, and the callback calls `asks.approve` with the new connection.
  Changes reach a running agent live: Hermes re-reads `config.yaml` and `.env` every turn, and agentd runs `hermes sessions refresh-prompts` when `SOUL.md` changes.
  An `agent()` part may set `restart` to what in it needs a restart (default: its config, env and auth; a prompt never does), and `render.ts` hashes
  that with the version, gateway and token into `restart.key`. agentd restarts only when that file changes or a key left `.env` (Hermes never unsets one), and
  with `restart: false` answers `pending` instead; `agentService` then restarts once the agent's gateway has been quiet for `config.quietMs` (10 s; tests
  shorten it), the one path every restart takes (moves and the browser toggle too), and `wakes.due` holds that agent's wakes until it has.
  `connectorCall` may rewrite an app call's arguments just before the connector runs it (`connection-service` `run()`): `plugins/github` signs PR, issue and first-comment bodies with the agent's face there. Git through the gateway's `/u/github` follows two GitHub permissions, `git_read` (Read code, Always allow) and `git_push` (Push branches, Ask first); with Ask first a push needs an approved `call_tool github_git_push` ask for that repo in the last 10 minutes, and a refused git call joins the chat's work line as blocked.
  An agent and its control, memory, skills, routines, channels and messages are rows in the local `record` table
  (`platform/records.ts`, secrets sealed with the install secret); `agents/run-set.ts` applies them to the agents this computer
  runs. A record write updates the database rows (`project`) before it returns, and requests the agent's apply (`agents/apply.ts`): edits answer
  at once, and the apply (agentd files, memory, skills, greetings) runs in the background, one at a time per agent, with `applying` and `applyError`
  on the agent and `agent.applying` / `agent.applied` / `agent.apply_failed` events; Retry is `POST /api/agents/:id/apply`, and an app chat waits up to 20 s
  for a pending apply. Work that must survive a crash goes through `core/durable.ts`: `durable(name, mode, run)` returns `{ send(key, data) }`, on
  pg-boss in the same PGlite (its own `pgboss` schema), started by `startDurable()` after the migrations. Mode `latest` keeps one running and one
  queued job per key, so a burst collapses; mode `each` runs every job, in order per key. A job that throws runs again (5 retries, 15 s heartbeat,
  so a crashed run resumes within seconds), and `run` learns when it is on its last try. Two rules: a `run` must be safe to run twice, and `send`
  comes after the change it acts on is saved. Tests set `OPENHUT_DURABLE_INLINE`, which runs a task inside `send()`. People sign in with a session cookie (`team/identity.ts`, `team/team-service.ts`): while there is no owner, the first
  visitor creates the owner account (and sets the HTTPS address); everyone else joins by invite link; roles owner, admin, member.
  `docker exec -it openhut openhut reset-owner` (new owner password) and `openhut address [url|clear]` use the local socket. The address (`platform/address.ts`, Settings ›
  Admin) sets the cookie's Secure flag, every redirect URL and the Caddyfile: Caddy in the image serves :80, and once the address
  is set gets its Let's Encrypt certificate and serves HTTPS on :443. `npm run dev` and the tests use `OPENHUT_DEV_KEY_SHA256`
  instead, a key that acts as the owner. The server also serves the built App (`platform/web-app.ts`).
  `src/agentd/` is the root helper on a Unix socket in openhut-runtime, the only process that starts agents: `sandbox/docker.ts` runs each one
  as a container (`--runtime runsc` when a probe at boot finds gVisor works; health says `gvisor`), `sandbox/memory.ts`
  is the tests' fake (`OPENHUT_FAKE_SANDBOX=1`). `agents.ts` and `commands.ts` know no Hermes: the container spec, home layout,
  conf files and `state.db` are `adapters/hermes/` (`hermesBox`), and the firewall, fence, link, subnets and ports are `network/`. Tests mirror them in `test/server/` and `test/agentd/`.
- **`packages/app`** — `@openhut/app`, the App: the React dashboard (Vite to `dist`, built into the image and served by the runtime on the same origin, TanStack Query). Tailwind v4 with shared
  components in `src/components/ui` (shadcn on Base UI); screens use those, not their own styles. Laid out like bulletproof-react:
  `app/` (`provider.tsx`, `routes/`, `layout/`) composes the features; a feature (`features/<name>/`, the big ones split into `api/`
  and `components/`, agents' channel dialogs in `agents/channels/`) never imports `app/` or another feature, and gets another
  feature's piece as a slot or children from its route; shared code is `components/`, `lib/` (shared reads in `lib/queries/`, every
  query key in `lib/query-keys.ts`) and `config/` (paths, the app catalog), and imports neither. `test/boundaries.test.ts` enforces it.
- **`packages/common`** — `@openhut/common`, the API contract: Zod Mini request schemas and response types.
- **`packages/site`** — openhut.dev: the home page, the brand page and `/` for curl, served by a Cloudflare Worker with static assets
  (`wrangler.jsonc`, `src/worker.ts`) that `.github/workflows/deploy.yml` deploys after CI passes on `main`. Its own npm package
  with its own lock, not a workspace (wrangler stays out of the root lock): `npm --prefix site ci`, then `run typecheck` and `test`.
- **`packages/docs`** — openhut.dev/docs: Fumadocs on TanStack Start, prerendered to static files (`content/docs/*.mdx`, order in
  `meta.json`) plus `/docs/llms.txt`; the site's `deploy` builds it and `src/build.ts` copies it into the Worker's assets.
  `/install` redirects to `/docs/install/`. **Docs live in `packages/docs`; any PR that changes what a user sees or does updates
  the matching page in the same PR.**

`install/` is the server, two images from one `install/Dockerfile` (`scripts/image.sh` builds both and pins them into
`install.sh`): `ghcr.io/openhuthq/openhut` (`--target main`: Node, the Docker CLI, the tree and the built App; entrypoint
`install/main-start.sh`) runs the web app and the server as the container `openhut` (not privileged, read-only root, the host's
Docker socket, data in `openhut-data`, network `openhut`, 127.0.0.1:8787, ports 80 and 443 for Caddy; `install.sh proxy <port> [network]` publishes only 127.0.0.1:<port>, joins that Docker network, skips Caddy and keeps it as `OPENHUT_PROXY` env for updates), prints the address to open, and goes back to the previous container if the new one fails its health check. On first boot it starts
its own runtime with `install.sh join http://openhut:8787 <token>`. `ghcr.io/openhuthq/openhut-runtime` (`--target runtime`:
dockerd, gVisor, Claude Code pinned by `ARG CLAUDE`, agent-browser, the WhatsApp bridge and the pinned Hermes agent image, so
nothing downloads on the server; entrypoint `install/runtime-start.sh`) runs agentd and `agentd/network/link.ts`, privileged, no open
port, data in `openhut-runtime-data`. Other machines run only that: `curl … | sh -s -- join <address> <token>` from
Settings › Computers. The link is one outbound WebSocket to `/api/computers/link` carrying the `common/src/tunnel/mux.ts`
streams (frames.ts): the main opens agentd, agent-API and home-copy streams, the runtime opens gateway streams, so model keys
stay on the main. `relay/forward.ts` routes each agent's calls to the computer that runs it (`agent.runs_on`; `here` is the
main's own runtime). Runtimes follow the main: its welcome names its paired runtime image, and a runtime on another one runs
`install.sh join` in a one-shot `openhut-runtime-update` container, which goes back on failure and labels the image failed.
The main also runs `openhut-updater` (`install/updater.sh`): Settings › Updates has the server write `/data/update/request`
with the sha256 of the install.sh it checked at `OPENHUT_URL`, and the updater runs that install.sh if it still matches.
`.github/workflows/runtime-image.yml` builds both (linux/amd64 and linux/arm64, each on its own native runner),
smoke-tests (`scripts/image-smoke.sh`) and pushes them by commit; run it by hand with `tags` to get images for a branch.
`promote.yml` is the release: it runs it for main's newest green commit (the smoke when `smoke` is on), tags both images
`stable` and publishes that install.sh (pinned by digest, with `OPENHUT_BUILD`) where openhut.dev/ redirects. `vendor/` is the pinned Hermes plugin.

## Conventions (Skyfleet's)

- The API is resource-oriented with Stripe's shapes: flat collections, `{ object: 'list', url, hasMore, data }`,
  `{ id, object, deleted: true }`, `{ error: { type, message, param? } }`.
- A module is `<name>-service.ts` (a deep `xService = {}`, the only layer that touches the database or agentd) and
  `<name>-controller.ts` (one-line handlers, request schemas at the end as `const FooRequest = { schema }`).
  `app.ts` only registers controllers (the core ones, then each plugin's `routes`). `platform/config.ts` is the only file that reads env vars (agentd has `agentd/config.ts`).
- Outside services live in `integrations/<service>/`; core reaches them by kind.
- The dashboard reads server data with `useQuery`/`useMutation` and writes responses back with `setQueryData`; forms
  are uncontrolled; which dialog is open lives in the URL.
- Skyfleet's `brain/coding-style.md` applies in full: no comments in executable code (reasons go in the brain,
  `openhut-private: brain/`), exported functions with more than one parameter take one object, no nested ternaries,
  no `any`, only `HttpError` throws with sentences for messages, tests mirror source paths, logging through evlog.
- Single quotes, no semicolons, `.ts` imports; Node 22.18+ runs the TypeScript directly.
- UI follows `DESIGN.md`; run its "Checks before merging UI" before a screen change merges.

## The brain

The notes and decisions live in the private repo `openhuthq/openhut-private`, under `brain/` (written here as
`openhut-private: brain/...`). Nothing in this repo depends on it; everything here is MIT.

## Shipping

One PR per feature. A feature and its dependent steps go on one branch, built by one agent: no milestone PRs that wait
on each other's merges and get rebased onto main one by one. Split work across agents only when the parts are truly
independent (different files, no ordering).

CI is not part of the edit loop. Iterate locally (`npm run check`, one test file, the dev app) until it is green, then
push once and open the PR. After one review round with no open blocker, run `gh pr merge --auto --merge` and stop: no
`gh run watch`, `gh pr checks` or sleep loops (the account's API limit is 5000/h, shared by every agent). If `gate`
fails, auto-merge waits; fix it and push again. The main ruleset has no bypass, so a red `gate` means fixing it, never
forcing it. CI (`ci.yml`, Linux only) is typecheck, the tests (split in six, `TEST_SHARD`) and the browser
run; `gate` waits on all of them. CI builds no image; Promote does. Deploy then ships main's newest green
commit to openhut.dev. Reviewer loop and flaky tests: `openhut-private: brain/openhut-deploy.md`.

## Dev loop

OpenHut is a web app. The dashboard runs on localhost in a browser with hot reload, against the real runtime. The procedure
is the `openhut-dev-loop` skill (`.agents/skills/`, linked from `.claude/skills`).

| Command | What it does |
|---|---|
| `npm run dev` | agentd, the runtime server and Vite on localhost. The everyday loop |
| `npm run demo` | The real app with sample agents and nothing else: in-memory agents, the test model, a throwaway data folder, Vite on 127.0.0.1. No Docker or keys; Linux or Mac, headless. For agents that need to look at the app |
| `npm run seed` | Sample agents and connections in the running dev app (on a fresh `.data`) |
| `npm run reset` | Wipe `.data` |
| `npm run check` | Typecheck and test only what changed since `origin/main` |
| `npm run test` / `typecheck` / `build` | Everything |

`npm run dev` starts agentd with the Docker sandbox, the server API on 127.0.0.1:8797 with `.data`, the dev key `dev`
enrolled, the real model and real outside services (connect Claude in Settings), and Vite with `/api` proxied to it with
`Authorization: Bearer dev`, so the app opens straight into the shell. Agents start only where the agents firewall applies
(Linux, agentd as root); on a Mac the screens and the API work: off Linux `npm run dev` runs agents in agentd's in-memory sandbox with the test model (`OPENHUT_FAKE_AGENTS` makes them count as answering), so nothing shows red; set `OPENHUT_FAKE_SANDBOX=false` for Docker. Ports (API 8797, gateway 8091) step to the next free one, so
it runs beside other checkouts. Ctrl-C stops everything.

## Test

`npm run check` typechecks and tests what changed; `npx turbo run build typecheck test` does everything. The server path
(install, an agent in gVisor answering a chat, rollback on a failed health check) is the runtime image smoke
(`scripts/image-smoke.sh`, in `runtime-image.yml`). The browser path (the shell with no sign-in, Settings › Computers) is
`scripts/web-e2e.sh`, in CI.
