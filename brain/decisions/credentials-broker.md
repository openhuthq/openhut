---
status: accepted
---
# The gateway brokers the agents' keys

## Decision
Owner, 2026-11-17 (design: https://claude.ai/artifact/CYW1Bob7nLCDAvfFjy2E7t). No reusable secret inside an agent's sandbox. The gateway (:8081) is also a broker: `/u/<name>/*` forwards to a fixed upstream, by swapping base URLs, not by intercepting TLS. The agent's own gateway token is the stand-in wherever a client wants a key. The gateway checks it, strips every auth header the agent sent, checks the path against the upstream's list, adds the real key from the sealed store, streams the reply and writes an audit row.

One module, `packages/runtime/src/server/gateway/broker.ts`; the model providers' `Upstream`s are built in `models/providers.ts` (one entry per provider) and Telegram's stays here: an `Upstream` per service (`name`, fixed `origin`, `allow`, `credential`, `apply`, optional `observe`) and one `brokerService.forward()`.

| Upstream | How the agent is pointed at it | Passes | Real key |
| --- | --- | --- | --- |
| `anthropic` | the vendored plugin's `relay_upstream` setting (our patch); `CLAUDE_CODE_OAUTH_TOKEN` is the agent token | `POST /v1/messages`, `/v1/messages/count_tokens` | the seat, as `Bearer` |
| `codex` | `HERMES_CODEX_BASE_URL`; `auth.json` holds the agent token as a non-expiring access token | `POST /responses`, `/responses/compact`, `GET /models` | the ChatGPT access token and `ChatGPT-Account-ID`, refreshed by the gateway |
| `openrouter`, `openai`, `xai` | Hermes `custom` provider: `base_url` is `<gateway>/u/<name>/v1`, `api_key` is the agent token (`model-providers.md`) | `POST /v1/chat/completions`, `POST /v1/responses`, `GET /v1/models` | the API key sealed in `install_setting` (`provider_key_<id>`), as `Bearer` |
| `telegram` | `platforms.telegram.extra.base_url`/`base_file_url`; `TELEGRAM_BOT_TOKEN` is the agent token | every method but `logOut`, `close`, `setWebhook` | the bot token, swapped into the path |

## Context
Every agent's `.env` held the team's one Claude seat (`sk-ant-oat01`, a year, usable from anywhere) and its Telegram bot token, and the agent can read its own `.env`. A prompt-injected agent could copy them out over port 443.

## Why
- A base-URL swap needs no CA, no per-host parser and nothing new in the container; it's plain HTTP to the gateway agents already use.
- The token is an HMAC the server already checks on every gateway call, so one check covers tools and keys.
- Rotating a real key becomes a database write: nothing is rendered, nothing restarts.

## Consequences
- Revoking one agent's token: `agent.token_epoch` (`POST /api/agents/:id/revoke-token`, MCP `revoke_agent_token`). The token is `HMAC(id)` at epoch 0, so tokens from before still work, and `HMAC(id:epoch)` after. The bump reapplies the agent's files, which restarts it with the new token; the old one is refused on the next call.
- Broker routes stream with a 120 s idle timeout (`IDLE_MS`), not the MCP route's 1 MB / 60 s caps; they share the 8-in-flight-per-agent limit.
- Audit: one `connection_event` row per call, with `connection_id` null and `tool` like `anthropic POST /v1/messages`, so an agent's Activity shows its model calls. Telegram `getUpdates` writes at most one row per agent a minute. A bot token never reaches the row (`/bot…`).
- The seat meter reads `anthropic-ratelimit-unified-*` from the replies the broker relays (`seatLimits.observe`). The 1-token Haiku probe is gone, so the meter is empty until the first model call after the server starts.
- `deleteWebhook` passes: Hermes's cold start needs it to succeed or it drops the Telegram adapter, and with `setWebhook` refused there is nothing for it to undo.
- Codex: an owner or admin signs in once (`/api/admin/codex-sign-ins`, OpenAI's device code). The tokens are sealed in `install_setting.codex_tokens`; `codex.accessToken()` refreshes 5 minutes before expiry, one refresh at a time (refresh tokens are single-use). An agent on Codex has a model key like `codex:gpt-5.5` (through `openai-codex`); any slot on a provider (model, fallback, helper) gets that provider's env and stand-in rendered.
- `auth.json` is a fourth rendered file mounted read-only (agentd `SPEC` 3); agents not on Codex get Hermes's empty store.
- Still in the container until v2: Slack's bot and app tokens, and the WhatsApp session. The docs' Security page lists them.
- An agent can still spend the seat or post as its bot from inside. The path lists and the audit bound and show it.
- Calls the Claude CLI makes outside the relay (the plugin's model-picker handshake, the CLI's own bootstrap) go to api.anthropic.com directly and carry only the stand-in, which Anthropic refuses; none is a model call.
- In test mode the `anthropic` origin is the gateway's own `/test-anthropic`, which answers only the real seat, so the e2e run proves the swap (checks X1–X4).
