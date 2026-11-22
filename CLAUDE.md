# OpenHut

Self-hosted agents: the OpenHut app (Mac and Linux) is a thin window over several runtimes, one on this computer and one
on each computer you add (`private/brain/decisions/app-aggregates-runtimes.md`). A runtime runs many Hermes agents, each in its
own process (a plain process that runs as you on a Mac or Windows PC, a gVisor sandbox in Docker on Linux), with their own Slack app and WhatsApp number. Agents reach team
data only through the runtime's gateway, which holds every key and checks each agent's grants on every call. You manage
it from the app or from your own AI assistant over the control MCP. No sign-in and no people: the app reaches the local
runtime on a 0600 Unix socket, and a remote one end-to-end encrypted either straight over your tailnet (installed and paired over Tailscale SSH, no cloud) or through the relay after it joined with a code (`private/brain/decisions/two-ways-to-reach-a-computer.md`).
Scope and decisions: `private/brain/decisions/openhut-v1-scope.md`.

## Packages

An npm-workspaces monorepo run with Turborepo, laid out like Skyfleet.

- **`packages/runtime`** — `@openhut/runtime`, one runtime: two processes built, shipped and updated as one package.
  `src/server/` is the API (Fastify, Kysely on PGlite), grouped by domain: `platform/` (config, db, secrets, settings,
  errors, evlog logging, the typed agentd client), `team/` (identity: the socket or the enrolled key, and the one owner),
  `agents/` (agents, grants, their Hermes files), `channels/`, `connections/`, `gateway/` (the agents' MCP gateway and
  key broker on :8081), `mcp/` (the control MCP on `/mcp`, whose tools call the API in-process), `admin/`, and
  `integrations/<service>/`. `src/agentd/` is the root helper: the only process that starts agents (gVisor on Linux, native on
  Mac and Windows: a plain Hermes process per agent, or memory, `private/brain/decisions/sandbox-module.md`), on a Unix socket. Tests mirror them in `test/server/` and `test/agentd/`.
- **`packages/desktop`** — `@openhut/desktop`, the Mac and Linux app (`private/brain/decisions/desktop-app.md`): Electron main (`src/main.mjs`, starts agentd and the server,
  serves the renderer on `app://openhut`) and the React dashboard in `src/renderer` (Vite to `dist/renderer`, TanStack
  Query), which calls `/api/*` on `app://openhut`; the main process forwards it to the runtime's socket. Tailwind v4 with shared components in `src/renderer/src/components/ui` (shadcn on Base UI); screens use those, not their own styles (`private/brain/decisions/dashboard-uses-tailwind-and-shadcn.md`).
- **`packages/common`** — `@openhut/common`, the API contract: Zod Mini request schemas and response types.
- **`packages/tunnel`** — `@openhut/tunnel`, the encrypted tunnel (through the relay, or fed by any pipe through `sessions()`, which the runtime's tailnet port uses): Noise IK on `noise-handshake`,
  the frame codec, `connect` (device, runs in browsers too) and `serve` (computer).
- **`packages/e2e`** — `@openhut/e2e`, the end-to-end run: a bare Linux server in Docker, the curl install of a remote
  runtime with an enrolled key, a tampered upgrade, the upgrade and a restart. Results go to `packages/e2e/results/` (gitignored).
- **`packages/docs`** — `@openhut/docs`, the docs at openhut.dev/docs: Fumadocs on TanStack Start, prerendered. MDX in
  `content/docs`, real dashboard screenshots in `public/screenshots`. Notes: `private/brain/openhut-site.md`.
- **`private/site`** — `@openhut/site`, openhut.dev, in the private submodule (see Private half below): `install.sh` for curl, the release tarball, the home page, the brand page
  and the built docs, served by a Cloudflare Worker with static assets (`wrangler.jsonc`, `src/worker.ts`) that
  `.github/workflows/deploy.yml` deploys on every push to `main`. The e2e run serves its releases with the same Worker
  under `wrangler dev`. Deploys: `private/brain/openhut-deploy.md`.

`install/` is the installer of a remote runtime and what it runs on the server (firewall, systemd units, boot script); `scripts/release.sh`
builds what `openhut.dev` serves; `vendor/` is the pinned Hermes plugin.

## Conventions (Skyfleet's)

- The API is resource-oriented with Stripe's shapes: flat collections, `{ object: 'list', url, hasMore, data }`,
  `{ id, object, deleted: true }`, `{ error: { type, message, param? } }` (`private/brain/decisions/openhut-api-follows-skyfleet.md`).
- A module is `<name>-service.ts` (a deep `xService = {}`, the only layer that touches the database or agentd) and
  `<name>-controller.ts` (one-line handlers, request schemas at the end as `const FooRequest = { schema }`).
  `app.ts` only registers controllers. `platform/config.ts` is the only file that reads env vars.
- Outside services live in `integrations/<service>/`; core reaches them by kind.
- The dashboard reads server data with `useQuery`/`useMutation` and writes responses back with `setQueryData`; forms
  are uncontrolled; which dialog is open lives in the URL.
- Skyfleet's `brain/coding-style.md` applies in full: no comments in executable code (reasons go in `private/brain/`, see
  `private/brain/openhut-server.md`), exported functions with more than one parameter take one object, no nested ternaries,
  no `any`, only `HttpError` throws with sentences for messages, tests mirror source paths, logging through evlog.
