---
name: openhut-dev-loop
description: Run and prove an OpenHut change. Use before starting work, when you want to see a change working, take a screenshot for a PR, or decide whether a change needs CI. Web app first, the browser run and image smoke in CI.
---
OpenHut is a web app. You see a change in a browser in seconds.

**1. Start the web app (every change)**
- `npm install` once per worktree, then `npm run dev`. It prints the Vite URL (5173 or the next free port). Open it in Claude in Chrome.
- Sign in: pick mo@example.com on the dev sign-in page. `npm run seed` adds sample agents and connections to a fresh `.data`. `npm run reset` wipes it.
- Real agents need `npm -w @openhut/release run pack-backend` once (needs `uv`). Screens, API and cloud work without it.
- Edit, and Vite hot-reloads. A runtime edit needs Ctrl-C and `npm run dev` again.

**2. Pick the proof by what you changed** (`git diff --name-only origin/main`)
- `packages/app/**`, `packages/runtime/**`, `packages/common/**`, `private/api/**`: the web app is the proof. Take a screenshot at the Vite URL and run `npm run check`. Done.
- `install/**`, `packages/release/**`, `scripts/pack*`: CI's server smoke and packs prove it. Don't build packages locally to check.

**The web App through the Cloud**
- With `npm run dev` up and its runtime signed in, serve the web build: `OPENHUT_WEB=1 OPENHUT_API_URL=http://127.0.0.1:<cloud port> node node_modules/vite/bin/vite.js packages/app --port 5190` (the same App; `/config.json` there has no `local`, so it goes through the Cloud).
- `scripts/web-e2e.sh` does all of that on a fresh stack, then signs a fresh browser in, opens the dashboard over the tunnel, invites a teammate and saves screenshots (Chrome through playwright-core).

**3. Ship**
- Open the PR with the first push, start one background `gh run watch <id> --exit-status`, and end the turn. CI is the merge gate, not the loop: never wait inside a turn to see a change working.

**Gotchas**
- Two worktrees can each run `npm run dev`: ports step to the next free one. Stop your own processes by PID (`lsof -tiTCP:<port>`), never `pkill -f`.
