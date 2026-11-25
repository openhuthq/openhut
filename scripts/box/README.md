# Box e2e harness

Real Ubuntu 24.04 machines on [Box](https://box.dev) to test self-hosted OpenHut end to end: one medium `main`
and N small runtimes, created in parallel and kept awake. For later milestones and the deploy rehearsal.

Needs the `box` CLI signed in (`box login`) with SSH set up (`ssh box-<name>.box` works), and Node 22.18+.

```sh
E=scripts/box/e2e.ts
node $E up      smoke --runtimes 1          # box-oh-smoke-main (medium) + box-oh-smoke-rt1 (small), awake 1 day, ssh ready
node $E install smoke                       # curl -fsSL https://openhut.dev | sh on main, then a preview URL for :8787
node $E install smoke --script install/install.sh   # or a local installer, piped over ssh
node $E join    smoke --code <code>         # each runtime runs: curl openhut.dev | sh -s -- join <code>
node $E join    smoke --cmd '<command>'     # or the exact command main's app printed
node $E exec    smoke main 'docker ps'      # main, rt1, rt2, ...
node $E logs    smoke                       # docker ps/images/df, docker logs of every container, host info
node $E down    smoke                       # deletes every box-oh-smoke-* machine
```

Everything lands in `$BOX_E2E_OUT/<run-id>/` (default `plan/deploy-evidence/<run-id>/`, relative to where you run it):
`harness.log` (timings), `install.log` (with the setup link), `preview-url.txt`, and one folder per machine from `logs`.
`BOX_ENV` picks the Box environment (default `box`). Always `down` when done: medium is about $0.036/h, small $0.018/h.

## How it works, and the gaps

- **Create.** `box new -e box -n <name> --size <s> --awake 1` creates non-interactively (it opens Claude, which exits at
  once on closed stdin, and leaves a local worktree under `~/.box`). If that ever stops working, create the machines
  with the Box MCP tool `create_agent {"environment":"box","name":"oh-<run>-main","size":"medium"}` (and
  `oh-<run>-rt1`, small), then run `up` again: it skips machines that exist and does the rest (ssh wait, `box awake`).
- **Awake.** Machines sleep after 5 idle minutes, which kills containers; `--awake 1` and `box awake` keep them up a day.
- **Address.** `install` makes two previews (Box previews only ports bound on `0.0.0.0`, so each is a `socat` systemd unit):
  `:8788` to Caddy on :80, where the first visitor creates the owner, and `:8789` to the app on 127.0.0.1:8787, to give as the
  address (Caddy then tries Let's Encrypt for it and fails, which is expected; the real certificate is tested at deploy).
  `RUNTIME_IMAGE=<ref>` in the environment installs that image instead of the pinned one.
- **Join (M2).** The runtime can't hand out a join code headlessly yet, so `join` takes the code or command from outside.
- **App.** 8787 serves the web App, the API and `/health` on one origin.
