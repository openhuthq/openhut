---
status: accepted
---
# Slack agents answer in the channels you pick, not to people you list

## Decision
Owner, 2026-11-16: a Slack agent is shared with channels, never with member IDs. Setup is create the app, paste three tokens, then pick channels from a dropdown. The agent page edits the list in place (× to remove, the same dropdown to add); nothing else shows under it (an "Allow" list of channels the bot is in was dropped, owner 2026-11-16: "we just wanted the dropdown"). Every channel type counts: public, private, Slack Connect (tagged "shared") and group DMs, listed the way Craftspace does (two `conversations.list` calls, `public_channel,private_channel` then `mpim`; `mpdm-a--b-1` shown as "a, b"). One-to-one DMs are off.

## Context
Copying member IDs was the hardest step of setup. A prototype (2026-11-15) was never built; the owner asked for it on 2026-11-16 with "it's channels actually now".

## Why
Who can talk to the agent is whoever is in the channel, and Slack already keeps that list. Hermes has the two switches this needs: `SLACK_ALLOW_ALL_USERS=true` and `SLACK_ALLOWED_CHANNELS`. Group DMs follow that list; one-to-one DMs skip it, so with everyone allowed they would open the agent to the whole workspace.

## Consequences
- The manifest has no Messages tab and no `im:*` scopes; it adds `channels:join` and `mpim:*`. An app whose token has `im:history` is refused, so apps made before this are set up again (a migration clears old member-ID lists).
- No channels picked means no Slack settings in `.env`, since an empty `SLACK_ALLOWED_CHANNELS` means every channel.
- The agent's token can join public channels (`channels:join`), so a tricked agent could join and read one. It can't leave or kick: removing a channel only stops the agent answering there.
- The channel row stores channel IDs in `allowed` and leaves `owner_address` empty. Names come live from Slack.
- The app's icon is the agent's creature, set on connect (owner, 2026-11-16: people shouldn't deal with pictures). Slack sets an app icon only through `apps.icon.set`, which takes a person's app configuration token (`xoxe.xoxp-`, 12 hours), never the bot or app token, and the manifest has no icon field. So setup asks for that third token; the dashboard draws the creature as a 1024px PNG, the server finds the app with `auth.test` › `bots.info` and sets the icon, then drops the token. Rejected: a Download picture button (people handle pictures) and `chat:write.customize` with `icon_url` per message (needs a Hermes patch and a public image URL).
