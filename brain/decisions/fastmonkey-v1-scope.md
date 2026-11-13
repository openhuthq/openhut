---
status: accepted
---
# Fast Monkey v1 scope

## Decision

- Name: Fast Monkey, at fastmonkey.dev. It was JakeBox until 2026-11-13, when it took over the name and domain from a retired Playwright test runner. Sidebar: Agents and Connections, with People and Admin at the bottom; no Settings page.
- Design: Skyfleet's layout and components (one navy primary, creature avatars) in Capy's light theme: light grey ground, near-white panel, white cards, one text colour, Inter 14px, 6–8px corners, chip tabs. Connections is a marketplace like Capy's Explore page. Clay, Mercury and Cursor were tried and dropped. The isolation plan page alone uses Cursor's design in white only. Code style stays Skyfleet's.
- Connections is a catalog like Skyfleet's integrations page, with real brand icons and no "Who has access" matrix.
- One gVisor container per agent. Shell and file tools stay on for every agent.
- Model: Claude subscription only, through Hermes's official `claude-subscription-directsdk` plugin. The customer buys a dedicated Claude seat for the agents and pastes one `claude setup-token` in Admin. Each agent picks Opus, Sonnet or Haiku.
- Channels: a native Hermes Slack app per agent, and a QR-linked WhatsApp number per agent. A channel can be open to anyone. Email (AgentMail) was dropped from v1 on 2026-11-12, so agents get no mail ports either: outbound is DNS and HTTPS only.
- Sign-up: the installer prints a one-time link (`/setup?code=…`); whoever opens it first becomes the owner with just a username and password. Then sign-up closes, and people join only by invite link (one use, 7 days, member or admin), made in People or by the `create_invite` tool. No open registration, no email.
- Approvals go to the agent's owner. Agents with an open channel use Hermes `smart` approvals.
- Activity is a tool-call log only. Schedules and agent-to-agent handoff are later.
- Cut on 2026-11-13: the `fastmonkey` CLI, the AWS template, the release console (and Admin's update check) and agent recipes.

## Context

Decided in a scoping session on 2026-11-12. Plans: claude.ai artifacts "Fast Monkey blueprint" and "Hermes Agent Isolation".

## Why

- A Slack bot per agent keeps Hermes's native Slack features and isolation. A shared bot needs one Hermes process (no isolation) or our own relay against Hermes's experimental contract.
- (Dropped) AgentMail would have given each agent an address over IMAP/SMTP; it can come back as a later channel.
- The subscription avoids per-token billing for the first customers.
- Fast Monkey is one curl command on one server, managed from the dashboard and the control MCP. A second client, a cloud template, an update registry and agent templates were more to maintain than they were worth.

## Consequences

- Anthropic's terms risk: plan limits "assume ordinary, individual usage", and "developers may not collect, store, or intermediate Claude.ai credentials". The plugin is experimental. Check with Anthropic before selling.
- All agents share one 5-hour plan window. Hermes waits out a limit for up to 600 s per retry; `api_max_retries` is raised.
- On an open channel a stranger can approve their own command, because Hermes always lets the requester approve.
