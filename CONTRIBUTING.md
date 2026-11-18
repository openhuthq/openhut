# Contributing to OpenHut

Thanks for taking the time to help. Bug reports, fixes, docs and ideas are all welcome.

Most changes here are written with a coding agent, so this guide is addressed to the agent as much as to you. If you
use one, point it at this file. If you are one, do what it says.

## Before you write anything

Read these first. They are short, and a change that ignores them will be sent back.

1. **[`CLAUDE.md`](CLAUDE.md)**: what each package is, the conventions, and how to run and test.
2. **[`DESIGN.md`](DESIGN.md)**: every rule behind the dashboard's look. Read it before touching `packages/desktop/src/renderer`. Use
   the classes and tokens it names; don't add a colour, a button variant or a size it doesn't have.
3. The reasons behind the code live in our private notes, so they aren't in this repo. If a change needs a reason that
   the code can't carry, put it in the pull request description.

## Coding style

- No comments in executable code. A reason worth keeping goes in the pull request description.
- A module is `<name>-service.ts` (the only layer that touches the database or agentd) and `<name>-controller.ts`
  (one-line handlers, request schemas at the end). `app.ts` only registers controllers.
- `platform/config.ts` is the only file that reads env vars.
- Exported functions with more than one parameter take one object.
- No `any`, no nested ternaries.
- Throw only `HttpError`, with a sentence for the message.
- Log through evlog, never `console`.
- The API follows Stripe's shapes: flat collections, `{ object: 'list', url, hasMore, data }`,
  `{ id, object, deleted: true }`, `{ error: { type, message, param? } }`.
- Outside services live in `packages/runtime/src/server/integrations/<service>/`.
- In the dashboard: server data through `useQuery`/`useMutation`, forms uncontrolled, the open dialog in the URL.
- Tests mirror source paths.
- Single quotes, no semicolons, `.ts` imports.
- Reuse what's there before adding a helper, and don't add a dependency for what a few lines can do.

## Run it

Node 22.18 or newer.

```
npm install
npm run dev
```

Open `http://localhost:5173`. `node scripts/seed-ui.ts` on a fresh `.data` fills in sample agents and
connections. agentd runs with the memory sandbox, so agents never really run on a laptop.

## Check it

```
npx turbo run build typecheck test
```

This must pass before you open a pull request. A change to the installer, agentd, the firewall or an upgrade also
needs `npm run e2e` (Docker, about 25 minutes; plan in `docs/verification-plan.md`). A change to the dashboard needs a
look in the browser, not just a green build.

## Pull requests

- Keep one small change per pull request. For anything large, open an issue first so we can agree on the shape.
- Say what changed and why, and how you checked it. Add a screenshot for anything visible.
- Add or update the test next to the code you changed.
- If you learned something a later reader will need (a gotcha, a reason, a decision), write it in the pull request
  description.
- Never commit secrets, server addresses or personal details, in code or in a pull request. The whole history is public.
- You are responsible for what your agent wrote. Read the diff before you send it.

## Security

Don't open a public issue for a vulnerability. Report it privately through
[GitHub's security advisories](https://github.com/openhuthq/openhut/security/advisories/new).

## License

By contributing you agree that your work is licensed under the [MIT License](LICENSE).
