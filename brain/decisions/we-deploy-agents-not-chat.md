---
status: accepted
---
# Chat with agents is the dashboard's home; Slack and WhatsApp stay the team's channels

## Decision
The dashboard opens on chat (owner, 2026-11-13). The sidebar lists every agent under Chats with your threads beneath the open one; clicking an agent starts a thread. Threads are saved per person, private to their author, and go to the agent's own Hermes API server through the app. Setup stays one click away (Agent settings, or Agents at the top). Before this, the rule was "no chat screen and no message passes through our server" (2026-11-12).

## Context
After creating an agent nobody could tell whether it worked: the status only said the container existed, and the only way to try it was to set up Slack or WhatsApp first.

## Why
Every agent already serves an OpenAI-compatible API on :8642 with its own key, so a real conversation costs a proxy, not a second agent runtime. Talking to the agent is the fastest proof it works, and a thread shows which gateway calls it made.

## Consequences
Messages now pass through and are stored in the app's database (`thread` table), only for people who can edit the agent. Slack and WhatsApp are still how the team reaches agents; the dashboard chat isn't a channel. Agents report `health` (answering, starting, not answering) from a probe of `/v1/models`, alongside the container `status`.
