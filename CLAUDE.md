# OpenHut

Self-hosted agents with an end-to-end encrypted cloud: the OpenHut app (Mac and Linux) runs agents on several runtimes, one on
this computer and one on each computer you add. A runtime runs many Hermes agents, each in its
own process (a plain process that runs as you in the app on a Mac, Windows or Linux PC, a gVisor sandbox in Docker on a server you add), with their own Slack app and WhatsApp number. Agents reach team
data only through the runtime's gateway, which holds every key and checks each agent's grants on every call. You manage
it from the app, or by asking an agent to change its own name, instructions, channels or connections, which you approve in the app (`private/brain/decisions/agents-change-themselves.md`). Everyone signs in to OpenHut Cloud on first launch: always
synced, always a team, end-to-end encrypted (`private/brain/decisions/sign-in-first.md`). Apps read sealed records from the cloud
(`api.openhut.dev`) and decrypt them locally; a runtime keeps only the run set for the agents it runs. The app reaches the local
runtime on a 0600 Unix socket, and a remote one end-to-end encrypted through the relay (Tailscale only carries the first install, over Tailscale SSH), after it
asked to join with a one-use code and you approved it.
Scope and decisions: `private/brain/decisions/openhut-v1-scope.md`.

## Packages

An npm-workspaces monorepo run with Turborepo, laid out like Skyfleet.

- **`packages/runtime`** — `@openhut/runtime`, one runtime: two processes built, shipped and updated as one package.
  `src/server/` is the API (Fastify, Kysely on PGlite), grouped by domain: `platform/` (config, db, secrets, settings,
  errors, evlog logging, the typed agentd client), `team/` (identity: the socket or the enrolled key, and the one owner),
  `agents/` (agents, grants, their Hermes files), `channels/`, `connections/`, `gateway/` (the agents' MCP gateway and
  key broker on :8081), `admin/`, and
  `integrations/<service>/`. `src/agentd/` is the root helper: the only process that starts agents (gVisor on servers, native in the app on
  Mac, Windows and Linux: a plain Hermes process per agent, or memory, `private/brain/decisions/sandbox-module.md`), on a Unix socket on a server; in the app the server runs its command table in its own process (`src/agentd/serve.ts`). Tests mirror them in `test/server/` and `test/agentd/`.
