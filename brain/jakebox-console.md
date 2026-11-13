# The JakeBox console and the other packages around the app

## Console (`packages/console`)
- The release registry installs check: `POST /api/releases` (publish key, constant-time compare) registers a build;
  `GET /api/releases/latest` is public; `POST /api/installs` is an install's check-in (random 32+ character id,
  once a minute per id, enforced by one conditional upsert so races can't double it).
- The app checks only when `CONSOLE_URL` is set, at most hourly, cached in memory (failures too), with concurrent Admin
  requests sharing one check; any failure means "no update", never a broken Admin page. The install id lives in
  `install_setting`.
- `scripts/release.sh` registers a release when `CONSOLE_URL` and `CONSOLE_PUBLISH_KEY` are set, passing the key to curl
  on stdin so it never shows in `ps`.
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
  tokens rotate. `bin` runs the TypeScript directly; publishing to npm would need a bundle first (Node won't run `.ts`
  from `node_modules`).

## Infra (`packages/infra`)
- `aws/jakebox.yaml`: Debian 13 arm64, an encrypted data volume at `/data` (Docker's data root too), only 80/443 open,
  Caddy for HTTPS in front of 8787, Session Manager instead of SSH. The owner link is written to
  `/root/jakebox-owner-link`. Lint with `uvx cfn-lint`; it hasn't been deployed from here.
