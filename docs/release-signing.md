# Release signing

The Mac app installs an update only when `release.json`, naming the release's version and listing the SHA-512 of every release file, carries an Ed25519 signature by the release key. The app also requires the signed version to equal the version the feed offers, so an older signed release can't be served again as a newer one (electron-updater never installs a version older than the running one). The public key is pinned in `packages/desktop/src/release-key.mjs`; the private key is the secret `RELEASE_SIGNING_KEY` in the `release` environment and exists nowhere else. The desktop workflow's `publish` job signs every release with it (owner, 2026-11-23). Tradeoff: a GitHub compromise could now ship an update; accepted pre-release.

## Replace the key (only if it leaks)

```sh
scripts/release.sh key "$TMPDIR/release.pem"
gh secret set RELEASE_SIGNING_KEY --env release --repo openhuthq/openhut < "$TMPDIR/release.pem"
rm -P "$TMPDIR/release.pem"
```

`key` writes the private key (0600) and prints the public key (base64 SPKI); pin it as `export const RELEASE_KEY = '<printed key>'` and merge. Apps with the old key never accept an update signed by the new one, so their users download the app again.

## Cut a release (owner)

**Actions › Cut a release › Run workflow**: pick the channel (`stable` or `beta`) and type the version (`0.5.0`, or `0.5.0-beta.2` for a beta). Nothing waits for a click after that. The workflow (`.github/workflows/release.yml`):

- checks the version: a beta has a `-beta.N` part and a stable has none; a stable is higher than every stable tag, a beta higher than every tag (a stable hotfix like 0.4.2 may still follow a 0.5.0 beta);
- commits "Release X: the app and runtime version" (both `package.json` files and the lock), on `main` for a stable, on a new branch `release/vX` from `main` for a beta (a beta never lands on `main`, since every push there deploys openhut.dev, whose `install.sh` moves remote runtimes to its version);
- pushes the tag `vX` with the deploy key `RELEASE_TAG_KEY`, which is what starts the desktop workflow, exactly as a tag you push by hand.

The desktop workflow then builds, checks and notarizes every app into a draft release, and its `publish` job signs `release.json`, uploads it with `release.json.sig`, puts the files on dl.openhut.dev and publishes the release.

The bump is pushed with the workflow's own token, which starts no workflow, so a stable bump doesn't deploy openhut.dev early; the `publish` job deploys it once the release is public. The tag can't be pushed with that token: the `release tags` ruleset lets only Admins and deploy keys create `v*` tags, and GitHub doesn't accept the GitHub Actions app as a bypass actor on this repo. Tagging by hand (below) still works.

## Cut a beta

A beta is a release whose version has a prerelease part. Cut it with the button above (channel `beta`), or by hand: bump `version` in `packages/desktop/package.json`, `packages/runtime/package.json` and `package-lock.json` to `0.5.0-beta.1` on a branch `release/v0.5.0-beta.1` (never `main`), then

```sh
git tag v0.5.0-beta.1 && git push origin v0.5.0-beta.1
```

It builds, is checked and is signed exactly like a stable. The differences: its draft is a GitHub prerelease, so it never becomes GitHub's latest release and openhut.dev's `install.sh` and remote runtimes stay on the stable; and `scripts/r2.sh` writes only `beta.yml`, `beta-mac.yml` and `beta-linux.yml` on dl.openhut.dev, never `latest*.yml` or `latest/`. Only apps with **Settings › Updates › Try new features early** on read the beta feed. A stable release also moves the beta feed, unless the beta there is of a newer version (a 0.4.3 hotfix leaves 0.5.0-beta.2 there). The app never installs an older version, so a beta user who turns the setting off stays on their beta until a newer stable. Bump to the stable `0.5.0` (higher than every `0.5.0-beta.N`) for the release itself.

## GitHub settings

Set up on 2026-11-22:

- **Environment `release`**: no required reviewers (removed 2026-11-23: the owner is the only one who releases), deployment only from tags `v*` (betas like `v0.5.0-beta.1` match) and from `main`. The desktop workflow's `publish` job and the Cut a release job run in it, so only those reach its secrets: `RELEASE_SIGNING_KEY` (above) and `RELEASE_TAG_KEY`, is the private half of the deploy key "Release tags from the Cut a release workflow" (write access); no copy exists anywhere else. To replace it, delete the deploy key, make a new ed25519 key, add it as a deploy key with write access and set it with `gh secret set RELEASE_TAG_KEY --env release`.
- **Tag ruleset `release tags`** on `refs/tags/v*`: creation, update, deletion and force-push are restricted; the repository Admin role (`actor_id` 5) and deploy keys (`DeployKey`, added 2026-11-22 for Cut a release) bypass. The only deploy key is the one above.

Still the owner's (needs the secret values): move `CSC_LINK`, `CSC_KEY_PASSWORD`, `NOTARY_KEY_P8_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID` from repo secrets into the `release` environment (delete the repo copies), then run the `draft` and `build` jobs in it on tags (`environment: ${{ startsWith(github.ref, 'refs/tags/') && 'release' || '' }}`); a manual full build of a branch then can't sign. `CLOUDFLARE_API_TOKEN` stays a repo secret because the site deploy uses it too.
