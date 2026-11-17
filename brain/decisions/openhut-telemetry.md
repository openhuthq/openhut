---
status: accepted
---
# Usage telemetry, on by default, through one event hub

## Decision
Owner, 2026-11-15: self-hosted OpenHut servers send usage events to openhut.dev by default. An owner or admin turns it off or on in Admin › Usage data (the `usage_data` setting; owner, the same day, replacing an `OPENHUT_TELEMETRY` env var). Turning it off drops the unsent queue and stops the message polling and daily check-in. The installer's last lines and the docs Security page say so. The only personal detail ever sent is the owner's email, on `setup_completed` and the daily `instance_active`, so we know whose server it is. Agent names go on `message_sent`. Nothing else: no other emails, people's names, message content, skills, memories, credentials or OpenHut ids.

## Context
We had no idea how many servers run OpenHut or what teams do with it. Databuddy (website "OpenHut", client id `40a6e1dc-4e64-4fd6-8b92-415a77397465`) already holds the site analytics.

## Why
One hub keeps it auditable. `record()` in `packages/runtime/src/server/platform/events.ts` still logs every audit event through evlog. It also maps an allow-list of actions to events in `packages/common/src/telemetry.ts`, the one catalog of event names and allowed properties. It queues them and sends a batch every minute to `POST https://openhut.dev/api/events`. The Worker hub (`packages/site/src/hub.ts`) checks the batch against the same catalog, logs it to Workers Logs, and forwards it to Databuddy with `DATABUDDY_API_KEY`, a Worker secret. Customer servers never hold a Databuddy key. Each server is a random `instance_id` setting, sent as Databuddy's anonymous id.

## Consequences
- A new event is one line in the catalog. A property not on its list, or a value that isn't a short token (or an email for `*_email` keys, or up to 64 printable characters for `*_name` keys), is dropped on both sides.
- Test-model servers (dev, unit tests, e2e) never send. The Worker only forwards from openhut.dev, so `wrangler dev` and previews don't count.
- A failed send logs `telemetry.send_failed` and drops that batch. Counts can undercount when openhut.dev is unreachable.
- Retention (owner, 2026-11-15): one `message_sent` event per message a person sends an agent, with only `channel` (slack, whatsapp, telegram, dashboard, other), `agent_name` and its time (owner, the same day: the agent's name is fine, the content and sender are not); Databuddy does the counting. Every minute the app asks agentd for messages newer than the last one it saw (`messages` command: `role = 'user'` rows of each agent's Hermes `state.db`, joined to `sessions.source`). Only the agent id, channel and timestamp leave agentd: no content, no sender. The app looks up the agent's name. It starts from the app's start time, so history isn't backfilled. A daily-summary version was rejected: the owner wants the raw events.
- The dashboard sends only `dashboard_page_viewed` (route name, never the URL) to `/api/events` on its own server, which signed-in people only can call.
- Site pages use the Databuddy script directly (page views, web vitals, errors) plus `install_command_copied` and `github_clicked`. The Worker adds `install_script_fetched` and `release_downloaded`, which count installs and upgrades together.
