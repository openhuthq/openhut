---
status: accepted
---
# agentd runs agents through one sandbox interface

## Decision
Owner, 2026-11-17. agentd talks to agents only through `Sandboxes` (`packages/runtime/src/agentd/sandbox/sandbox.ts`): `ready`, `create`, `start`, `stop`, `remove`, `exec`, `run`, `list`. `OPENHUT_SANDBOX` picks one of three:
- **gvisor** (Linux servers, the default): Docker with `runsc`, a network per agent and the host iptables `AGENT` chain; `ready` fails when the firewall is off.
- **microsandbox** (the desktop app on Mac and Linux): one libkrun microVM per agent, with microsandbox's host-side egress policy: deny by default, public 443 plus the host's 53 and 8081 only.
- **memory** (dev and tests): no processes, no network.

`run` (one-off commands such as reading the image) never has a network: `--network none` on gVisor, `disableNetwork()` on microsandbox.

## Context
The desktop app (`desktop-app.md`) can't count on Docker, and Macs can't run gVisor without a Linux VM. The survey of how other agent products isolate agents is in `brain/agent-sandboxing-survey.md`.

## Why
- The whole agent (Hermes and Chromium) stays inside the boundary on every platform, which a process sandbox (Seatbelt, bubblewrap, Landlock) can't promise.
- One interface keeps agentd's lifecycle, file and message code the same whichever backend runs.
- Egress is enforced outside the guest in both real backends, so an injected agent can't loosen it.

## Consequences
- `packages/runtime/test/agentd/sandbox/contract.test.ts` is one suite every backend must pass (`OPENHUT_SANDBOX=… npm test`); a plain `npm test` runs it on memory.
- agentd proves the fence at start (`packages/runtime/src/agentd/fence.ts`): from a throwaway sandbox, the host's private address, cloud metadata and the tailnet on 443, and a listener agentd holds open on the host for the probe, must be refused, and public HTTPS and the gateway reached. On gVisor refused means a connect timeout (the firewall drops; a reset means something answered); on microsandbox, the policy-denied reply or a failed connection. The report is agentd's `fence` command.
- Two real backends to maintain; microsandbox is a pinned beta (`0.7.15`) with weekly releases.
- The model key still sits inside each sandbox; a gateway-swapped placeholder is the next step.
