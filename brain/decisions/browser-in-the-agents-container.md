---
status: proposed
---
# The browser runs in the agent's own container, behind a switch that is off

## Decision
An agent browses with Hermes's own local Chromium, inside its existing gVisor container. Each agent has a **Browser** switch, off by default. No cloud browser, no shared browser service, no new firewall rule, no new key.

## Context
2026-11-16. The browser was switched on and off again on 2026-11-13 with two things unanswered: Chromium had never run under gVisor at 1 GB, and a browser reads far more untrusted text. Design and results: https://claude.ai/artifact/JYrTkduUEnqd3aD7hsWh3m.

## Why
- It runs: under the agent's exact flags Hermes's `browser_exec` opened a page in 3 s and used about 300 MiB with two heavy tabs.
- It adds no way out. The browser shares the agent's network, so the firewall's rules for the shell (DNS and 443 only, no private ranges) are the browser's rules too. Chromium's own sandbox is off in a container, which is fine only because the container is the sandbox.
- A cloud browser (Browserbase, Browser Use) would put a paid key in every agent's `.env` and send pages to a third party, and it does nothing about hostile page text. A browser we host outside the agent's container would be a new process that holds no sandbox and serves several agents.
- Hostile page text can't be configured away, so it is a choice per agent. An agent that browses and also holds a database grant can be talked into sending rows out over HTTPS; the same was already true of any agent that runs `curl`.

## Consequences
- The column is `agent.web_browser`, not `browser`: the 2026-11-13 build added `browser` defaulting to true and never dropped it, so reusing the name would have switched the browser on for those servers' agents.
- Heavy sites can pass 1 GB with Hermes; the agent is then killed and restarted. Pick Large for an agent that browses a lot.
- Sites that need a login or a CAPTCHA, or that serve plain HTTP only, don't work. An egress allowlist per agent is the next step if a customer needs "only these sites".
- Not merged (2026-11-16): the owner asked for one shared browser with a live view in the control panel instead. That design (a browser container on `10.200.251.0/24`, a broker that alone speaks CDP, one browser context per agent, tools through the gateway as a `browser` connection) is the second tab of the artifact above, with a clickable mock at https://claude.ai/artifact/VYh5iesUZJnrvWExyfFWSs. The owner chooses between the two.
