# Fast Monkey gotchas

Things that bit the v1 build; each is handled in the code it names. The code carries no comments, so the reasons behind
the installer, agentd and the e2e run live here. `fastmonkey-server.md` covers the app and `hermes.md` covers Hermes.

## Postgres and the gateway

- **node-postgres runs `{text, values: []}` over the simple protocol**, which executes several statements (`commit; delete …` escapes a read-only transaction). Only `values.length > 0` or `queryMode: "extended"` forces one statement. The gateway also wraps every query in `declare … cursor` + `fetch 1001`, which caps memory and allows only SELECT/VALUES (`packages/app/src/integrations/postgres/postgres.ts`).
- **A read-only transaction doesn't contain a superuser**: `COPY … TO PROGRAM` and server-file functions still work. Refuse superuser and `pg_execute_server_program` / `pg_*_server_files` roles.
- **pg connection strings let `?host=` override the URL's host** and `?sslrootcert=` read local files. Parse into explicit fields; allow only `sslmode`.
- **`net.BlockList` matches IPv4-mapped IPv6** (`::ffff:127.0.0.1`) against IPv4 rules; `new URL` rewrites that to `::ffff:7f00:1`.
- **A `lookup` hook never runs for IP-literal URLs.** Checking addresses in undici's `connect.lookup` alone let
  `http://127.0.0.1/` through; `guardedFetch` also checks literal hostnames in its connector (`platform/network.ts`).
- **The MCP SDK's refused-code error has an empty message** (`invalid_grant` with no description); the sign-in wraps it.

## Local dev

- `@fastify/static` is registered with `wildcard: false`, so it only serves files present at start. After rebuilding
  the dashboard, restart the app or new asset names fall through to `index.html` and the page stays blank.
- macOS caps Unix socket paths at 104 bytes; a long `AGENTD_SOCK` is cut short and fails with `EADDRINUSE`.
- Two worktrees can't run `npm run dev` at once: the gateway (8081, `config.ts`) and the fake Hermes (18642, `fake-agentd.ts` and `dev.ts`) are fixed, and `PORT` only moves 8787 (`seed-ui.ts` also assumes 8787). To check the UI from a second worktree, change those locally, run with `PORT`, and revert before committing. Don't point Vite at another worktree's app: it may be on a different API and the pages fail to parse.
- Stop your own dev server by PID (`lsof -nP -iTCP -sTCP:LISTEN`), never `pkill -f scripts/dev.ts`: that also matches other worktrees' servers, and killing only `dev.ts` leaves its app child holding the port.
- `config.port` is 8787 unless `PORT` is set; when an e2e run holds 8787, start the app with `PORT=8799`.
- `scripts/seed-ui.ts` hardcodes `127.0.0.1:8787`, so on another `PORT` seed from a copy with the port swapped. In the dashboard, "New agent" creates the agent on click (no form), so clicking it for a screenshot adds one.
- The button and dropdown rules (which variant for which action) are in `DESIGN.md` at the repo root and in `index.css` since 2026-11-13. `index.css` is one global namespace with short class names: a new `.role` for the invite popover restyled `.card .role` on the agent cards. Grep the stylesheet for a class name before adding it.
- Rebuilding `packages/web` while `npm run dev` is running leaves the app serving a blank page (the hashed asset names change); restart it.

## The installer (`install/`)

