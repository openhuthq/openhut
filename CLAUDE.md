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
  What an agent's Hermes gets comes from plugins: `src/plugins/<name>/index.ts` is `definePlugin({ name, hermes, tools })`,
  where `hermes()` returns that feature's SOUL.md paragraph, config and env, and `tools` its MCP tools (zod `input` and
  `run(input, { agent, origin })`). `src/core/` holds no feature code: `plugins.ts` is the ordered list (its order is the
  SOUL.md order; two plugins with one tool name fail at boot), `hermes.ts` merges the parts into `config.yaml` (written as
  JSON), `.env`, `SOUL.md` and `auth.json`, and `mcp.ts` serves every plugin's tools on the gateway's MCP server.
  An agent and its control, memory, skills, routines, channels and messages are rows in the local `record` table
  (`platform/records.ts`, secrets sealed with the install secret); `agents/run-set.ts` applies them to the agents this computer
  runs. People sign in with a session cookie (`team/identity.ts`, `team/team-service.ts`): while there is no owner, the first
  visitor creates the owner account (and sets the HTTPS address); everyone else joins by invite link; roles owner, admin, member.
  `docker exec -it openhut openhut reset-owner` (new owner password) and `openhut address [url|clear]` use the local socket. The address (`platform/address.ts`, Settings ›
  Admin) sets the cookie's Secure flag, every redirect URL and the Caddyfile: Caddy in the image serves :80, and once the address
  is set gets its Let's Encrypt certificate and serves HTTPS on :443. `npm run dev` and the tests use `OPENHUT_DEV_KEY_SHA256`
  instead, a key that acts as the owner. The server also serves the built App (`platform/web-app.ts`).
  `src/agentd/` is the root helper on a Unix socket in openhut-runtime, the only process that starts agents: `sandbox/docker.ts` runs each one
  as a container (`--runtime runsc` when a probe at boot finds gVisor works; health says `gvisor`), `sandbox/memory.ts`
  is the tests' fake (`OPENHUT_FAKE_SANDBOX=1`). Tests mirror them in `test/server/` and `test/agentd/`.
- **`packages/app`** — `@openhut/app`, the App: the React dashboard (Vite to `dist`, built into the image and served by the runtime on the same origin, TanStack Query). Tailwind v4 with shared
  components in `src/components/ui` (shadcn on Base UI); screens use those, not their own styles.
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
nothing downloads on the server; entrypoint `install/runtime-start.sh`) runs agentd and `agentd/link.ts`, privileged, no open
port, data in `openhut-runtime-data`. Other machines run only that: `curl … | sh -s -- join <address> <token>` from
Settings › Computers. The link is one outbound WebSocket to `/api/computers/link` carrying the `common/src/tunnel/mux.ts`
streams (frames.ts): the main opens agentd, agent-API and home-copy streams, the runtime opens gateway streams, so model keys
stay on the main. `relay/forward.ts` routes each agent's calls to the computer that runs it (`agent.runs_on`; `here` is the
main's own runtime). Runtimes follow the main: its welcome names its paired runtime image, and a runtime on another one runs
`install.sh join` in a one-shot `openhut-runtime-update` container, which goes back on failure and labels the image failed.
The main also runs `openhut-updater` (`install/updater.sh`): Settings › Updates has the server write `/data/update/request`
with the sha256 of the install.sh it checked at `OPENHUT_URL`, and the updater runs that install.sh if it still matches.
`.github/workflows/runtime-image.yml` builds, smoke-tests (`scripts/image-smoke.sh`) and pushes both; `promote.yml`
smoke-tests main's newest green commit, tags both images `stable` and publishes its install.sh (pinned by digest, with
`OPENHUT_BUILD`) where openhut.dev/ redirects. `vendor/` is the pinned Hermes plugin.

## Conventions (Skyfleet's)

- The API is resource-oriented with Stripe's shapes: flat collections, `{ object: 'list', url, hasMore, data }`,
  `{ id, object, deleted: true }`, `{ error: { type, message, param? } }`.
- A module is `<name>-service.ts` (a deep `xService = {}`, the only layer that touches the database or agentd) and
  `<name>-controller.ts` (one-line handlers, request schemas at the end as `const FooRequest = { schema }`).
  `app.ts` only registers controllers. `platform/config.ts` is the only file that reads env vars (agentd has `agentd/config.ts`).
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

Open the PR with the first push, and leave one background `gh run watch <id> --exit-status --interval 120` to hear
when CI ends (no polling loops: the account's API limit is 5000/h, shared by every agent). After one review round
with no open blocker and CI green, merge with `gh pr merge --merge` (no auto-merge). The main ruleset has no bypass, so a
red `gate` means fixing it, never forcing it. CI (`ci.yml`, Linux only) is checks (typecheck, tests, the site), the browser
run and, on `main`, the runtime image pushed by commit; `gate` waits on all of them. Deploy then ships main's newest green
commit to openhut.dev. Reviewer loop and flaky tests: `openhut-private: brain/openhut-deploy.md`.

## Dev loop

OpenHut is a web app. The dashboard runs on localhost in a browser with hot reload, against the real runtime. The procedure
is the `openhut-dev-loop` skill (`.agents/skills/`, linked from `.claude/skills`).

| Command | What it does |
|---|---|
| `npm run dev` | agentd, the runtime server and Vite on localhost. The everyday loop |
| `npm run seed` | Sample agents and connections in the running dev app (on a fresh `.data`) |
| `npm run reset` | Wipe `.data` |
| `npm run check` | Typecheck and test only what changed since `origin/main` |
| `npm run test` / `typecheck` / `build` | Everything |

`npm run dev` starts agentd with the Docker sandbox, the server API on 127.0.0.1:8797 with `.data`, the dev key `dev`
enrolled, the real model and real outside services (connect Claude in Settings), and Vite with `/api` proxied to it with
`Authorization: Bearer dev`, so the app opens straight into the shell. Agents start only where the agents firewall applies
(Linux, agentd as root); on a Mac the screens and the API work. Ports (API 8797, gateway 8091) step to the next free one, so
it runs beside other checkouts. Ctrl-C stops everything.

## Test

`npm run check` typechecks and tests what changed; `npx turbo run build typecheck test` does everything. The server path
(install, an agent in gVisor answering a chat, rollback on a failed health check) is the runtime image smoke
(`scripts/image-smoke.sh`, in `runtime-image.yml`). The browser path (the shell with no sign-in, Settings › Computers) is
`scripts/web-e2e.sh`, in CI.
