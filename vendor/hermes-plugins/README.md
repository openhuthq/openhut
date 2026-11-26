# Vendored Hermes plugins

`claude-subscription-directsdk/` is NousResearch/hermes-official-plugins at `6313fad5ddf2c060e7b16782f4860c0d5cdbfcac`
(the commit Hermes v0.23.1's own plugin catalog pins), runtime files only, MIT. agentd mounts this folder
read-only as every agent's `plugins/`, so these are the only plugins an agent can load. It drives the `claude` CLI, which the
installer downloads (pinned version and checksum) and agentd mounts read-only too.

## Our one patch

Upstream refuses `ANTHROPIC_BASE_URL` and always sends the relay's Messages requests to `https://api.anthropic.com`.
OpenHut needs them to go to its gateway, which swaps the agent's stand-in token for the real seat
(`openhut-private: brain/decisions/credentials-broker.md`). The patch adds one plugin setting, `relay_upstream`
(`plugins.entries.claude-subscription-directsdk-experimental.settings.relay_upstream` in `config.yaml`):

- `directsdk_setup.py`: `relay_upstream()` reads the setting (empty means Anthropic) and `relay_gate()` builds the
  `Admission` for it. The request path (`directsdk.py`), `fetch_usage` and `discover_models` use `relay_gate()`
  instead of a hard-coded `Admission("https://api.anthropic.com")`.
- `admission.py`: `Admission(..., configured=True)` also accepts plain `http://` for the configured upstream, since
  the gateway is plain HTTP on the agent's own bridge. Everything else keeps upstream's rule (HTTPS, or HTTP only on
  loopback).
- `plugin.yaml`: the setting in `config_schema`.

Lines we added are marked `OpenHut`. To offer upstream: the same setting, without the plain-HTTP allowance.

## openhut (ours)

`openhut/` is OpenHut's only Hermes plugin, and it holds no feature code. What it registers comes from
`plugins.entries.openhut.settings` in `config.yaml`, which `core/hermes.ts` writes from the runtime's plugin list
(`core/hooks.ts` `manifest()`):

- `tools`: each local tool (`local: true` in a plugin, like `post`'s `post_message`), with the JSON schema of its zod
  input. Its handler sends `{ args, origin }` to the gateway's `POST /tools/<name>`; an answer `{ send: { target, message } }`
  goes to Hermes's own `send_message` helper, so a post uses the same adapters as a reply.
- `hooks`: the Hermes hook names some plugin handles (`hooks: { <hermes hook>: run }` in a plugin). For each, a
  forwarder sends the hook's arguments, made plain JSON (enums as their value, dataclasses as their fields, anything
  else dropped), and the turn's `origin` to `POST /hooks/<hook name>`, and returns the `result` the plugins gave (the
  first one that isn't null; every plugin's handler runs). Today: `transform_llm_output` (cards: a reply's
  ```` ```spec ```` card, `packages/common/src/cards/card.ts`, goes to Slack as Block Kit in the turn's thread, or becomes
  text on other chats; the app chat, `api_server`, is left alone since the thread stream renders cards itself) and
  `pre_gateway_dispatch` (channels: a Telegram `/start <invite>` is taken and skipped, so the agent never sees it).
- `slack_actions`: a Slack action handler per prefix (`card:`), to `POST /slack-actions`; the cards plugin answers with
  the button's text and its thread, which goes back in through `inject_message` as the person's reply. `core/hermes.ts`
  allows `allow_gateway_injection`.

Its `pre_tool_call` hook stamps every `mcp__openhut__*` call with the chat it came from (`origin`, with Slack's workspace as `scope_id`, which Hermes needs to inject a turn back into that chat), with no list of tools to
keep in sync. Every gateway tool takes `origin` and reads it in one place (`core/mcp.ts`); it is advice,
since the gateway checks the chat again before it posts there. Every 15 s it polls the gateway's `GET /wakes` for turns the
runtime wants the agent to take in a chat (a routine run, a webhook call, an answered change request), starts each once
with `inject_message`, and reports `POST /wakes/<plugin>:<id>` `{ picked: true }`, then `{ said }` with the reply
(`post_llm_call` finds the wake by its `[OpenHut <plugin>:<id>]` prefix). Wakes in the app chat never reach it: the chat
plugin runs those itself. `slack_transport.py` is transport, not a feature: Hermes has no Slack API base URL, so it points
`slack_sdk` and Slack file downloads at the gateway (`OPENHUT_SLACK_API`, `OPENHUT_SLACK_FILES`).