- **`packages/app`** — `@openhut/app`, the App: the React dashboard (Vite to `dist`, TanStack Query), one build that the desktop shell, the phone and the Cloud (app.openhut.dev) serve as the same bytes. It reads `/config.json` (`{ cloud, local? }`) at start: `local` means the page's own origin answers `/api` (the desktop shell, and `npm run dev`); without it the App reaches computers through the Cloud's tunnel (`lib/remote.ts`). Tailwind v4 with shared components in `src/components/ui` (shadcn on Base UI); screens use those, not their own styles (`private/brain/decisions/dashboard-uses-tailwind-and-shadcn.md`).
- **`packages/desktop`** — `@openhut/desktop`, the Mac, Windows and Linux shell (`private/brain/decisions/desktop-app.md`): Electron main (`src/main.mjs`, starts the server, which runs agentd inside it,
  serves the App's `dist` (copied to `dist/renderer` by `build`) and `/config.json` on `app://openhut`), and forwards `/api/*` there to the runtime's socket.
- **`packages/common`** — `@openhut/common`, the API contract: Zod Mini request schemas and response types, the Cloud client (`cloud/`), and in `tunnel/` the encrypted tunnel (through the relay; `sessions()` runs it over any pipe): Noise IK on `noise-handshake`,
  the frame codec, `connect` (device) and `serve` (computer); a computer shows its access token as `x-openhut-token`, a device as the second WebSocket subprotocol after `openhut`, so `connect` runs in browsers too, with a non-exportable WebCrypto key (`newWebKeyPair`, `webKey`; `private/brain/decisions/browser-keys.md`).
- **`packages/docs`** — `@openhut/docs`, the docs at openhut.dev/docs: Fumadocs on TanStack Start, prerendered. MDX in
  `content/docs`, real dashboard screenshots in `public/screenshots`. Notes: `private/brain/openhut-site.md`.
- **`private/site`** — `@openhut/site`, openhut.dev, in the private submodule (see Private half below): `install.sh` for curl, the release tarball, the home page, the brand page
  and the built docs, served by a Cloudflare Worker with static assets (`wrangler.jsonc`, `src/worker.ts`) that
  `.github/workflows/deploy.yml` deploys on every push to `main`. The e2e run serves its releases with the same Worker
  under `wrangler dev`. Deploys: `private/brain/openhut-deploy.md`.

`install/` is the remote runtime: `install/Dockerfile` builds the prebuilt server image `ghcr.io/openhuthq/runtime` (dockerd, gVisor,
Node, the release tree, Claude Code, agent-browser, the WhatsApp bridge and the pinned Hermes agent image, so nothing downloads on the
server), and `install.sh` is what `curl openhut.dev | sh` runs: it pulls that image by the digest pinned in the signed installer and
runs it as the container `openhut` (`--privileged` for the agents' Docker and gVisor, read-only root, data in the volumes `openhut-data`
and `openhut`, 127.0.0.1:8787 only), plus `openhut-updater`, the only holder of the host's Docker socket, for Update now
(`private/brain/decisions/runtime-image.md`). `scripts/release.sh` builds what `openhut.dev` serves, `scripts/image.sh` builds the image
from it and pins its digest into `install.sh`, and `.github/workflows/runtime-image.yml` builds, smoke-tests and pushes it (PRs, `main`
as `edge`, tags); `vendor/` is the pinned Hermes plugin.

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

Open the PR with the first push, and leave one background `gh run watch <id> --exit-status --interval 120` to hear
when CI ends (no polling loops: the account's API limit is 5000/h, shared by every agent). After one review round
with no open blocker, run `gh pr merge --auto --merge`; it merges when the required `gate` check passes. The owner's
"merge without asking" (2026-11-13) still stands. The main ruleset has no bypass, so a red gate means fixing it,
never forcing it. Every main commit gets its own full CI run (`ci.yml`, Linux only: typecheck, tests, private, server smoke); Deploy then ships main's newest green commit (openhut.dev, the edge image, the cloud).
Reviewer loop and flaky tests: `private/brain/openhut-deploy.md` (CI).

## Web first, Electron last

OpenHut is developed as a web app. The dashboard runs on localhost in a browser with hot reload, against the real
runtime and a local cloud. Electron is the endgame: run it last, to check the final thing and what only the desktop
has (Keychain, Touch ID, passkey, updates, deep links, the tray). The procedure is the `openhut-dev-loop` skill
(`.agents/skills/`, linked from `.claude/skills`).

| Command | What it does |
|---|---|
| `npm run dev` | The web app: runtime, local cloud and Vite on localhost. The everyday loop |
| `npm run seed` | Sample agents and connections in the running dev app (on a fresh `.data`) |
| `npm run reset` | Wipe `.data` (runtime and local cloud DB) |
| `npm run check` | Typecheck and test only what changed since `origin/main` |
| `npm run test` / `typecheck` / `build` | Everything |
| `npm run app` | The real Electron app from this checkout |
| `npm run e2e:app` | The app e2e on unpackaged Electron and a local dev cloud (this Mac) |
| `npm run release` | Build what openhut.dev serves |

Which loop proves which change:
- Screens, copy, forms, API, agents, cloud: `npm run dev` and a look in Chrome at the Vite URL, plus `npm run check`.
  This is the default, and it's proof enough for review.
- `main.mjs`, `preload.cjs`, anything behind `window.openhut`: `npm run app`, then `npm run e2e:app`.
- Packaging, signing, installers, OS-specific behavior: a manual Shell run on the branch (`gh workflow run shell.yml --ref <branch>`).
  It also runs by itself when a main push changes the shell. CI never packages, and it is the merge gate, never the loop: don't wait on it to see a change working.

The dashboard reaches the desktop app only through `packages/app/src/lib/desktop.ts` (`desktop` is
`undefined` in a browser, and every caller handles that); a test keeps it the only place. Prefer moving work out of
the main process into the runtime's `/api` over adding a `desktop` call, so it runs in the browser too.

## Local dev

```
npm install
npm run dev
```

`npm run dev` starts agentd with native agents (real Hermes processes, as on the Mac app; they need the bundled runtime:
`npm -w @openhut/desktop run pack-backend`, which needs `uv`), the server API on 127.0.0.1:8787 with `.data`, the real model
and real outside services (connect Claude in Settings), the dev key `dev` enrolled, and Vite for the renderer with `/api` proxied to it with
`Authorization: Bearer dev`. It also runs the cloud locally, never production: one Node process from `private/api` (PGlite, dev sign-in, the
relay and the OAuth broker; no wrangler), so it needs `private/` and fails without it unless
`OPENHUT_CLOUD_URL`/`OPENHUT_API_URL` name a cloud. Dev ports (API 8797, gateway 8091, cloud 8792) step
to the next free one, so it runs beside the installed app and other checkouts; it prints the URLs and the sign-in account
(mo@example.com). Ctrl-C stops everything.
Every dev run of the app (`npm run app`, `OPENHUT_TEST_HOME`, or `npm -w @openhut/desktop run dist:dev`, app id `dev.openhut.app.dev`) is
"OpenHut Dev": DEV icon and pill, `~/Library/Application Support/OpenHut Dev`, `openhut-dev://`, gateway 8091, the local cloud
(`packages/desktop/src/dev-build.mjs`), and no updates from the release feed (an `OPENHUT_TEST_HOME` run still updates, for the update tests).

## Build the desktop app

`npm -w @openhut/desktop run dist` builds the renderer, bundles the runtime's server and agentd with esbuild into
`packages/desktop/dist/backend` with the Hermes runtime (no `.pyc`), Node (Mac and Windows; Linux runs Node with Electron) and agent-browser for the build's platform; Claude Code downloads on the first Claude sign-in (`scripts/pack-hermes.mjs`, pinned in `install/native-runtime.json`; nothing downloads on first run) (`scripts/pack-backend.mjs`), and runs electron-builder (`electron-builder.yml`): an arm64,
macOS 14+ `release/mac-arm64/OpenHut.app`, `release/OpenHut-arm64.dmg` and the versioned zip. It signs with the Developer ID
in the login keychain (hardened runtime, `build/entitlements.mac.plist`) and never notarizes (`notarize: false`): only the
release workflow (`.github/workflows/shell.yml`, `scripts/notarize.sh`) notarizes, staples and checks a build. The packaged app runs the real model unless `OPENHUT_MODEL` is set.
Icon sources: `build/icon.svg`, `build/background.svg`. Gotchas: `private/brain/openhut-gotchas.md` (Mac app, Linux app).

On x86_64 Linux, `npm -w @openhut/desktop run dist:linux` builds `release/OpenHut-x64.AppImage` and `release/openhut-x64.deb`;
the Linux app runs agents natively like the Mac app, with no Docker (`private/brain/decisions/linux-app-runs-agents-natively.md`). It needs a Linux machine, not a cross-build from the Mac.

## Test

`npm run check` typechecks and tests what changed; `npx turbo run build typecheck test` does everything. The server path
(install, a server joining, an agent in gVisor) is the runtime image smoke test (`scripts/image-smoke.sh`, in CI). `npm run e2e:app` builds the renderer and backend and runs the app e2e
(`app-e2e.mjs --dev`) against the unpackaged app and a local dev cloud, on this Mac only. Its first run needs a click on
the Keychain prompt (`private/brain/openhut-gotchas.md`). Packaged-app proof on every OS is a Shell run (`shell.yml`, dispatch only): its
`*-e2e` artifacts hold the screenshots and `evidence.json`.
