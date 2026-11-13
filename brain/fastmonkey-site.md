# The site (`packages/site`)

- fastmonkey.dev: `/` is `install.sh` unless `Accept` has `text/html`; `/fastmonkey.tgz` is the tarball; `/docs/<page>`.
- It's the Worker `fastmonkey-site` (static assets, `run_worker_first`) in the moabuaboud@gmail.com Cloudflare account,
  on the custom domains fastmonkey.dev and www. `src/worker.ts` only picks `install.sh` for curl and sets headers;
  every response is `Cache-Control: no-cache`, so the edge never serves a tarball that doesn't match `install.sh`.
- `npm -w @fastmonkey/site run deploy` prerenders the pages (`src/build.ts`), copies `dist/install.sh` and
  `dist/fastmonkey.tgz` from `scripts/release.sh` next to them, and runs `wrangler deploy`.
- The e2e run serves each release with the same Worker under `wrangler dev`, so it tests the production code.
