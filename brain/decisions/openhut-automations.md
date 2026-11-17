---
status: superseded
---
# Automations: OpenHut schedules and runs them, Hermes sends the result

## Decision
Superseded (owner, 2026-11-17): automations are out of scope for now and their code, API, MCP tools, agentd `send`/`send-targets` and docs page are gone. The `automation` and `automation_run` tables are kept, unused and no longer created by migrate, so existing installs keep their rows for a future return. What follows is how they worked.

Owner, 2026-11-15: an agent can have automations that start on a schedule (hourly, daily, weekdays, weekly, at a time in the server's time zone). Webhook triggers (`POST /hooks/:id`) were removed on 2026-11-17: OpenHut takes no calls from the internet, and public inbound waits for the managed-cloud relay (`app-aggregates-runtimes.md`); migrate switches off the webhook automations it finds and keeps their rows. OpenHut owns them: rows in `automation` and `automation_run`, one `setTimeout` set to the soonest `next_run_at` (no polling, no cron library, capped at 24 h and reset on every change). A run asks the agent through the same Hermes chat call as the dashboard, in a fresh session, and saves the answer. If the agent answers `[SILENT]` the run is "quiet" and nothing is posted. Otherwise agentd runs `hermes send --to <target>` in the agent's container, so Slack, Telegram and WhatsApp are posted the same way with the agent's own connections, and OpenHut holds no bot tokens for it. Places to post come from `hermes send --list --json`.

## Context
The owner wanted scheduled agents, managed from the dashboard and the control MCP, with every channel treated equally.

## Why
- Hermes's scheduled jobs (`/api/jobs`) have no route for past runs and can't take a webhook body, so the dashboard couldn't show runs or pass a payload.
- Hermes deliberately has no agent-callable send-message tool, so prompting the agent to "send this to #gtm" does nothing. `hermes send` is Hermes's own sender and reuses the gateway's credentials with no model call.
- One timer over a stored `next_run_at` survives restarts and wakes only when something is due. node-cron ticks every second and keeps schedules in memory.

## Consequences
- A run missed by more than an hour (OpenHut was down) is saved as skipped, not caught up. Runs left "running" by a restart are marked failed at boot. Runs older than 30 days are deleted.
- One run per automation at a time; a second Run now gets 429.
- `hermes send --list` only knows chats Hermes has seen or has as home channels, so a new Slack channel may not be listed until the agent has been in it.
- No cron syntax, retries, or per-automation model. Add them when someone asks.
