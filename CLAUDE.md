# OpenHut

Agents for a team, web only (owner, 2026-11-25: `private/brain/decisions/web-only.md`): the web App (app.openhut.dev) runs agents on
runtimes: Cloud (a computer we host) and any Linux server you add with install.sh. A runtime runs many Hermes agents, each in its
own process (a plain process on Cloud, a gVisor sandbox in Docker on a server you add), with their own Slack app and WhatsApp number. Agents reach team
data only through the runtime's gateway, which holds every key and checks each agent's grants on every call. You manage
it from the app, or by asking an agent to change its own name, instructions, channels or connections, which you approve in the app (`private/brain/decisions/agents-change-themselves.md`). Everyone signs in to OpenHut Cloud with Google: always
synced, always a team (`private/brain/decisions/sign-in-first.md`). The App reads sealed records from the cloud
(`cloud.openhut.dev/api`); every account is managed (our signer adds your browsers and invited teammates, W1). The App reaches a
runtime through the relay's encrypted tunnel, after the runtime joined with a one-use code.
Scope and decisions: `private/brain/decisions/openhut-v1-scope.md`.

## Packages

An npm-workspaces monorepo run with Turborepo, laid out like Skyfleet.

- **`packages/runtime`** — `@openhut/runtime`, one runtime: two processes built, shipped and updated as one package.
  `src/server/` is the API (Fastify, Kysely on PGlite), grouped by domain: `platform/` (config, db, secrets, settings,
  errors, evlog logging, the typed agentd client), `team/` (identity: the socket or the enrolled key, and the one owner),
  `agents/` (agents, grants, their Hermes files), `channels/`, `connections/`, `gateway/` (the agents' MCP gateway and
  key broker on :8081), `admin/`, and
  `integrations/<service>/`. `src/agentd/` is the root helper: the only process that starts agents (gVisor on servers, native on Cloud: a plain
  Hermes process per agent, `private/brain/decisions/sandbox-module.md`), on a Unix socket on a server; on Cloud the server runs its command table in its own process (`src/agentd/serve.ts`). Tests mirror them in `test/server/` and `test/agentd/`.
- **`packages/app`** — `@openhut/app`, the App: the React dashboard (Vite to `dist`, TanStack Query), one build that the Cloud (app.openhut.dev) serves. It reads `/config.json` (`{ cloud, local? }`) at start: `local` means the page's own origin answers `/api` (`npm run dev`); without it the App reaches computers through the Cloud's tunnel (`lib/remote.ts`). Tailwind v4 with shared components in `src/components/ui` (shadcn on Base UI); screens use those, not their own styles (`private/brain/decisions/dashboard-uses-tailwind-and-shadcn.md`).
- **`packages/release`** — `@openhut/release`, the signed packs: `scripts/pack-backend.mjs` bundles the server and agentd with esbuild
  into `dist/backend` with the Hermes runtime and agent-browser (`scripts/pack-hermes.mjs`, pinned in `install/native-runtime.json`),
  `scripts/pack.ts` (repo root) packs them, and `src/packs.mjs` + `src/release-key.mjs` are the updater openhut-boot runs on a Cloud computer.
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
- UI follows `DESIGN.md`; run its "Checks before merging UI" before a screen change merges.

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
never forcing it. Every main commit gets its own full CI run (`ci.yml`, Linux only: typecheck, tests, private, server smoke). The image smoke (5-11 min) runs on a PR only when it changes the image's inputs (`install/`, `packages/runtime|common`, `vendor/`, `scripts/{release,image,image-smoke}.sh`, `runtime-image.yml`), so most PRs gate in ~2 min; on main it always runs, and `gate`, the image publish and the Cloud deploy all wait on it; Deploy then ships main's newest green commit (openhut.dev, the edge image, the cloud).
Reviewer loop and flaky tests: `private/brain/openhut-deploy.md` (CI).

## Dev loop

OpenHut is a web app. The dashboard runs on localhost in a browser with hot reload, against the real runtime and a local
cloud. The procedure is the `openhut-dev-loop` skill (`.agents/skills/`, linked from `.claude/skills`).

| Command | What it does |
|---|---|
| `npm run dev` | The web app: runtime, local cloud and Vite on localhost. The everyday loop |
| `npm run seed` | Sample agents and connections in the running dev app (on a fresh `.data`) |
| `npm run reset` | Wipe `.data` (runtime and local cloud DB) |
| `npm run check` | Typecheck and test only what changed since `origin/main` |
| `npm run test` / `typecheck` / `build` | Everything |
| `npm run release` | Build what openhut.dev serves |

`scripts/web-e2e.sh` is the browser run (Chrome through playwright-core), and `scripts/web-only-check.sh` keeps the desktop app,
the phone app and end-to-end encryption out (restore them from the tag `archive/desktop-and-e2e-2026-11-25`).

## Local dev

```
npm install
npm run dev
```

`npm run dev` starts agentd with native agents (real Hermes processes, as on Cloud; they need the bundled runtime:
`npm -w @openhut/release run pack-backend`, which needs `uv`), the server API on 127.0.0.1:8787 with `.data`, the real model
and real outside services (connect Claude in Settings), the dev key `dev` enrolled, and Vite for the renderer with `/api` proxied to it with
`Authorization: Bearer dev`. It also runs the cloud locally, never production: one Node process from `private/api` (PGlite, dev sign-in, the
relay and the OAuth broker; no wrangler), so it needs `private/` and fails without it unless
`OPENHUT_CLOUD_URL`/`OPENHUT_API_URL` name a cloud. Dev ports (API 8797, gateway 8091, cloud 8792) step
to the next free one, so it runs beside other checkouts; it prints the URLs and the sign-in account
(mo@example.com). Ctrl-C stops everything.

## Test

`npm run check` typechecks and tests what changed; `npx turbo run build typecheck test` does everything. The server path
(install, a server joining, an agent in gVisor) is the runtime image smoke test (`scripts/image-smoke.sh`, in CI). The browser path (sign in, a second browser, an invited teammate) is `scripts/web-e2e.sh`, in CI.
