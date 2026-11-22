# Release signing

The Mac app installs an update only when `release.json`, naming the release's version and listing the SHA-512 of every release file, carries an Ed25519 signature by the offline release key. The app also requires the signed version to equal the version the feed offers, so an older signed release can't be served again as a newer one (electron-updater never installs a version older than the running one). CI never holds that key, so a stolen CI secret alone can't ship an update. Until a public key is pinned in `packages/desktop/src/release-key.mjs`, the app installs updates as before.

## Make the key (once, owner)

On a computer you trust, with the repo checked out, and the key going to an offline drive:

```sh
scripts/release.sh key /Volumes/OFFLINE/openhut-release.pem
```

It writes the private key (0600) and prints the public key (base64 SPKI). Never commit, upload or paste the `.pem`. Keep a second copy on another offline drive. Then pin the public key:

```js
export const RELEASE_KEY = '<the printed public key>'
```

Commit that one line on a branch, open a PR, merge. From the next release on, the publish job waits for `release.json` and `release.json.sig`, and the app refuses an update without them.

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

## GitHub settings (owner)

- **Release secrets need a reviewer.** Settings › Environments › New environment `release`, tick "Required reviewers", add yourself, and under "Deployment branches and tags" allow only tags `v*`. Move `CSC_LINK`, `CSC_KEY_PASSWORD`, `NOTARY_KEY_P8_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID` from repo secrets into that environment (delete the repo copies), then add `environment: release` to the desktop workflow's `build` and `publish` jobs. `CLOUDFLARE_API_TOKEN` stays a repo secret because the site deploy uses it too.
- **Protect release tags.** Settings › Rules › Rulesets › New tag ruleset, target `v*`, enforce "Restrict creations", "Restrict updates" and "Restrict deletions", bypass list: only you. Or with `gh`:

```sh
gh api -X POST repos/openhuthq/openhut/rulesets --input - <<'EOF'
{"name":"release tags","target":"tag","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
 "rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}
EOF
```

(`actor_id` 5 is the repository Admin role.)
