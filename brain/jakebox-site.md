# The site (`packages/site`)

- get.jakebox.dev: `/` is `install.sh` unless `Accept` has `text/html`; `/jakebox.tgz` is the tarball; `/docs/<page>`.
- `src/build.ts` prerenders the pages, and Caddy serves them and the release files directly (`Dockerfile`, `Caddyfile`),
  so nothing runs Node. The image bakes in `dist/install.sh` and `dist/jakebox.tgz` from `scripts/release.sh`.
- The e2e run builds the same image and mounts each release over `/srv/release`, so it tests the production config.
