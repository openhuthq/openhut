---
name: openhut-dev-loop
description: Run and prove an OpenHut change. Use before starting work, when you want to see a change working, take a screenshot for a PR, or decide whether a change needs the desktop app or CI. Web app first, unpackaged Electron last, packaged builds only in CI.
---
OpenHut is developed as a web app. You see a change in a browser in seconds. Electron is the last check, and packaged builds belong to CI.

**1. Start the web app (every change)**
- `npm install` once per worktree, then `npm run dev`. It prints the Vite URL (5173 or the next free port). Open it in Claude in Chrome.
- Sign in: pick mo@example.com on the dev sign-in page. `npm run seed` adds sample agents and connections to a fresh `.data`. `npm run reset` wipes it.
- Real agents need `npm -w @openhut/desktop run pack-backend` once (needs `uv`). Screens, API and cloud work without it.
- Edit, and Vite hot-reloads. A runtime edit needs Ctrl-C and `npm run dev` again.

**2. Pick the proof by what you changed** (`git diff --name-only origin/main`)
- `packages/desktop/src/renderer/**`, `packages/runtime/**`, `packages/common/**`, `private/api/**`, `private/cloud/**`: the web app is the proof. Take a screenshot at the Vite URL and run `npm run check`. Done.
- `packages/desktop/src/main.mjs`, `preload.cjs`, `lib/desktop.ts`, or anything that needs Keychain, Touch ID, passkey, updates, deep links or the tray: also run `npm run app` (the real app, unpackaged) and then `npm run e2e:app`.
- `electron-builder*.yml`, `scripts/pack-*.mjs`, `install/**`, signing, installers: the PR's Desktop app run proves it. Don't build packages locally to check.

**The web app (Continue in web)**
- With `npm run dev` up and its runtime signed in, serve the web build: `VITE_OPENHUT_API_URL=http://127.0.0.1:<cloud port> VITE_OPENHUT_RELAY_URL=ws://127.0.0.1:<cloud port> node node_modules/vite/bin/vite.js packages/desktop/src/renderer --mode web --port 5190`.
- `RUNTIME=http://127.0.0.1:<runtime port> OUT=/tmp/web-e2e node_modules/.bin/electron packages/desktop/scripts/web-e2e.cjs` signs a fresh browser in, has the Mac approve it, opens the dashboard over the tunnel and saves screenshots. The Mac needs its kit saved first.

**3. Ship**
- Open the PR with the first push, start one background `gh run watch <id> --exit-status`, and end the turn. CI is the merge gate, not the loop: never wait inside a turn to see a change working.

**Keep the web and desktop apps the same**
- The dashboard reaches Electron only through `packages/desktop/src/renderer/src/lib/desktop.ts`. `desktop` is `undefined` in a browser, so every caller needs a browser path. A test fails if another file reads `window.openhut`.
- Before adding a `desktop` call, ask whether the work can be a runtime `/api` route instead. A route runs in the browser and the app alike; a `desktop` call needs Electron to test.

**Gotchas**
- Two worktrees can each run `npm run dev`: ports step to the next free one. Stop your own processes by PID (`lsof -tiTCP:<port>`), never `pkill -f`.
- The first `npm run app` or `e2e:app` on a Mac asks for the "OpenHut Dev Safe Storage" Keychain item. Only the owner can click Always Allow; until then the window shows but `/api` hangs.
