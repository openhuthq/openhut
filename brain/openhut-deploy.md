# Deploying OpenHut

## openhut.dev (the installer site)
- Pushing to `main` runs `.github/workflows/deploy.yml`: typecheck and unit tests, then `scripts/release.sh` builds the
  **edge** runtime into `openhut.dev/edge` (`curl -fsSL https://openhut.dev/edge | sh`; such a server keeps updating from
  edge), then `npm -w @openhut/site run deploy` and a check that what it serves matches. `openhut.dev/` is **stable**: once a
  GitHub release carries `install.sh`, the Worker sends curl to the latest release's; until then the deploy keeps putting the
  main build at the root too. Rerun it by hand with `gh workflow run deploy.yml`. internal.openhut.dev should be on edge
  (`OPENHUT_URL=https://openhut.dev/edge` in its `/etc/openhut/env`).
- A build is numbered `<major.minor from packages/runtime/package.json>.<100 + the commits that touch install, packages/runtime, packages/common or vendor>` (2026-11-18; it was the repo-wide commit count, so a site-only commit offered every runtime an update that restarted its agents; the +100 keeps it above the last such build, 0.1.95). The packaged desktop app writes its own `backend/BUILD` (`<app version>-<short commit>`), so an app update re-applies its agents once; its local runtime never offers installer updates (`latestBuild` is null in socket mode). Anything that drops commits (a squash or a history reset) makes new builds number lower than installed ones, so bump the minor first (0.2 after the first 2026-11-15 reset, 0.3 after the second, which squashed `main` to one commit).
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

## Releases (the app and the server runtime together)

Decision: `decisions/one-release-for-app-and-runtime.md`. A `v*` tag runs `.github/workflows/desktop.yml`:
- It stops unless the secrets `CSC_LINK` (the Developer ID Application `.p12`, base64), `CSC_KEY_PASSWORD`,
  `NOTARY_KEY_P8_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID` are set. There is no ad-hoc fallback: v0.1.2 (2026-11-18)
  was the first CI build, the repo had no signing secrets (0.1.0 and 0.1.1 were signed by hand on a Mac), and its ad-hoc
  signature made Squirrel.Mac refuse it on every 0.1.1 install while the app kept saying "Up to date". It also stops if the
  tag is already published: a published release never changes.
- `notarize.sh` always runs (Gatekeeper on the app and a quarantined DMG) and rebuilds the zip's blockmap after re-zipping
  the stapled app. Then the app must pass `codesign --verify -R "=<the previous release's designated requirement>"`,
  the same check Squirrel makes, and `packages/desktop/scripts/update-test.mjs` updates a 0.0.1 build to it twice (Restart
  button and quit) through a local feed, checking the relaunched version, its runtime and that an agent survived.
- The `compat` job runs `scripts/compat.sh <previous tag>`: both minimums (`MIN_APP_VERSION`, `MIN_RUNTIME_VERSION`) at or
  below the previous release, then this client against the previous runtime and the previous client against this runtime.
- The Linux job adds the AppImage, deb and the server runtime of the same commit (`install.sh` and `openhut.tgz`, built with
  `BUILD=<version>` and its tarball URL on the release) to the draft, checks every file is there, then publishes. Publishing
  is the one switch: the app feed (GitHub `latest`) and `curl openhut.dev | sh` (a 302 to the latest release's `install.sh`)
  move together.
- **Pull a bad release:** `gh release edit vX --draft=true` (done for v0.1.2 on 2026-11-18), then `gh workflow run deploy.yml`
  so openhut.dev follows (if the release before it has no `install.sh`, the deploy puts the main build back at the root). New
  installs and updates go back to the previous release; anyone already on the bad one stays there (downgrades are off), so ship
  the fix as the next version. Publishing a release runs the deploy itself.
- **The version must be above what openhut.dev serves.** Servers installed from the root before the first stable release run
  main builds numbered `0.1.1xx`, so the first tag is v0.2.0 or higher; the workflow refuses a lower one (it would never be
  offered to them). v0.1.3 was tagged on 2026-11-18 with the old workflow, and its run was cancelled before it published an
  unsigned build.
- Run `npm -w @openhut/desktop run dist` locally, then `update-test.mjs --from <old .app> --feed <dir with latest-mac.yml and
  the zip>` to see an update before tagging; it uses `OPENHUT_TEST_HOME` and never touches the real app's data.
- The Developer ID certificate expires on 1 Feb 2027; renew it in January and re-export `CSC_LINK`.
