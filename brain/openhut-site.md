# The site (`packages/site`)

- openhut.dev: `/` is `install.sh` unless `Accept` has `text/html`, then the home page; `/brand`; `/changelog`; `/openhut.tgz` is the tarball; `/docs/<page>`.
- It's the Worker `openhut-site` (static assets, `run_worker_first`) in the owner's Cloudflare account,
  on the custom domains openhut.dev and www. `src/worker.ts` only picks `install.sh` for curl and sets headers;
  every response is `Cache-Control: no-cache`, so the edge never serves a tarball that doesn't match `install.sh`.
- `npm -w @openhut/site run deploy` builds the docs (`packages/docs`), copies `public/` and the docs into `dist/` (`src/build.ts`), copies `dist/install.sh` and
  `dist/openhut.tgz` from `scripts/release.sh` next to them, and runs `wrangler deploy`.
- The e2e run serves each release with the same Worker under `wrangler dev`, so it tests the production code.
- `public/index.html` and `public/brand.html` are single files with their styles and script inline, so the page CSP
  allows `'unsafe-inline'` scripts. The docs need it too: Fumadocs hydrates from inline scripts.
- The home page revamp (owner, 2026-11-17): the hero is an interactive replica of the desktop app, not a screenshot
  and not a generic product mock. It copies `packages/desktop/src/renderer` by hand in vanilla JS inside `index.html`:
  the tokens of `index.css` (as `--a-*`, kept light in any theme), the creature generator (`creature.tsx`, with the
  palette and costume picked per agent so Growth, Support, Ops and Sales look like the app's screenshots), the brand
  marks (`logos.svg` and `brand-icons.ts`, as one inline sprite) and the Hugeicons paths the app uses (inlined from
  `@hugeicons/core-free-icons`). Agents switch, each with its own scripted question that types itself, a tool tile and
  a streamed answer; the composer answers typed messages (a question gets a canned answer, anything else is saved to
  memory and the panel's note count goes up); Stop/Start, Clear and Delete confirm in place; Model and Runs on are
  menus; Settings (all five tabs) and Connections open as the app's fixed-size dialog; the sidebar collapses with the
  spring. When the app's UI changes, change the replica in the same PR.
- Window sizes: 1180×740 at full size, scaled down to fit; below 1000 px of room it is the app's narrow layout
  (900 wide, no right panel, as the app below 1100pt); below 640 px it is one pane with the agents as a row of faces.
- Arrangement (2026-11-17): headline, one line, then ONE download button above the window so it shows without
  scrolling, the window centred and big, a GitHub link under it. A two-column version
  (text and downloads left, window right) was tried: at 1440 the window drops to the narrow layout without its panel.
- The download button (owner, 2026-11-17, after dusk.bot): one black pill with the OS logo left of the label, the
  same in the closing band. The HTML says "Download for Mac" with the Apple logo, so it works without JS; the script
  reads `navigator.userAgentData.platform` (else `navigator.platform`, else the user agent) and only Linux (not Android,
  not ChromeOS) switches it to "Download for Linux" with Tux and `/download/linux`. Windows, phones and anything unknown
  keep Mac. One muted line under it: "Apple silicon · macOS 14 or later" or "x64 · also as a .deb", then "Other
  platforms" (GitHub releases). Clicks track `mac_download_clicked` or `linux_download_clicked` (with `format`).
- The rest of the page follows the app's calm: Inter headings at a few sizes, sentence case, grey pills, hairline
  cards, colour only from faces, brand marks and status dots. Bebas Neue and IBM Plex Mono are gone from the home page
  (the docs and `/brand` still use them). Sections and their substance are unchanged: channels, shape it as you go,
  browser, sealed and scoped, usage and cost, the night closing band with the sand strip.
- No curl on any page (owner, 2026-11-17): the pages sell the app; Linux visitors get the Linux download. `/` still
  serves `install.sh` to curl because the app's "Add a computer" uses it. Old changelog entries keep their wording.
- One closing block: the night band ends on the sand, and the footer (logo, one line, Docs · Changelog · Brand ·
  GitHub) sits on the sand inside it. There is no separate white footer.
- Never reuse a short generic class across the page and the app copy: the panel's `.sec` once turned `.btn.sec`
  into a column and stacked the GitHub icon over its label.
- No section snapping any more: the hero is taller than a screen and the wheel handler fought the chat's own scroll.
- Never name a class or id `ad-*`, `ads`, `banner-ad` and the like: ad blockers hide matching elements with cosmetic filters, and the page just shows an empty box. The usage card was `ad-top`/`ad-rows` and vanished for anyone with uBlock; it is `wu-*` now.

- The changelog (`public/changelog.html`, owner 2026-11-15) is one `<article class="rel">` per release, newest first, labelled with the version Admin shows (`.ver`), the date and a GitHub link. A release opens with its biggest product change as `.lead`, then `.sm` entries, one per change, each full width with no side-by-side pairs (owner, 2026-11-17): a plain headline, one short line, then a real dashboard screenshot from `public/changelog/` with a one-line caption when there is one (a tall image gets `class="tall"`). Every product change is its own entry, never a bullet list. Small changes (a connection like Excalidraw, the Slack icon, usage data) and openhut.dev's own changes aren't listed at all (owner, 2026-11-17). Add the entry in the PR that ships the change: a new version gets a new article on top, and a bigger change in the current version becomes the `.lead` while the old lead moves down to `.sm`. Product screens are real screenshots, never drawings.

## The beach (owner, 2026-11-15)

- The brand is a cozy beach, as sprinkles only (owner, 2026-11-15, after a full beach brand page and a beach
  sign-in scene were "a little too much"): the home and brand pages get a small sun, a wave under the headline,
  and on home a moon and a sand strip under the crew. The dashboard has no beach (owner removed the panel's sand line,
  2026-11-15). (The dashboard's night-scene sign-in pages went with sign-in, 2026-11-17.)
- The name is always "OpenHut", never all caps. The wordmark is Fredoka 600 in the site, docs and dashboard, because
  Bebas Neue has only capitals. Keep the name out of Bebas headings and uppercase eyebrows.
- The hut's roof has two scalloped thatch rows (every `hut.svg` copy and the site's creature generator).
  Below 24 px the brand page uses a small cut: no thatch lines, dot eyes, a bigger flag.

- OpenHut is open source under MIT (owner, 2026-11-15). The home page links to github.com/openhuthq/openhut in the nav,
  under the hero, beside the closing install command and in the footer; `/brand` has it in the nav.

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
- The browser's live view can't be shot locally (the memory sandbox has no browser). On internal, Scout has Browser on: open `/agents/<id>/browser` first (Activity lists only steps made while it's open), then ask Scout in chat to `agent-browser open` a page and `snapshot -i`, which list as Opened and Read the page; a scroll done with `eval` shows the raw word "evaluate". Take over to scroll it yourself, then hand back. The Chrome tool's `zoom` on just the page region saves about 1.5x, close to the 1280x800 stream (2026-11-17).
- (Superseded by the app replica, 2026-11-17.) The home page hero followed Gumloop's (owner, 2026-11-13): a row of mascots, the headline "Build, manage & share
  agents with your team", then one window that mocks the real product (agent list, chat, the agent's instructions and
  skills) with a "Shared with your team" card over its corner. The point is build an agent and share it with your
  team; deploying is a detail. A two-window version (Slack beside a OpenHut panel) was rejected the same day.
- The home page has too many sections (owner, 2026-11-15). Combine them Gumloop-style: one heading, a few big tiles,
- Browser band (owner, 2026-11-17, after Gumloop's "A real browser for every agent"): compact, two columns. On the left, a live window cycles three real stream frames from an agent's browser (`public/browse/`); on the right, the heading, a working Take over toggle and three one-line facts. A two-row bento with a paragraph per tile was too wordy. Rebalanced (owner, 2026-11-17): heading, one line ("Take over when a site needs a login."), the three facts at 14px, then one small grey "Take over"/"Hand back" pill with a muted status beside it. No Driving/Watching card, no black full-width button.
  then a row of small tiles. A small fact (Bring your own Claude) is a tile, never its own section. Setting up from
  Claude or Cursor and self-improving are one story. Proposal (8 bands down to 4): claude.ai/artifact/VKx4ggE5DioFPUZQXAUspk.
- Docs sidebar groups (2026-11-17, the desktop app): Get started (Install, Computers, MCP), Features (Multiple
  agents, Self-improvement), Integrations (Slack, WhatsApp, Telegram, Connections, Claude plan), Manage (Security,
  Upgrade, Uninstall). The docs never show curl: Install is Download, open, first agent, then an optional computer
  added from Settings › Computers over Tailscale SSH.
- Screenshots (2026-11-17): `agent`, `computers`, `models` and `connect` are the desktop app (2360x1520 window shots
  scaled to 1456 wide); `slack`, `whatsapp` and `telegram` are the old dashboard's dialogs cropped to the dialog until
  they're retaken in the app. `.stage img` keeps a narrow shot at its own size. The MCP page has no shot: the dev
  build's commands show a checkout path; take it from the packaged app.

## The brand in the dashboard (`packages/desktop/src/renderer`)

- Owner, 2026-11-13: the dashboard uses the site's brand. Black primary (`--primary` is ink), the hut (`src/hut.svg`,
  the site's file) as logo and favicon, Fredoka 600 for the wordmark, Bebas Neue for display headings, Inter for text. `components/avatar.tsx` is the site's creature generator; creatures breathe and blink.
- Owner, 2026-11-13: **New agent** is a black button that creates "New agent" at once and opens its page at
  `/agents/<id>/name`, where the title is selected to type over. The name is edited in place (a `contenteditable`
  heading, no text box): double-click it or use the pencil shown on hover, Enter or click away saves, Escape cancels.
