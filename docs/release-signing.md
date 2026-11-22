# Release signing

The Mac app installs an update only when `release.json`, naming the release's version and listing the SHA-512 of every release file, carries an Ed25519 signature by the offline release key. The app also requires the signed version to equal the version the feed offers, so an older signed release can't be served again as a newer one (electron-updater never installs a version older than the running one). CI never holds that key, so a stolen CI secret alone can't ship an update. The public key is pinned in `packages/desktop/src/release-key.mjs` (since 2026-11-22); the private key exists only offline with the owner.

## Make the key (done once; again only to replace a lost or leaked key)

On a computer you trust, with the repo checked out, and the key going to an offline drive:

```sh
scripts/release.sh key /Volumes/OFFLINE/openhut-release.pem
```

It writes the private key (0600) and prints the public key (base64 SPKI). Never commit, upload or paste the `.pem`. Keep a second copy on another offline drive. Then pin the public key:

```js
export const RELEASE_KEY = '<the printed public key>'
```

Commit that one line on a branch, open a PR, merge. From the next release on, the publish job waits for `release.json` and `release.json.sig`, and the app refuses an update without them.

## Cut a release (owner)

**Actions › Cut a release › Run workflow**: pick the channel (`stable` or `beta`) and type the version (`0.5.0`, or `0.5.0-beta.2` for a beta). The workflow (`.github/workflows/release.yml`) runs in the `release` environment, so it waits for your approval before it touches anything. Then it:

- checks the version: a beta has a `-beta.N` part and a stable has none; a stable is higher than every stable tag, a beta higher than every tag (a stable hotfix like 0.4.2 may still follow a 0.5.0 beta);
- commits "Release X: the app and runtime version" (both `package.json` files and the lock), on `main` for a stable, on a new branch `release/vX` from `main` for a beta (a beta never lands on `main`, since every push there deploys openhut.dev, whose `install.sh` moves remote runtimes to its version);
- pushes the tag `vX` with the deploy key `RELEASE_TAG_KEY`, which is what starts the desktop workflow, exactly as a tag you push by hand.

The bump is pushed with the workflow's own token, which starts no workflow, so a stable bump doesn't deploy openhut.dev early; the `publish` job deploys it once the release is public. The tag can't be pushed with that token: the `release tags` ruleset lets only Admins and deploy keys create `v*` tags, and GitHub doesn't accept the GitHub Actions app as a bypass actor on this repo. Tagging by hand (below) still works.

You still co-sign the draft offline (next section) and approve the `release` environment for its `publish` job.

## Sign a release (every tag, owner)

After the desktop workflow has built the draft release `vX.Y.Z`:

```sh
mkdir -p ~/openhut-release && cd ~/openhut-release
gh release download vX.Y.Z --repo openhuthq/openhut --dir vX.Y.Z
RELEASE_KEY=/Volumes/OFFLINE/openhut-release.pem /path/to/openhut/scripts/release.sh sign "$PWD/vX.Y.Z"
gh release upload vX.Y.Z --repo openhuthq/openhut vX.Y.Z/release.json vX.Y.Z/release.json.sig
gh run rerun --repo openhuthq/openhut --failed "$(gh run list --repo openhuthq/openhut --workflow desktop.yml --branch vX.Y.Z --limit 1 --json databaseId -q '.[0].databaseId')"
```

`sign` takes the version from the folder's `latest*.yml` (`version: X.Y.Z`) and refuses a folder without one, or with files that disagree; pass it as a third argument to say it yourself (`release.sh sign <folder> X.Y.Z`).

Check what you sign first: `shasum -a 256 vX.Y.Z/*` against the build log, and `SHA256SUMS` against a build of the same tag (`npm -w @openhut/desktop run build && npm -w @openhut/desktop run pack-backend && npm -w @openhut/desktop run sums`).

## Cut a beta

A beta is a release whose version has a prerelease part. Cut it with the button above (channel `beta`), or by hand: bump `version` in `packages/desktop/package.json`, `packages/runtime/package.json` and `package-lock.json` to `0.5.0-beta.1` on a branch `release/v0.5.0-beta.1` (never `main`), then

```sh
git tag v0.5.0-beta.1 && git push origin v0.5.0-beta.1
```

It builds, is checked and is signed exactly like a stable (`release.sh sign` reads `version: 0.5.0-beta.1` from `latest-mac.yml`; the folder is `v0.5.0-beta.1`). The differences: its draft is a GitHub prerelease, so it never becomes GitHub's latest release and openhut.dev's `install.sh` and remote runtimes stay on the stable; and `scripts/r2.sh` writes only `beta.yml`, `beta-mac.yml` and `beta-linux.yml` on dl.openhut.dev, never `latest*.yml` or `latest/`. Only apps with **Settings › Updates › Try new features early** on read the beta feed. A stable release also moves the beta feed, unless the beta there is of a newer version (a 0.4.3 hotfix leaves 0.5.0-beta.2 there). The app never installs an older version, so a beta user who turns the setting off stays on their beta until a newer stable. Bump to the stable `0.5.0` (higher than every `0.5.0-beta.N`) for the release itself.

## GitHub settings

Set up on 2026-11-22:

- **Environment `release`**: required reviewer the owner, deployment only from tags `v*` (betas like `v0.5.0-beta.1` match) and from `main` (for Cut a release, added 2026-11-22). The desktop workflow's `publish` job and the Cut a release job run in it, so nothing is tagged or goes public without the owner's approval. Its secret `RELEASE_TAG_KEY` is the private half of the deploy key "Release tags from the Cut a release workflow" (write access); no copy exists anywhere else. To replace it, delete the deploy key, make a new ed25519 key, add it as a deploy key with write access and set it with `gh secret set RELEASE_TAG_KEY --env release`.
- **Tag ruleset `release tags`** on `refs/tags/v*`: creation, update, deletion and force-push are restricted; the repository Admin role (`actor_id` 5) and deploy keys (`DeployKey`, added 2026-11-22 for Cut a release) bypass. The only deploy key is the one above.

Still the owner's (needs the secret values): move `CSC_LINK`, `CSC_KEY_PASSWORD`, `NOTARY_KEY_P8_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID` from repo secrets into the `release` environment (delete the repo copies), then run the `draft` and `build` jobs in it on tags (`environment: ${{ startsWith(github.ref, 'refs/tags/') && 'release' || '' }}`); a manual full build of a branch then can't sign. `CLOUDFLARE_API_TOKEN` stays a repo secret because the site deploy uses it too. The release key is never a secret anywhere.
