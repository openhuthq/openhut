---
status: accepted
---
# OpenHut website positioning

## Decision
Owner, 2026-11-13, while reviewing the marketing mock (https://claude.ai/artifact/33jiDuCi5RNsCLtJXsca21):
- The headline is "Build, manage & share agents with your team" (what the person building agents gets; from the Erich call, where he was already hacking several agents onto one machine). Under it, one short line: "Self-improving agents in Slack and WhatsApp, on your own server." Then: collaboration ("Meet your team where they work"), "Self-improving", one agent per job, every agent in its own sandbox, "Usage & cost", bring your own Claude plan, and the install command. Section headings are plain words where a sentence ran long (owner, later the same day).
- The three pillars (access, compute, data) are not the page structure. Compute is just "your machine" and is not sold on its own.
- Self-improving is the headline benefit. Hermes is an implementation detail, named only far down the page.
- Layout follows gumloop.com, type and hero follow capy.ai (Bebas Neue headings, IBM Plex Mono copy, a real product interaction in the hero): a headline and one rich, interactive component per section. No header, FAQ or "book a call". The collaboration section copies Gumloop's pinned-heading scroll through channels. No enterprise section or wording.
- Primary colour is black. Colour comes from the creature avatars. The mascot is a hut with a thatched yellow roof, a face, an open door and a red flag (OpenHut since 2026-11-15; it was a monkey as Fast Monkey).
- The avatars are the product's own generator (`packages/web/src/components/avatar.tsx`), extended with more colours, faces and costumes, and used across the whole page.

## Context
The first mock led with the three pillars from the Erich and Mahmoud calls and offered a colour picker. The owner called it "far from being good" and redirected it over several messages.

## Why
The buyer self-hosts on one server and cares about the team using the agents, not about infrastructure layers.

## Consequences
- Copy stays short and plain: the owner rejects "yapping".
- No tabs inside cards; make the component itself interactive.
- Characters must really move (blink, look, talk, hop). An image floating up and down is rejected as cheap.
- Mock chat apps must look current; a desktop WhatsApp clone was rejected as dated.
- Per-column data access is not claimed: the OpenHut brain only supports read-only grants per connection.
