---
status: accepted
---
# Slack agents answer in the channels you pick, not to people you list

## Decision
Owner, 2026-11-16: a Slack agent is shared with channels, never with member IDs. Setup is create the app, paste two tokens, then pick channels from a dropdown. The agent page edits the list in place (× to remove, the same dropdown to add), and channels the bot is already in but doesn't answer show with Allow. Every channel type counts: public, private, Slack Connect (tagged "shared") and group DMs, listed the way Craftspace does (two `conversations.list` calls, `public_channel,private_channel` then `mpim`; `mpdm-a--b-1` shown as "a, b"). One-to-one DMs are off.

## Context
Copying member IDs was the hardest step of setup. A prototype (2026-11-15) was never built; the owner asked for it on 2026-11-16 with "it's channels actually now".

## Why
Who can talk to the agent is whoever is in the channel, and Slack already keeps that list. Hermes has the two switches this needs: `SLACK_ALLOW_ALL_USERS=true` and `SLACK_ALLOWED_CHANNELS`. Group DMs follow that list; one-to-one DMs skip it, so with everyone allowed they would open the agent to the whole workspace.

## Consequences
- The manifest has no Messages tab and no `im:*` scopes; it adds `channels:join` and `mpim:*`. An app whose token has `im:history` is refused, so apps made before this are set up again (a migration clears old member-ID lists).
- No channels picked means no Slack settings in `.env`, since an empty `SLACK_ALLOWED_CHANNELS` means every channel.
- The agent's token can join public channels (`channels:join`), so a tricked agent could join and read one. It can't leave or kick: removing a channel only stops the agent answering there.
- The channel row stores channel IDs in `allowed` and leaves `owner_address` empty. Names come live from Slack.