- `install.sh` is what `curl -fsSL https://fastmonkey.dev | sh` runs. It adds what's missing (Docker, gVisor, Node 22.18+), then Fast Monkey and the Claude CLI that the seat plugin drives. Every download is checked against a checksum written into the script; `scripts/release.sh` writes fastmonkey.tgz's. Re-running upgrades in place and keeps `/data` and `/etc/fastmonkey/env`. `RESOLVER`, `FASTMONKEY_MODEL` (claude|test) and `SETUP_CODE` are read on the first install only.
- `AGENT_IMAGE` overrides the release's pinned Hermes image (`install/agent-image`, by digest) and is remembered in `/etc/fastmonkey/env`. Without it, every upgrade brings that release's pin. `pull-image.sh` pulls the image when it's missing, so a moved pin reaches new agents, then prepares the WhatsApp bridge. A bridge failure leaves WhatsApp off, not Fast Monkey.
- Package mirrors sometimes hang a connection, so every package and wget call runs under `timeout` and is retried. apk uses `/etc/apk/cache` when the host keeps one.
- A running dockerd re-reads its runtimes on SIGHUP. Agents can't start until it knows `runsc`.
- Each release is extracted to `/opt/fastmonkey.new` and swapped in whole, so nothing from the previous release lingers. Running processes keep the files they have open until they're replaced. Everything under `/opt/fastmonkey` is owned by root and writable only by root, because root runs agentd and the firewall from there.
- The Claude CLI is about 300 MB, so a verified copy is kept in `/var/cache/fastmonkey` for re-installs.
- `uninstall.sh` (owner, 2026-11-13: one command instead of five steps) asks the person to type `uninstall`, then undoes everything `install.sh`, `prepare.sh` and the firewall add, except Docker, gVisor and Node. Each step ignores what's already gone, so it's safe on a half-installed server. Anything new the installer creates has to be added there too. Installs from before it don't have the file; re-running the install command brings it.
- **Update now** (Admin): `scripts/release.sh` writes the build into `install.sh` (`FASTMONKEY_BUILD`), so the app learns the latest build by fetching the installer from `FASTMONKEY_URL` (the address the install came from, kept in `/etc/fastmonkey/env`; cached a minute); no version file or registry. The build is a semver (owner, 2026-11-13: no timestamps in Admin): the major.minor of `packages/app/package.json` and the number of commits on `main` as the patch, so every merge is a new, higher version with nothing to bump by hand; `release.sh` refuses a shallow clone, where that count would be 1. A higher version is an update; a build that isn't a semver on either side (installs from before this, the e2e's `e2e-N`) is an update whenever it differs; a `dev` build is never offered one. Admin shows only this version; `version` in `/health` is still the package.json one. `POST /api/updates` (owner or admin) stores `{from, to, startedAt}` in `install_setting` and asks agentd for `update`, which takes no arguments and runs the same `curl | sh` as a person would. It must outlive agentd, which the installer restarts, so it runs as the transient unit `fastmonkey-update` (`systemd-run`; log: `journalctl -u fastmonkey-update`), or detached with its output in `/var/log/fastmonkey-boot.log` without systemd.
- **Update status lives on the server, not in the page** (owner, 2026-11-13: no dialog, it must survive a refresh and the restart, no error noise while it runs). `GET /api/admin` derives it: a new build means done (the record is cleared), the installer holding its lock means running, neither after 20 s (or 45 min in all) means failed. The Admin row polls while running and reloads itself when the build changes.
- **One install at a time, and a failed one changes nothing.** `install.sh` holds `flock` on `/run/fastmonkey-install.lock` (fd 9, closed for `host-start.sh` so the daemons don't keep it); agentd reports the lock as `updating` in `health` and refuses a second `update`. Before the swap nothing has changed (a bad download exits there). After it, `/opt/fastmonkey.old` is kept until `/health` is fresh; if that doesn't happen (5 min when the agent image pin is unchanged, else 30) the installer moves the old release back, restarts it and exits 1. A database migration the new release already ran is not undone, so migrations have to stay readable by the previous release.
- The installer waits for a `/health` whose `started` is no earlier than its own start, so the app it replaces can't pass for the new one.
- **Without systemd** (a container, some VPS images), `host-start.sh` boots in the units' order: firewall, dockerd, agent image, agentd as root, then the app as `fastmonkey`. Nothing runs it at boot, and agents have no Docker restart policy, so after a reboot agents stay stopped until it runs. It's safe to run again: it replaces agentd and the app and leaves Docker, the agents and `/data` alone. Docker's pid files survive a container restart (on a real server `/run` is a tmpfs), so it deletes them when dockerd isn't running. As PID 1 of a container it stays up without depending on its children, so a re-install can replace them.
- `supervise.sh LOG CMD…` reruns CMD whenever it exits, like systemd's `Restart=always`. BusyBox `sh` has no `exec -a`, so this script gives the restart loops a name `pkill` can find.
- `prepare.sh` runs before agentd. It makes `/data/app` 0700 and owned by `fastmonkey`, because the database holds `auth_secret` (the unit's `UMask=0077` covers the files). It also writes the agents' `resolv.conf`.
- `whatsapp-bridge.sh` installs the bridge with `--omit=optional --ignore-scripts`. That keeps it pure JS on any libc, leaves out `sharp` (thumbnails) and runs no install scripts as root. The throwaway container it copies the code from is removed even when the copy fails.
- The first agentd start pulls the ~3 GB agent image, so `fastmonkey-agentd.service` has `TimeoutStartSec=infinity`.
- **Docker restart policies start agents before any firewall.** Agents use `--restart no`; the app restarts the ones marked running through agentd, which checks the firewall first.
- **`-v` creates a missing bind source** as an empty root-owned folder; `--mount type=bind` fails instead.
- **A bind mount of a folder that's renamed and deleted shows up empty**, while a single-file bind keeps its file. An upgrade that swaps `/opt/fastmonkey` must restart running agents (the app does it once per new build) or their `plugins/` mount goes empty.

## The firewall (`install/agents-firewall.sh`)

- It runs before dockerd starts and whenever agentd starts. Two chains:
  - `AGENT` (jumped to from DOCKER-USER) is agent traffic leaving the server. It drops Tailscale and allows DNS to the resolver. It allows HTTPS anywhere except private, link-local and CGNAT ranges, and drops everything else.
  - `AGENT-IN` (jumped to from INPUT) is traffic to the server itself. Agents reach only the gateway on 8081, with at most 16 connections per agent `/24`, and nobody else reaches 8081.
- **Rebuilding an iptables chain with `-F` + appends opens it briefly.** `iptables-restore --noflush` with `:AGENT - [0:0]` replaces one chain in one commit and leaves the others alone.
- Each jump must be the first rule of its chain, or a rule above it lets agent traffic skip ours. The script drops any copies and inserts the jump at the top. An `ip rule` at priority 5200 keeps agent networks on the main table, ahead of Tailscale's table 52.
- `--check` compares the chains, both jumps and the ip rule, as iptables prints them, with what was printed right after applying (`/run/fastmonkey/firewall.rules`). One missing or reordered rule therefore counts as off.

## agentd (`packages/agentd`)

- The app sends one JSON line per connection and half-closes its side. agentd answers that line (`allowHalfOpen` keeps its own side open for the reply) and ignores anything after it. Every argument is validated into a typed request (`AgentdRequest`) before Docker sees it.
- `/health` uses a firewall check at most 5 s old, so unauthenticated requests can't make root spawn processes on demand. create, start and restart always check afresh, and concurrent callers share one check in flight.
- The watchdog runs the check every 30 s. When it fails, the watchdog re-applies the firewall, and if that fails too it stops every agent.
- Every docker and firewall call has a 60 s timeout, so one hung call can't hold an agent's queue forever.
- Commands run one at a time per agent, so a start can't land inside another command's stop/start. `restartContainer` is the restart inside a command. `enqueueRestart` is for work outside one (a WhatsApp pairing that ended). Calling it from inside a command would wait on its own queue forever.
- Docker errors other than "already gone" stop a delete, so a container that's still running never loses its row.
- **Container flags reach existing agents through `SPEC`.** Each container carries the label `fastmonkey.spec`; when `apply` finds a different one it removes the container and creates it again (the home folder stays), then starts it if it should run. Bump `SPEC` in `agentd.ts` with any change to the `docker create` flags. `apply` takes the agent's `net` for this.
- Rendered files are owned by root, readable by the agent's group and mounted read-only, so an agent can't change its own limits. Only files whose content changed are rewritten, so a running agent never sees its files truncated for nothing.
- An agent is stale when any rendered file is newer than its start, so a failed restart is retried by the next `apply`. `apply` restarts only when the agent should be running and either its files are stale or `force` is set. `force` means a new release, so the agent remounts the release's plugin and CLI.
- `platforms/` and `.claude/` are mounts of their own. They hold read-only mounts and, being mounts, can't be renamed away and recreated writable.
- **WhatsApp pairing** runs the bridge inside the agent's container. Killing `docker exec` leaves the bridge running inside, so a pairing that ends any way but "linked" restarts the container. A pairing that links restarts it too, so Hermes starts WhatsApp.
  - Only the agent's current pairing restarts it. `stop`, `rm` and `wa-unlink` drop the pairing first; otherwise stopping or deleting an agent mid-pairing brought it back.
  - The bridge's own logs share stdout with its JSON events, so lines that aren't JSON are skipped.
  - The pairing payload is either `2@…` or a `https://wa.me/…` link.

## The e2e run (`packages/e2e`)

- While a run is going, the Docker containers `fastmonkey-host` (holding 127.0.0.1:8787) and `fastmonkey-lan` are its server. Don't run anything inside them and don't edit the tree: the report then says "the tree changed during the run" and the run is no verdict. On 2026-11-13 a run failed only UD2 (build `e2e-3` never healthy) after both happened mid-update; the cause wasn't confirmed. For a local dashboard meanwhile, `PORT=8799 node scripts/dev.ts` works.
- `npm run e2e` runs everything on a Mac with Docker Desktop, in this order:
  1. build `e2e-1` installed with one curl on a bare `docker:dind` server (the only preparation is `apk add curl`), then the `main` phase;
  2. build `e2e-2` with one byte of its `fastmonkey.tgz` changed, installed over it, which must fail and leave `e2e-1` running;
  3. the real `e2e-2` installed over it (the upgrade), then `after-upgrade`;
  4. a server restart, then `after-restart`;
  5. Update now against a release whose app can't start (`update-broken`: rolled back, Admin says failed), then against the real `e2e-3` (`update`);
  6. the report.

  It takes about 25 minutes and needs Node 22.18+ on the Mac and 127.0.0.1:8099 and :8787 free. The script is named `e2e`, not `test`, so turbo's test task never starts it.
- Releases are served by the site's Worker under `wrangler dev` on :8099, with one release folder as its assets. It listens on 0.0.0.0 so the Docker server reaches it through `host.docker.internal`. `release.sh` deletes and recreates `dist/`, so the mirror is restarted for each release, and the tampered copy gets its own folder, `dist/tampered`.
- The tampered build is `e2e-2`, not the running `e2e-1`, so an install that went through would show up as a changed `BUILD`.
- Named volumes cache Docker images (`fastmonkey-docker`), Alpine packages (`fastmonkey-apkcache`) and the Claude CLI (`fastmonkey-dlcache`). Everything else starts empty. On Docker Desktop, a reused `/var/lib/docker` volume brings back old containers, so `e2e.sh` prunes it to images only.
- Traffic between two Docker networks is dropped by Docker itself, so firewall targets live outside the server: `fastmonkey-lan` listens at an address in each private range and at the metadata address. Every target an agent must not reach is checked from the server too, where it must be open, so "blocked" can only come from the agent firewall.
- `e2e.sh` hashes the tree (`HEAD`, `git diff HEAD` and the untracked files) at the start and again at the end, and the report fails if they differ, so it always describes the code that ran.
- `e2e.ts` isn't part of the release. It's copied onto the server after each install (the upgrade swaps in a clean `/opt/fastmonkey`) and runs there as root, playing the people, the channel and the attacker. `docker cp` keeps the Mac's owner, so the copy is chowned to root.
- Each check is its own `node:test` test, run in order, so one failure doesn't stop the rest. Results go to `results/e2e-<phase>.json`, which `report.ts` turns into `e2e-report.md`, next to the install, tamper and upgrade logs (setup code redacted), the server's logs, the container spec, the firewall and the probes' matrices. `main` always writes `state.json` for the later phases: the agent, the OAuth refresh token, the firewall and the PIDs. Refresh tokens rotate, so each later phase saves the new one.
- The upgrade's release pins the same image as `docker.io/<pin>`, so the run can tell agentd took the new release's pin.
- The team DB's TLS files live in `/root`, because the server's `/tmp` is emptied when it restarts and the DB has to come back. `wrong.test` is the DB's address under a name its certificate lacks. The postgres image answers `pg_isready` on its socket during init, before it restarts, so the run waits for a TCP answer.
- The deployed gateway trusts public CAs only, so the test CA passes `sslmode=require` and fails `verify-full`/`verify-ca`. Name checking (K10b) runs `postgres.query` in a scratch process with the test CA trusted. The run has no real Claude subscription, so claude mode's rendered files are a unit test (`hermes-files.test.ts`).
- D6 counts the audit rows it expects as the run goes: every `callTool` and `chat('sql: …')` adds one, by its reply (allowed, `Denied:` or failed).
- The test model echoes a tool result as `TOOL RESULT: <untrusted_tool_result …>preamble\n\n{"result"|"error": …}`. Checks compare the gateway's own text inside it.
- The gateway-limit checks call the gateway straight from the agent's network with its token, because Hermes pauses a server for ~59 s after three refused calls.
- `/health` reads a firewall check at most 5 s old, so the watchdog checks wait for the 503 before acting.
- app.log holds evlog JSON lines, so the run matches events (`build.applied`, `reconcile.started`) rather than text.

## Local dev

- `npm run dev` builds the dashboard, then `scripts/dev.ts` starts `scripts/fake-agentd.ts` and the app with `FASTMONKEY_DATA=.data`, `SETUP_CODE=dev` and `FASTMONKEY_MODEL=test`. The fake agentd answers from memory without Docker, so agents never really run on a laptop. It mirrors agentd's reply shapes because the app validates every reply.
- Open `http://localhost:8787/setup?code=dev`. On a fresh `.data`, `node scripts/seed-ui.ts` adds sample people, agents and connections; sign in as `mo` with the password it prints.
- `scripts/release.sh` runs on macOS (BSD tar) and in CI (GNU tar). Their flags for a root-owned archive differ (`--uid 0 --uname root` vs `--owner=0 --numeric-owner`), so the script picks by `tar --version`; the first CI deploy failed on `--uid`.

## Seat usage (Admin)

- A `claude setup-token` seat has only the `user:inference` scope, so `/api/oauth/usage` refuses it (`user:profile` required) and Claude Code's `get_usage` answers `rate_limits: null`. The plan % comes from the `anthropic-ratelimit-unified-{5h,7d}-utilization` and `-reset` headers of a 1-token Haiku message instead (`count_tokens` carries none). The app sends one per 5 minutes at most, only while someone has Admin open.
- Only windows Claude is tracking come back: often `7d` alone, no `5h`.
- The seat's % also counts anyone else signed in to that Claude account, so per agent we show shares of what agents used, not shares of the seat: agentd sums `estimated_cost_usd` (API list price) from each agent's Hermes `state.db` `sessions`, for sessions active since the weekly window opened. A long session counts in full, including what it spent before the window.

## GitHub bot (`integrations/github/github.ts`)

- The same callback URL is hit twice with one `state`: first with `code` (the app exists; exchange it for the key within the hour, then send the browser to the install page), then with `installation_id`. The sign-in is remembered again between the two, so a restart in between leaves an app on GitHub with no connection; delete it under GitHub's Developer settings.
- The installation is fetched with the app's own JWT before it's saved, so a made-up `installation_id` can't attach someone else's installation.
- A personal-account app can only be installed on that account. For an organization's repositories the app must be created under the organization (the dialog's Organization field), which needs an org owner.
- The bot's permissions are fixed in the manifest (contents, pull requests and issues write; actions and checks read). Pushing changes to `.github/workflows` needs the Workflows permission, added on the app's page on GitHub.
- GitHub connections are saved with `sign_in` false, so there's no Reconnect: a new bot means delete and connect again.

