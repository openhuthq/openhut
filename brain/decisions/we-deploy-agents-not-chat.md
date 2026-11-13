---
status: accepted
---
# We deploy agents, we are not the chat interface

## Decision
The product creates, configures and supervises Hermes agents. People talk to them in Slack, email or WhatsApp. The dashboard has no chat screen and no message passes through our server.

## Context
Owner, 2026-11-12. Hermes already runs its own gateway per profile (Slack Socket Mode, IMAP/SMTP, WhatsApp bridge).

## Why
Building a chat surface or a message router duplicates what Hermes does and puts us in the path of every conversation.

## Consequences
Channel setup is credentials only: stored sealed, written into the profile's `.env`. Skyfleet's `chat/` service, Slack bot and `/api/v1/signals` inbound are not carried over.
