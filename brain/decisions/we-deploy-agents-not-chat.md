---
status: accepted
---
# Chat with agents is the dashboard's home; Slack and WhatsApp stay the team's channels

## Decision
The dashboard opens on chat (owner, 2026-11-13). The sidebar lists every agent under Chats; clicking one opens your one chat with it. There are no threads in the dashboard: one chat per person per agent, private to its author, sent to the agent's own Hermes API server through the app. Hermes manages its own sessions (Slack, WhatsApp, and this chat's session) and we don't change how. Setup stays one click away (Agent settings, or Agents at the top). Before this, the rule was "no chat screen and no message passes through our server" (2026-11-12).

## Context
After creating an agent nobody could tell whether it worked: the status only said the container existed, and the only way to try it was to set up Slack or WhatsApp first.

## Why
Every agent already serves an OpenAI-compatible API on :8642 with its own key, so a real conversation costs a proxy, not a second agent runtime. Talking to the agent is the fastest proof it works, and a thread shows which gateway calls it made.

## Consequences
Messages now pass through and are stored in the app's database (`thread` table, one row per person and agent), only for people who can edit the agent. Slack and WhatsApp are still how the team reaches agents; the dashboard chat isn't a channel. Agents report `health` (answering, starting, not answering) from a probe of `/v1/models`, alongside the container `status`.
