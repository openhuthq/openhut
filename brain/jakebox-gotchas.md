# JakeBox gotchas

Things that bit the v1 build; each is handled in the code it names. The code carries no comments, so the reasons behind
the installer, agentd and the e2e run live here. `jakebox-server.md` covers the app and `hermes.md` covers Hermes.

## Postgres and the gateway

- **node-postgres runs `{text, values: []}` over the simple protocol**, which executes several statements (`commit; delete …` escapes a read-only transaction). Only `values.length > 0` or `queryMode: "extended"` forces one statement. The gateway also wraps every query in `declare … cursor` + `fetch 1001`, which caps memory and allows only SELECT/VALUES (`packages/app/src/integrations/postgres/postgres.ts`).
- **A read-only transaction doesn't contain a superuser**: `COPY … TO PROGRAM` and server-file functions still work. Refuse superuser and `pg_execute_server_program` / `pg_*_server_files` roles.
- **pg connection strings let `?host=` override the URL's host** and `?sslrootcert=` read local files. Parse into explicit fields; allow only `sslmode`.
- **`net.BlockList` matches IPv4-mapped IPv6** (`::ffff:127.0.0.1`) against IPv4 rules; `new URL` rewrites that to `::ffff:7f00:1`.
- **`node --check file.ts` doesn't really parse TypeScript**: a duplicate `const` sailed through. Check with `module.stripTypeScriptTypes` into a `.mjs`, then `node --check` that.

## The installer (`install/`)

