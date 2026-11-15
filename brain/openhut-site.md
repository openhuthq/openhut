# The site (`packages/site`)

- openhut.dev: `/` is `install.sh` unless `Accept` has `text/html`, then the home page; `/brand`; `/openhut.tgz` is the tarball; `/docs/<page>`.
- It's the Worker `openhut-site` (static assets, `run_worker_first`) in the moabuaboud@gmail.com Cloudflare account,
  on the custom domains openhut.dev and www. `src/worker.ts` only picks `install.sh` for curl and sets headers;
  every response is `Cache-Control: no-cache`, so the edge never serves a tarball that doesn't match `install.sh`.
- `npm -w @openhut/site run deploy` builds the docs (`packages/docs`), copies `public/` and the docs into `dist/` (`src/build.ts`), copies `dist/install.sh` and
  `dist/openhut.tgz` from `scripts/release.sh` next to them, and runs `wrangler deploy`.
- The e2e run serves each release with the same Worker under `wrangler dev`, so it tests the production code.
- `public/index.html` and `public/brand.html` are single files with their styles and script inline, so the page CSP
  allows `'unsafe-inline'` scripts. The docs need it too: Fumadocs hydrates from inline scripts.
- The home page is generated from the mock artifact's source; the positioning is in
  `brain/decisions/openhut-website-positioning.md`.

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
- Screenshots in `public/screenshots/` are the real dashboard with `node scripts/seed-ui.ts` data, retaken 2026-11-13 at 1456x830 (`agent.jpg` on 2026-11-14 at 1456x822)
  (the Chrome tool's full-viewport `zoom` with `save_to_disk`, which leaves the cursor out more often than `screenshot`; a `scale` below 1 saves a small file). `seed-ui.ts` hardcodes port 8787; on another `PORT`, seed from a copy with the port swapped.
- The home page hero follows Gumloop's (owner, 2026-11-13): a row of mascots, the headline "Build, manage & share
  agents with your team", then one window that mocks the real product (agent list, chat, the agent's instructions and
  skills) with a "Shared with your team" card over its corner. The point is build an agent and share it with your
  team; deploying is a detail. A two-window version (Slack beside a OpenHut panel) was rejected the same day.
- Docs sidebar groups (owner, 2026-11-13): Install (Install, Setup from your AI assistant), Features (Multiple
  agents, Self-improvement, Team), Integrations (Slack, WhatsApp, Postgres, Claude plan), Server (Security, Upgrade,
  Uninstall).

## The brand in the dashboard (`packages/web`)

- Owner, 2026-11-13: the dashboard uses the site's brand. Black primary (`--primary` is ink), the hut (`src/hut.svg`,
  the site's file) as logo and favicon, Bebas Neue for the wordmark and auth headings, IBM Plex Mono for auth copy,
  Inter everywhere else. `components/avatar.tsx` is the site's creature generator; creatures breathe and blink.
- The sign-in, setup and invite pages share `AuthLayout`: the form on white, and a night scene where agents ask the
  hut (the gateway) for data, one at a time: a packet travels the beam, the hut looks at the agent and stamps
  the grant ✓, or ✕ for payroll. Typing makes everyone look at the field; the password field makes the hut close
  its shutters; a failed sign-in makes it shake its head. Rejected: idle hopping and an expanding ring ("cheap CSS trick").
- Owner, 2026-11-13: no native validation bubbles on the auth forms (`noValidate`); the server's message shows under the
  field. Under the new-password field a four-segment strength meter counts down to 12 characters, then rates by length
  and variety. It is a rough heuristic with no dictionary check; swap in zxcvbn if weak-but-long passwords matter.
- Owner, 2026-11-13: **New agent** is a black button that creates "New agent" at once and opens its page at
  `/agents/<id>/name`, where the title is selected to type over. The name is edited in place (a `contenteditable`
  heading, no text box): double-click it or use the pencil shown on hover, Enter or click away saves, Escape cancels.
