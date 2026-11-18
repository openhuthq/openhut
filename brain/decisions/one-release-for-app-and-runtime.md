---
status: accepted
---
# One signed release for the app and the server runtime

## Decision
A `v*` tag is the only release: it publishes the desktop app and the server runtime of the same commit, under one version, to one GitHub release. Publishing it is the single switch for both the app's update feed and `curl openhut.dev | sh`. Builds from `main` go to `openhut.dev/edge` for the team's own servers. A release that isn't Developer ID signed, notarized, accepted by the previous release's code requirement, updated to from an older build in CI, and compatible both ways with the previous release is never published. Runtime N accepts app N-1 and app N works with runtime N-1, so neither `MIN_APP_VERSION` nor `MIN_RUNTIME_VERSION` may pass the previous release.

## Context
On 2026-11-18 the app and the runtime shipped separately: the app on tags, the runtime on every merge to `main`, with different version numbers. v0.1.2 went out ad-hoc signed, every 0.1.1 install refused it while saying "Up to date", and the download link served it. The same day, runtimes from `main` sent model keys the 0.1.x apps couldn't read, so those apps lost the agent list on updated servers. The owner asked for "a very reliable version", where you press Update in the app and it restarts and updates. The plan went through three rounds of SRE review: https://claude.ai/artifact/Sy68PsK7PCssTwi6sSXmCt

## Why
- One version and one switch means nothing in the app and its servers can be half released, and pulling a release is one command (`gh release edit vX --draft=true`).
- The checks that would have caught 0.1.2 (the requirement check and the update test) and the model-key break (`scripts/compat.sh`) run before publishing, not after users find them.
- GitHub Releases already hold the 300 MB binaries, which Workers static assets can't (25 MiB per file); openhut.dev only redirects.

## Consequences
- Servers on `openhut.dev` get runtime updates only with a release; internal.openhut.dev should point at `/edge`.
- A tag needs the signing and notary secrets in the repo; without them the workflow stops.
- Anyone already on a bad release stays there (downgrades are off), so the fix is always the next version. On a Mac, "Go back" in the start-up error covers a version that can't start.
- Releases can't be changed after publishing; a fix is a new version.
