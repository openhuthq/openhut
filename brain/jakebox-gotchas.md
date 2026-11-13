# JakeBox gotchas

Things that bit the v1 build; each is handled in the code it names.

- **node-postgres runs `{text, values: []}` over the simple protocol**, which executes several statements (`commit; delete …` escapes a read-only transaction). Only `values.length > 0` or `queryMode: "extended"` forces one statement. The gateway also wraps every query in `declare … cursor` + `fetch 1001`, which caps memory and allows only SELECT/VALUES (`app/gateway.ts`).
- **A read-only transaction doesn't contain a superuser**: `COPY … TO PROGRAM` and server-file functions still work. Refuse superuser and `pg_execute_server_program` / `pg_*_server_files` roles.
- **pg connection strings let `?host=` override the URL's host** and `?sslrootcert=` read local files. Parse into explicit fields; allow only `sslmode`.
- **`net.BlockList` matches IPv4-mapped IPv6** (`::ffff:127.0.0.1`) against IPv4 rules; `new URL` rewrites that to `::ffff:7f00:1`.
- **Rebuilding an iptables chain with `-F` + appends opens it briefly.** `iptables-restore --noflush` with `:AGENT - [0:0]` replaces one chain in one commit and leaves the others alone (`install/agents-firewall.sh`).
- **Docker restart policies start agents before any firewall.** Agents use `--restart no`; the app restarts the ones marked running through agentd, which checks the firewall first.
- **`-v` creates a missing bind source** as an empty root-owned folder; `--mount type=bind` fails instead.
- **BusyBox `sh` has no `exec -a`**; `install/supervise.sh` gives the restart loops a name `pkill` can find.
- **On Docker Desktop**, a reused `/var/lib/docker` volume brings back old containers; `dev/e2e.sh` prunes it to images only. Traffic between two Docker networks is dropped by Docker itself, so firewall tests need targets outside the server (`jakebox-lan`).
- **A bind mount of a folder that's renamed and deleted shows up empty**, while a single-file bind keeps its file. An upgrade that swaps `/opt/jakebox` must restart running agents (the app does it once per new build) or their `plugins/` mount goes empty.
- **`node --check file.ts` doesn't really parse TypeScript**: a duplicate `const` sailed through. Check with `module.stripTypeScriptTypes` into a `.mjs`, then `node --check` that.
