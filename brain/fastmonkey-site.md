# The site (`packages/site`)

- fastmonkey.dev: `/` is `install.sh` unless `Accept` has `text/html`, then the home page; `/brand`; `/fastmonkey.tgz` is the tarball; `/docs/<page>`.
- It's the Worker `fastmonkey-site` (static assets, `run_worker_first`) in the moabuaboud@gmail.com Cloudflare account,
  on the custom domains fastmonkey.dev and www. `src/worker.ts` only picks `install.sh` for curl and sets headers;
  every response is `Cache-Control: no-cache`, so the edge never serves a tarball that doesn't match `install.sh`.
- `npm -w @fastmonkey/site run deploy` builds the docs (`packages/docs`), copies `public/` and the docs into `dist/` (`src/build.ts`), copies `dist/install.sh` and
  `dist/fastmonkey.tgz` from `scripts/release.sh` next to them, and runs `wrangler deploy`.
- The e2e run serves each release with the same Worker under `wrangler dev`, so it tests the production code.
- `public/index.html` and `public/brand.html` are single files with their styles and script inline, so the page CSP
  allows `'unsafe-inline'` scripts. The docs need it too: Fumadocs hydrates from inline scripts.
- The home page is generated from the mock artifact's source; the positioning is in
  `brain/decisions/fastmonkey-website-positioning.md`.

## The docs (`packages/docs`)

- Fumadocs on TanStack Start, prerendered to static files under `/docs/`, copied from Skyfleet's docs
  (`packages/site` there). Search is a static index at `/docs/search.json`.
- Pages are MDX in `content/docs`, ordered by `meta.json`. Frontmatter `icon:` names a mascot in `public/mascots/`
  (the home page's creatures, rendered to SVG), or `logo:<name>` for a brand logo in `public/logos/`. It shows in the
  sidebar and on the same line as the title.
- What the owner wants (2026-11-13, after rejecting two versions): the same branding as the home page (Bebas Neue
  headings, IBM Plex Mono copy, black code bars, screenshots on a grey stage in a black-outlined window), and brief:
  one page per feature, a real dashboard screenshot, three or four one-line steps, nothing else. No overview or
  concepts pages, no flow strips, no coloured icon tiles.
- Screenshots in `public/screenshots/` are the real dashboard with `node scripts/seed-ui.ts` data, taken at 1512x806.
  Port 8787 is hardcoded, so stop any local Fast Monkey container first, or change the port for the session.
- The home page hero is one window that mocks the real product (sidebar, chat, agent panel). A two-window version
  (the team's Slack beside a Fast Monkey panel) was tried and rejected the same day.
