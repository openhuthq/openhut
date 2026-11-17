# Deploying OpenHut

## openhut.dev (the installer site)
- Pushing to `main` runs `.github/workflows/deploy.yml`: typecheck and unit tests, then `scripts/release.sh` and
  `npm -w @openhut/site run deploy`, then a check that openhut.dev serves an `install.sh` whose checksum matches
  the tarball it serves. Rerun it by hand with `gh workflow run deploy.yml`.
- A build is numbered `<major.minor from packages/app/package.json>.<commit count>`. Anything that drops commits (a squash or a history reset) makes new builds number lower than installed ones, so bump the minor first (0.2 after the first 2026-11-15 reset, 0.3 after the second, which squashed `main` to one commit).
- The repo secret `CLOUDFLARE_API_TOKEN` is the account token "openhut-site GitHub Actions deploy": Workers Scripts
  write and Account Settings read on the owner's account, Workers Routes write on openhut.dev only.
- DNS for openhut.dev and www is managed by the Worker's custom domains; the zone holds no other records. Wrangler's
  OAuth login can deploy but can't edit DNS, so a record in the way has to be deleted in the dashboard. It can delete a Worker's custom domains, though: `DELETE /accounts/<id>/workers/domains/<id>` with the `oauth_token` from wrangler's config. When adding a zone, choose manual DNS entry: the automatic scan imports the registrar's parking A records, and Worker custom domains then fail with "already has externally managed DNS records" (code 100117) until they are deleted.

- openhut.dev lives in the owner's personal Cloudflare account, not the Activepieces one. Wrangler's OAuth token there can create a Cloudflare Tunnel (`wrangler tunnel create`) and set its ingress and fetch its token over the API (`connectivity: admin`), but it can't write DNS (code 10000), so a tunnel's CNAME is added in the dashboard.

## The internal instance
- internal.openhut.dev is the team's own test instance (it replaced monkey.activepieces.dev on 2026-11-15). It is reached through the Cloudflare Tunnel `openhut-internal` (`cloudflared` as a systemd service on the host, ingress to `127.0.0.1:8787`), so the host needs no open inbound port and no certificate. Host details stay out of this repo.
- Since 2026-11-17 it runs in the one-container setup (`decisions/openhut-installs-in-one-container.md`), moved with `.agents/skills/openhut-move-to-container`. The native backup is `/root/openhut-native-backup-20261117.tgz`; `/opt/openhut.native`, the host's `/data` and the old agent image are kept for rollback until someone reclaims them. Measured there: install to dashboard 29 s, Update now 18 s (dashboard down about 2 s, agents kept running), host reboot to all agents back 44 s.

## The GitHub repo and org (openhuthq)

- Both history resets (2026-11-15) replaced the branches only. GitHub keeps every `refs/pull/<n>/head` from before a
  reset pointing at the old commits, and anyone who can read the repo can fetch them. The oldest hold the internal
  instance's addresses and account names, all of them carry the author's personal email, and the old PR bodies name
  the internal host. Git can't delete those refs: before the repo goes public, delete and recreate it (the PRs go
  too) or ask GitHub Support to purge them.
- After a reset every other checkout is still on the old history. Rebase its work onto the new `main`
  (`git rebase --onto origin/main <old base>`) before opening a PR, or the merge brings the old commits back.
- Commits are authored with the GitHub noreply address (`git config user.email` in this repo). Merges made on
  github.com use the account's own setting, so "Keep my email addresses private" has to be on there.
- The org's profile picture is `hut.svg` on the dashboard's ink tile (`#0b0b0c`), 1024px. GitHub has no API for an org
  picture, so it is uploaded on the org's settings page; name, description and URL go through `PATCH /orgs/openhuthq`.
- The docs screenshots in `packages/docs/public/screenshots/` still show the Fast Monkey name and monkey (seed data
  only, no real people).
