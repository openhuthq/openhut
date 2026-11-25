---
name: openhut-dev-loop
description: Run and prove an OpenHut change. Use before starting work, when you want to see a change working, take a screenshot for a PR, or decide whether a change needs CI. Web app first, the browser run and image smoke in CI.
---
OpenHut is a web app. You see a change in a browser in seconds.

**1. Start the web app (every change)**
- `npm install` once per worktree, then `npm run dev`. It prints the Vite URL (5173 or the next free port). Open it in Claude in Chrome: it opens straight into the app, no sign-in (Vite's `/api` proxy adds `Authorization: Bearer dev`).
- `npm run seed` adds sample agents and connections to a fresh `.data`. `npm run reset` wipes it.
- Agents are Docker containers (gVisor where `runsc` works). They start only where the agents firewall applies (Linux, agentd as root), so on a Mac screens and the API work and agents stay stopped; the image smoke in CI runs real ones.
- Edit, and Vite hot-reloads. A runtime edit needs Ctrl-C and `npm run dev` again.

**2. Pick the proof by what you changed** (`git diff --name-only origin/main`)
- `packages/app/**`, `packages/runtime/**`, `packages/common/**`: the web app is the proof. Take a screenshot at the Vite URL and run `npm run check`. Done.
- `install/**`, `scripts/image*.sh`: CI's runtime image smoke proves it (Promote, or `runtime-image.yml` by hand). Don't build the image locally to check.
- `site/**`: `npm --prefix site run typecheck` and `npm --prefix site test`.

**The browser run**
- `scripts/web-e2e.sh` starts a fresh dev stack, opens the app in Chrome (playwright-core), checks the shell renders with no sign-in and Settings › Computers shows This computer, and saves screenshots. CI's gate runs it.

**3. Ship**
- Open the PR with the first push, start one background `gh run watch <id> --exit-status`, and end the turn. CI is the merge gate, not the loop: never wait inside a turn to see a change working.

**Gotchas**
- Two worktrees can each run `npm run dev`: ports step to the next free one. Stop your own processes by PID (`lsof -tiTCP:<port>`), never `pkill -f`.