- Single quotes, no semicolons, `.ts` imports; Node 22.18+ runs the TypeScript directly.

## Private half

`private/` is the submodule `openhuthq/openhut-private`: the site (`private/site`) and the brain (`private/brain`). It
isn't published; everything outside it is MIT and builds and tests without it, so nothing outside `private/` may import
from it. Why, and how deploys reach it: `private/brain/decisions/private-submodule.md`.

- `npm install` checks it out in a fresh clone or worktree and installs the site's own deps (`scripts/private.sh`); a
  clone without access skips it quietly. The site is its own npm package with its own lock, not a workspace, so the
  public lock never mentions it. Run its checks with `npm --prefix private/site run typecheck` and `test`.
- A change inside `private/` is two commits: commit in `private/` on its `main` and push, then commit the new pointer
  here. `git push` here pushes `private/` first (`push.recurseSubmodules=on-demand`, which `scripts/private.sh` sets).
  A brain-only change needs no pointer bump unless the parent should pin it.

## Shipping

When a change is done and checked, merge it to `main` without asking (owner, 2026-11-13). Merging deploys openhut.dev.

## Local dev

```
npm install
npm run dev
```

`npm run dev` starts the real agentd with `OPENHUT_SANDBOX=memory` (no root, no Docker), the server API on 127.0.0.1:8787
with `.data`, the test model and the dev key `dev` enrolled, and Vite for the renderer with `/api` proxied to it with
`Authorization: Bearer dev`. Open `http://localhost:5173`. Port 8787 taken (Docker or another checkout)? `PORT=8797 npm run dev` moves the API and Vite's proxy; Vite picks the next free port itself. Another checkout's `npm run dev` already running? Also set `OPENHUT_FAKES_PORT` (fake Hermes, 18642) and `OPENHUT_GATEWAY_PORT` (8081). `node scripts/seed-ui.ts` (on a fresh `.data`) fills in sample
agents and connections. Native agents need the bundled runtime: `npm -w @openhut/desktop run pack-backend` (needs `uv`). The desktop app itself: `npm -w @openhut/desktop run build && npm -w @openhut/desktop start`. It keeps
its data in `~/Library/Application Support/OpenHut Dev`, apart from the installed app's `OpenHut`.

## Build the desktop app

`npm -w @openhut/desktop run dist` builds the renderer, bundles the runtime's server and agentd with esbuild into
`packages/desktop/dist/backend` with the Hermes runtime, Node, Claude Code and agent-browser for the build's platform (`scripts/pack-hermes.mjs`, pinned in `install/native-runtime.json`; nothing downloads on first run) (`scripts/pack-backend.mjs`; on Linux it packs only the client and the MCP bridge, since the install in Docker brings the rest), and runs electron-builder (`electron-builder.yml`): an arm64,
macOS 14+ `release/mac-arm64/OpenHut.app`, `release/OpenHut-arm64.dmg` and the versioned zip. It signs with the Developer ID
in the login keychain (hardened runtime, `build/entitlements.mac.plist`) and never notarizes (`notarize: false`): only the
release workflow (`.github/workflows/desktop.yml`, `scripts/notarize.sh`) notarizes, staples and checks a build. The packaged app runs the real model unless `OPENHUT_MODEL` is set.
Icon sources: `build/icon.svg`, `build/background.svg`. Gotchas: `private/brain/openhut-gotchas.md` (Mac app, Linux app).

On x86_64 Linux, `npm -w @openhut/desktop run dist:linux` builds `release/OpenHut-x64.AppImage` and `release/openhut-x64.deb`;
the Linux app runs this computer's runtime with the curl install in Docker (agents on gVisor, no KVM needed). It needs a Linux machine, not a cross-build from the Mac.

## Test

`npx turbo run build typecheck test` builds, typechecks and runs the unit tests. `npm run e2e` runs the whole thing on Docker Desktop (about 25 minutes):
the install, every check, a tampered upgrade, the upgrade, a restart. Plan: `docs/verification-plan.md`.