- `install.sh` is what `curl -fsSL https://get.jakebox.dev | sh` runs. It adds what's missing (Docker, gVisor, Node 22.18+), then JakeBox and the Claude CLI that the seat plugin drives. Every download is checked against a checksum written into the script; `scripts/release.sh` writes jakebox.tgz's. Re-running upgrades in place and keeps `/data` and `/etc/jakebox/env`. `RESOLVER`, `JAKEBOX_MODEL` (claude|test) and `SETUP_CODE` are read on the first install only.
- `AGENT_IMAGE` overrides the release's pinned Hermes image (`install/agent-image`, by digest) and is remembered in `/etc/jakebox/env`. Without it, every upgrade brings that release's pin. `pull-image.sh` pulls the image when it's missing, so a moved pin reaches new agents, then prepares the WhatsApp bridge. A bridge failure leaves WhatsApp off, not JakeBox.
- Package mirrors sometimes hang a connection, so every package and wget call runs under `timeout` and is retried. apk uses `/etc/apk/cache` when the host keeps one.
- A running dockerd re-reads its runtimes on SIGHUP. Agents can't start until it knows `runsc`.
- Each release is extracted to `/opt/jakebox.new` and swapped in whole, so nothing from the previous release lingers. Running processes keep the files they have open until they're replaced. Everything under `/opt/jakebox` is owned by root and writable only by root, because root runs agentd and the firewall from there.
- The Claude CLI is about 300 MB, so a verified copy is kept in `/var/cache/jakebox` for re-installs.
- The installer waits for a `/health` whose `started` is no earlier than its own start, so the app it replaces can't pass for the new one.
- **Without systemd** (a container, some VPS images), `host-start.sh` boots in the units' order: firewall, dockerd, agent image, agentd as root, then the app as `jakebox`. Nothing runs it at boot, and agents have no Docker restart policy, so after a reboot agents stay stopped until it runs. It's safe to run again: it replaces agentd and the app and leaves Docker, the agents and `/data` alone. Docker's pid files survive a container restart (on a real server `/run` is a tmpfs), so it deletes them when dockerd isn't running. As PID 1 of a container it stays up without depending on its children, so a re-install can replace them.
- `supervise.sh LOG CMD…` reruns CMD whenever it exits, like systemd's `Restart=always`. BusyBox `sh` has no `exec -a`, so this script gives the restart loops a name `pkill` can find.
- `prepare.sh` runs before agentd. It makes `/data/app` 0700 and owned by `jakebox`, because the database holds `auth_secret` (the unit's `UMask=0077` covers the files). It also writes the agents' `resolv.conf`.
- `whatsapp-bridge.sh` installs the bridge with `--omit=optional --ignore-scripts`. That keeps it pure JS on any libc, leaves out `sharp` (thumbnails) and runs no install scripts as root. The throwaway container it copies the code from is removed even when the copy fails.
- The first agentd start pulls the ~3 GB agent image, so `jakebox-agentd.service` has `TimeoutStartSec=infinity`.
- **Docker restart policies start agents before any firewall.** Agents use `--restart no`; the app restarts the ones marked running through agentd, which checks the firewall first.
- **`-v` creates a missing bind source** as an empty root-owned folder; `--mount type=bind` fails instead.
- **A bind mount of a folder that's renamed and deleted shows up empty**, while a single-file bind keeps its file. An upgrade that swaps `/opt/jakebox` must restart running agents (the app does it once per new build) or their `plugins/` mount goes empty.

## The firewall (`install/agents-firewall.sh`)

- It runs before dockerd starts and whenever agentd starts. Two chains:
  - `AGENT` (jumped to from DOCKER-USER) is agent traffic leaving the server. It drops Tailscale and allows DNS to the resolver. It allows HTTPS anywhere except private, link-local and CGNAT ranges, and drops everything else.
  - `AGENT-IN` (jumped to from INPUT) is traffic to the server itself. Agents reach only the gateway on 8081, with at most 16 connections per agent `/24`, and nobody else reaches 8081.
- **Rebuilding an iptables chain with `-F` + appends opens it briefly.** `iptables-restore --noflush` with `:AGENT - [0:0]` replaces one chain in one commit and leaves the others alone.
- Each jump must be the first rule of its chain, or a rule above it lets agent traffic skip ours. The script drops any copies and inserts the jump at the top. An `ip rule` at priority 5200 keeps agent networks on the main table, ahead of Tailscale's table 52.
- `--check` compares the chains, both jumps and the ip rule, as iptables prints them, with what was printed right after applying (`/run/jakebox/firewall.rules`). One missing or reordered rule therefore counts as off.

## agentd (`packages/agentd`)

- The app sends one JSON line per connection and half-closes its side. agentd answers that line (`allowHalfOpen` keeps its own side open for the reply) and ignores anything after it. Every argument is validated into a typed request (`AgentdRequest`) before Docker sees it.
- `/health` uses a firewall check at most 5 s old, so unauthenticated requests can't make root spawn processes on demand. create, start and restart always check afresh, and concurrent callers share one check in flight.
- The watchdog runs the check every 30 s. When it fails, the watchdog re-applies the firewall, and if that fails too it stops every agent.
- Every docker and firewall call has a 60 s timeout, so one hung call can't hold an agent's queue forever.
- Commands run one at a time per agent, so a start can't land inside another command's stop/start. `restartContainer` is the restart inside a command. `enqueueRestart` is for work outside one (a WhatsApp pairing that ended). Calling it from inside a command would wait on its own queue forever.
- Docker errors other than "already gone" stop a delete, so a container that's still running never loses its row.
- Rendered files are owned by root, readable by the agent's group and mounted read-only, so an agent can't change its own limits. Only files whose content changed are rewritten, so a running agent never sees its files truncated for nothing.
- An agent is stale when any rendered file is newer than its start, so a failed restart is retried by the next `apply`. `apply` restarts only when the agent should be running and either its files are stale or `force` is set. `force` means a new release, so the agent remounts the release's plugin and CLI.
- `platforms/` and `.claude/` are mounts of their own. They hold read-only mounts and, being mounts, can't be renamed away and recreated writable.
- **WhatsApp pairing** runs the bridge inside the agent's container. Killing `docker exec` leaves the bridge running inside, so a pairing that ends any way but "linked" restarts the container. A pairing that links restarts it too, so Hermes starts WhatsApp.
  - Only the agent's current pairing restarts it. `stop`, `rm` and `wa-unlink` drop the pairing first; otherwise stopping or deleting an agent mid-pairing brought it back.
  - The bridge's own logs share stdout with its JSON events, so lines that aren't JSON are skipped.
  - The pairing payload is either `2@…` or a `https://wa.me/…` link.

## The e2e run (`packages/e2e`)

- `npm run e2e` runs everything on a Mac with Docker Desktop, in this order:
  1. a tampered install on a throwaway server, which must be refused;
  2. build `e2e-1` installed with one curl on a bare `docker:dind` server, then the `main` phase;
  3. build `e2e-2` installed over it (the upgrade), then `after-upgrade`;
  4. a server restart, then `after-restart`;
  5. the report.

  It takes about 25 minutes and needs Node 22.18+ on the Mac and 127.0.0.1:8098, :8099 and :8787 free. The script is named `e2e`, not `test`, so turbo's test task never starts it.
- Named volumes cache Docker images (`jakebox-docker`), Alpine packages (`jakebox-apkcache`) and the Claude CLI (`jakebox-dlcache`). Everything else starts empty. On Docker Desktop, a reused `/var/lib/docker` volume brings back old containers, so `e2e.sh` prunes it to images only.
- Traffic between two Docker networks is dropped by Docker itself, so firewall targets live outside the server: `jakebox-lan` listens at an address in each private range and at the metadata address. Every target an agent must not reach is checked from the server too, where it must be open, so "blocked" can only come from the agent firewall.
- `sources.ts` fingerprints what the run ships or tests before it starts, and `report.ts` fails when the tree has changed since.
- `e2e.ts` isn't part of the release. It's copied onto the server after each install (the upgrade swaps in a clean `/opt/jakebox`) and runs there as root, playing the people, the channel and the attacker. `docker cp` keeps the Mac's owner, so the copy is chowned to root.
- Each check is its own `node:test` test, run in order, so one failure doesn't stop the rest. Results go to `results/e2e-<phase>.json` (`report.ts` and `scripts/plan-tab.ts` read them). `main` always writes `state.json` for the later phases: the agent, the OAuth refresh token, the firewall and the PIDs. Refresh tokens rotate, so each later phase saves the new one.
- The upgrade's release pins the same image as `docker.io/<pin>`, so the run can tell agentd took the new release's pin.
- The team DB's TLS files live in `/root`, because the server's `/tmp` is emptied when it restarts and the DB has to come back. `wrong.test` is the DB's address under a name its certificate lacks. The postgres image answers `pg_isready` on its socket during init, before it restarts, so the run waits for a TCP answer.
- The deployed gateway trusts public CAs only, so the test CA passes `sslmode=require` and fails `verify-full`/`verify-ca`. Name checking (K10b) runs `postgres.query` in a scratch process with the test CA trusted. U1 renders an agent's files in claude mode the same way, since the run has no real Claude subscription.
- The test model echoes a tool result as `TOOL RESULT: <untrusted_tool_result …>preamble\n\n{"result"|"error": …}`. Checks compare the gateway's own text inside it.
- The gateway-limit checks call the gateway straight from the agent's network with its token, because Hermes pauses a server for ~59 s after three refused calls.
- `/health` reads a firewall check at most 5 s old, so the watchdog checks wait for the 503 before acting.
- app.log holds evlog JSON lines, so the run matches events (`build.applied`, `reconcile.started`) rather than text.

## Local dev

- `npm run dev` builds the dashboard, then `scripts/dev.ts` starts `scripts/fake-agentd.ts` and the app with `JAKEBOX_DATA=.data`, `SETUP_CODE=dev` and `JAKEBOX_MODEL=test`. The fake agentd answers from memory without Docker, so agents never really run on a laptop. It mirrors agentd's reply shapes because the app validates every reply.
- Open `http://localhost:8787/setup?code=dev`. On a fresh `.data`, `node scripts/seed-ui.ts` adds sample people, agents and connections; sign in as `mo` with the password it prints.
