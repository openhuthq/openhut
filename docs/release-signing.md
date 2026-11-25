# Release signing

A Cloud computer (openhut-boot) and a server's updater install a release only when `release.json`, naming the release's version and listing the SHA-512 of every release file, carries an Ed25519 signature by the release key. The public key is pinned in `packages/release/src/release-key.mjs`; the private key is the secret `RELEASE_SIGNING_KEY` in the `release` environment and exists nowhere else. Promote signs every release with it (owner, 2026-11-23). Tradeoff: a GitHub compromise could now ship an update; accepted pre-release.

`release.json` is v2 (`schema: 2`): besides `version` and `files` (what the shipped app checks, unchanged) it carries `sequence`, `channel`, `shellApi` (`{ min, max }`, the boot's `SHELL_API`), `halt` (Promote goes to everyone at once; `halt` and a signed pointer to N−1 are the brakes, and every release, rollbacks too, waits the hour) and `packs` (each `openhut-<name>.tgz` beside an `openhut-<name>.json` per-file manifest, with both sha512s), set by `release-key.ts sign` flags. Promote logs the signed manifest in Sigstore's public Rekor log (`--rekor`, a `rekord` entry) and ships the entry as `release.json.rekor`. `verifyRelease()` in `packages/release/src/release-key.mjs` is the one check every client is to use (SEC6): the signature, Rekor's signed timestamp and inclusion proof under the pinned Rekor key, and an entry at least an hour old; no entry means no update. Packs build with `node scripts/pack.ts <folder>` after `pack-backend`, byte for byte the same for one commit.

CI announces every `release.json` it signs by publishing it on dl.openhut.dev at `releases/<sha256 of release.json>.json` (`scripts/r2.sh`). The Cloud (off GitHub) runs the release monitor (`private/api/src/releases/release-monitor.ts`, R3): every 5 minutes it asks Rekor for every entry signed by the release key, and alerts on any whose manifest isn't announced there 15 minutes after it was logged, well inside the hour clients wait. The alert is the `releases.unannounced` error log and `releases.ok: false` on `/api/health`; on one, publish `halt`.

## Replace the key (only if it leaks)

```sh
scripts/release.sh key "$TMPDIR/release.pem"
gh secret set RELEASE_SIGNING_KEY --env release --repo openhuthq/openhut < "$TMPDIR/release.pem"
rm -P "$TMPDIR/release.pem"
```

`key` writes the private key (0600) and prints the public key (base64 SPKI); pin it as `export const RELEASE_KEY = '<printed key>'` and merge. Apps with the old key never accept an update signed by the new one, so their users download the app again.

## Promote, halt, roll back (owner)

Packs are the normal release (R4). Every `main` push builds its packs (the CI run's `packs` artifact, kept 7 days) and pushes its runtime image tagged by commit; nothing is published until Promote. There is one channel, stable (the beta channel was removed 2026-11-25; the old `channels/beta/*` files on dl.openhut.dev are left as they are and no longer written). **Actions › Promote › Run workflow** (`.github/workflows/promote.yml`):

- `promote`: takes main's newest green CI run, adds `install.sh` pinned to that run's runtime image and `openhut.tgz`, signs the release.json as stable, logs it in Rekor, puts the packs on dl.openhut.dev at `packs/<sha512 hex>`, announces it at `releases/<sha256>.json` and serves it at `channels/stable/release.json` (with `.sig`, `.rekor` and `install.sh`). Every device takes it at once, after `MIN_AGE_SECONDS` (0 for now). A finished Promote deploys the Cloud (`cloud.yml`).
- `halt`: re-signs the current stable with `halt: true`. A device holding it as pending drops it on its next poll, without waiting the hour.
- `rollback` with `to` = an earlier release.json's sha256: re-signs those bytes (N−1's packs) as stable under a higher sequence. Devices go back to them an hour later.

`release-key.ts point` does the re-signing and refuses a release.json the key didn't sign, a lower sequence, or pointing at a halt. `pointerAction()` in `packages/release/src/release-key.mjs` is what a device does with the pointer it polls (`refuse`, `halt`, `none`, `wait`, `install`); `src/packs.mjs` wires it into the boot's pack apply.

## GitHub settings

Set up on 2026-11-22:

- **Environment `release`**: no required reviewers (removed 2026-11-23: the owner is the only one who releases), deployment only from tags `v*` and from `main`. Promote runs in it, so only those reach its secrets: `RELEASE_SIGNING_KEY` (above) and `RELEASE_TAG_KEY`, is the private half of the deploy key "Release tags from the Cut a release workflow" (write access; the workflow is gone since R9, the key can still tag); no copy exists anywhere else. To replace it, delete the deploy key, make a new ed25519 key, add it as a deploy key with write access and set it with `gh secret set RELEASE_TAG_KEY --env release`.
- **Tag ruleset `release tags`** on `refs/tags/v*`: creation, update, deletion and force-push are restricted; the repository Admin role (`actor_id` 5) and deploy keys (`DeployKey`, added 2026-11-22 for Cut a release) bypass. The only deploy key is the one above.

Still the owner's (needs the secret values): move `CSC_LINK`, `CSC_KEY_PASSWORD`, `NOTARY_KEY_P8_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID` from repo secrets into the `release` environment (delete the repo copies), then run the `draft` and `build` jobs in it on tags (`environment: ${{ startsWith(github.ref, 'refs/tags/') && 'release' || '' }}`); a manual full build of a branch then can't sign. `CLOUDFLARE_API_TOKEN` stays a repo secret because the site deploy uses it too.
