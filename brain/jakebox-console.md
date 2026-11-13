# The JakeBox console and the other packages around the app

## Console (`packages/console`)
- The release registry installs check: `POST /api/releases` (publish key, constant-time compare) registers a build;
  `GET /api/releases` is public and newest first, so `?limit=1` is the latest; `POST /api/check-ins` is an install's
  check-in (random 32+ character id, once a minute per id, enforced by one conditional upsert so races can't double
  it) and answers with a `check_in` (no id, like Stripe's `balance`: it updates the install rather than storing a
  row); `GET /api/installs` needs the publish key. Lists page 10 at a time by default with `startingAfter` or
  `endingBefore` (not both) release or install ids.
- `platform/paging.ts` is the one place outside a service that queries the database: both collections page by `seq`
  the same way, and Kysely's builder can't be typed for a table chosen at runtime, so it's one raw query.
- The app checks when `CONSOLE_URL` is set (the installer passes it through to `/etc/jakebox/env`): once at start, then
  hourly in the background, cached in memory (failures too), with concurrent Admin requests sharing one check; any
  failure means "no update", never a broken Admin page. The install id lives in `install_setting`.
- An update is a newer build, not just a different one: both builds must be release timestamps (`YYYYMMDDHHMMSS`) and
  the console's must sort later, so a dev build (`dev`) or a rolled-back console never offers a downgrade. The console
  only registers timestamp builds, so one odd release can't silence update offers everywhere.
- Releasing is two steps so installs never hear of a build before it can be downloaded: `scripts/release.sh` builds
  `dist/` and writes `dist/release.json`; after `dist/` is deployed to get.jakebox.dev, `scripts/publish-release.sh`
  posts that file to the console, passing the key to curl on stdin so it never shows in `ps`.
- Known limits: the check-in limit is per id, so fresh random ids can still flood it; restarting the app within a
  minute of a check-in gets a logged 429.
- evlog is pinned exactly: a newer minor wanted a different fastify than the app's and broke `npm install`.

## Site (`packages/site`)
- get.jakebox.dev: `/` is `install.sh` unless `Accept` has `text/html`; `/jakebox.tgz` is the tarball; `/docs/<page>`.
  Request paths are never joined into file paths, so traversal can't happen. In production Caddy serves the release
  files and the prerendered pages directly (no Node at runtime); the Node server is what the e2e run uses.

## CLI (`packages/cli`)
- `jakebox login <url>` is OAuth with PKCE over a one-shot 127.0.0.1 redirect; credentials go to
  `~/.config/jakebox/credentials.json` (0600). Two `jakebox` processes refreshing at once can race, since refresh
  tokens rotate. The server's OAuth metadata must name endpoints on the address you logged in to; otherwise login
  stops and names the address the server gives. A callback with the wrong `state` gets a 400 and login keeps waiting
  for the right one. `bin` runs the TypeScript directly; publishing to npm would need a bundle first (Node won't run `.ts`
  from `node_modules`).

## Infra (`packages/infra`)
- `aws/jakebox.yaml`: Ubuntu 24.04 arm64 (it ships the SSM agent Session Manager needs), an encrypted data volume at `/data` (Docker's data root too), only 80/443 open,
  Caddy for HTTPS in front of 8787, Session Manager instead of SSH. Ubuntu's root device is `/dev/sda1`; the data disk is
  found by its volume id under `/dev/disk/by-id/`, never by guessing `nvme1n1`. The installer runs with the normal
  umask (a 077 umask leaves `/opt/jakebox` unreadable to the `jakebox` user); only its log is created 0600 first. The owner link is written to
  `/root/jakebox-owner-link` and the installer's output to `/root/jakebox-install.log`, both root-only (no `set -x`, so
  the setup code never reaches the console log anyone with `ec2:GetConsoleOutput` can read). Lint with `uvx cfn-lint`; it hasn't been deployed from here.

## Recipes (`packages/recipes`)
- Data only: name, pitch, instructions, model. `@jakebox/common` imports the recipe ids, so recipes can't import
  common's `ModelId` without a cycle; the agent service assigns `recipe.model` to a `ModelId` column, so tsc still
  catches a model that doesn't exist.
