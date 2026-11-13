# JakeBox

Self-hosted agents for a team: one `curl | sh` on the customer's server runs many Hermes agents, each in its own gVisor
container, with their own Slack app and WhatsApp number. Agents reach team data (Postgres today) only through JakeBox's
gateway, which holds every key and checks each agent's grants on every call. People manage it from the dashboard or
from their own AI assistant over the control MCP, signed in with OAuth (no personal tokens). Scope and decisions: `brain/decisions/jakebox-v1-scope.md`.

## Packages

An npm-workspaces monorepo run with Turborepo, laid out like Skyfleet.

- **`packages/app`** — `@jakebox/app`, the server (Fastify, Kysely on PGlite). `src/` is grouped by domain:
  `platform/` (config, db, secrets, settings, errors, evlog logging, the typed agentd client), `team/` (identity, people, sessions, invites, OAuth),
  `agents/` (agents, grants, their Hermes files), `channels/`, `connections/`, `gateway/` (the agents' MCP gateway on
  :8081), `mcp/` (the control MCP on `/mcp`, whose tools call the API in-process), `admin/`, and `integrations/<service>/` (Postgres, Slack, WhatsApp).
  Tests in `test/`.
- **`packages/web`** — `@jakebox/web`, the React dashboard (Vite, TanStack Query). The approved design is its CSS.
- **`packages/common`** — `@jakebox/common`, the API contract: Zod Mini request schemas and response types.
- **`packages/agentd`** — `@jakebox/agentd`, the root helper: the only process that runs Docker, on a Unix socket.
- **`packages/e2e`** — `@jakebox/e2e`, the end-to-end run: a bare Linux server in Docker, the curl install, an
  upgrade and a restart. Results go to `packages/e2e/results/` (gitignored).
- **`packages/recipes`** — `@jakebox/recipes`, agent templates (Dev, Support, Sales, Ops), data only, one folder per
  recipe. `POST /api/agents { recipeId }` and the dashboard's New agent start from one.
- **`packages/site`** — `@jakebox/site`, get.jakebox.dev: `install.sh` for curl, the release tarball, the home page and
  the docs. The e2e run serves its releases with it.
- **`packages/cli`** — `@jakebox/cli`, the `jakebox` command: signs in with OAuth and manages agents and invites.
- **`packages/console`** — `@jakebox/console`, the release registry installs check for updates (server and web), so
  Admin can say an update is available.
- **`packages/infra`** — `aws/jakebox.yaml`, a CloudFormation stack: one EC2 host with an encrypted data volume, the
  one-line installer and Caddy for HTTPS, no SSH (Session Manager). Check it with `uvx cfn-lint packages/infra/aws/jakebox.yaml`.

`install/` is the installer and what it runs on the server (firewall, systemd units, boot script); `scripts/release.sh`
builds what `get.jakebox.dev` serves; `vendor/` is the pinned Hermes plugin.

## Conventions (Skyfleet's)

- The API is resource-oriented with Stripe's shapes: flat collections, `{ object: 'list', url, hasMore, data }`,
  `{ id, object, deleted: true }`, `{ error: { type, message, param? } }` (`brain/decisions/jakebox-api-follows-skyfleet.md`).
- A module is `<name>-service.ts` (a deep `xService = {}`, the only layer that touches the database or agentd) and
  `<name>-controller.ts` (one-line handlers, request schemas at the end as `const FooRequest = { schema }`).
  `app.ts` only registers controllers. `platform/config.ts` is the only file that reads env vars.
- Outside services live in `integrations/<service>/`; core reaches them by kind.
- The dashboard reads server data with `useQuery`/`useMutation` and writes responses back with `setQueryData`; forms
  are uncontrolled; which dialog is open lives in the URL.
- Skyfleet's `brain/coding-style.md` applies in full: no comments in executable code (reasons go in `brain/`, see
  `brain/jakebox-server.md`), exported functions with more than one parameter take one object, no nested ternaries,
  no `any`, only `HttpError` throws with sentences for messages, tests mirror source paths, logging through evlog.
- Single quotes, no semicolons, `.ts` imports; Node 22.18+ runs the TypeScript directly.

## Local dev

```
npm install
npm run dev
```

`npm run dev` builds the dashboard, then starts the fake agentd and the app with `.data`, setup code `dev` and the test
model. Open `http://localhost:8787/setup?code=dev`. `node scripts/seed-ui.ts` (on a fresh `.data`) fills in sample
people, agents and connections. The fake agentd answers without Docker, so agents never really run on a laptop.

## Test

`npx turbo run build typecheck test` builds, typechecks and runs the unit tests. `npm run e2e` runs the whole thing on Docker Desktop (about 25 minutes):
a tampered download, the install, every check, an upgrade, a restart. Plan: `docs/verification-plan.md`.
