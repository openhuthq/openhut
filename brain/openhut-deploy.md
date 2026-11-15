# Deploying OpenHut

## openhut.dev (the installer site)
- Pushing to `main` runs `.github/workflows/deploy.yml`: typecheck and unit tests, then `scripts/release.sh` and
  `npm -w @openhut/site run deploy`, then a check that openhut.dev serves an `install.sh` whose checksum matches
  the tarball it serves. Rerun it by hand with `gh workflow run deploy.yml`.
- A build is numbered `<major.minor from packages/app/package.json>.<commit count>`. Anything that drops commits (a squash or a history reset) makes new builds number lower than installed ones, so bump the minor first (0.2 after the 2026-11-15 reset).
- The repo secret `CLOUDFLARE_API_TOKEN` is the account token "openhut-site GitHub Actions deploy": Workers Scripts
  write and Account Settings read on the owner's account, Workers Routes write on openhut.dev only.
- DNS for openhut.dev and www is managed by the Worker's custom domains; the zone holds no other records. Wrangler's
  OAuth login can deploy but can't edit DNS, so a record in the way has to be deleted in the dashboard. It can delete a Worker's custom domains, though: `DELETE /accounts/<id>/workers/domains/<id>` with the `oauth_token` from wrangler's config. When adding a zone, choose manual DNS entry: the automatic scan imports the registrar's parking A records, and Worker custom domains then fail with "already has externally managed DNS records" (code 100117) until they are deleted.

