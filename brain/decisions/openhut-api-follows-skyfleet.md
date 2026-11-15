---
status: accepted
---
# OpenHut is a monorepo built the way Skyfleet is

## Decision
Owner, 2026-11-13: build the backend for real and "scaffold the repo the same as Skyfleet", as a Turborepo, with
Skyfleet's domain modules and resource-oriented API. OpenHut is npm workspaces + Turborepo: `packages/app` (Fastify,
Kysely on PGlite), `packages/web` (React, Vite, TanStack Query), `packages/common` (the Zod Mini contract),
`packages/agentd` and `packages/e2e`. The API follows Skyfleet's `resource-oriented-api` and
`api-responses-follow-stripe` decisions: flat collections (`/api/agents`, `/api/grants`, `/api/channels`,
`/api/connection-events`, `/api/people`, `/api/invites`, `/api/sessions`), singletons (`/api/me`, `/api/admin`,
`/api/setup`), and Stripe's object, list, deleted and error shapes. The control MCP signs people in with Skyfleet's
OAuth 2.1 code (dynamic registration, PKCE, rotating refresh tokens). Owner, same day: OAuth is the only way in; there are no personal access tokens.

## Context
The v1 slice was one flat `app/` folder with server-rendered pages and form posts. The owner asked for the real
structure before going further.

## Why
- One way of writing code across the team's products: the same module shapes, the same API shapes, the same review.
- Grants, channels and invite links as objects replace verb routes (`/agents/:id/grant`, `/invite/:token` posts).

## Consequences
- Kept from the slice, deliberately: our own sessions and scrypt passwords instead of better-auth (no mail sent,
  invite only, an email as the sign-in name); the agents' gateway on plain `node:http` for explicit per-agent limits; the dashboard's approved
  CSS instead of Tailwind and shadcn.
- New people come from `POST /api/people` with either the installer's `setupCode` (the owner) or an invite's `inviteToken`.
- Lists page forward only, with `startingAfter`; there is no `endingBefore`.
- An MCP app is disconnected with `DELETE /api/oauth/grants/:id`; there is no RFC 7009 revocation endpoint.
