# Vendored Hermes plugins

`claude-subscription-directsdk/` is NousResearch/hermes-official-plugins at `6313fad5ddf2c060e7b16782f4860c0d5cdbfcac`
(the commit Hermes v0.23.1's own plugin catalog pins), runtime files only, MIT. agentd mounts this folder
read-only as every agent's `plugins/`, so these are the only plugins an agent can load. It drives the `claude` CLI, which the
installer downloads (pinned version and checksum) and agentd mounts read-only too.

## Our one patch

Upstream refuses `ANTHROPIC_BASE_URL` and always sends the relay's Messages requests to `https://api.anthropic.com`.
OpenHut needs them to go to its gateway, which swaps the agent's stand-in token for the real seat
(`private/brain/decisions/credentials-broker.md`). The patch adds one plugin setting, `relay_upstream`
(`plugins.entries.claude-subscription-directsdk-experimental.settings.relay_upstream` in `config.yaml`):

- `directsdk_setup.py`: `relay_upstream()` reads the setting (empty means Anthropic) and `relay_gate()` builds the
  `Admission` for it. The request path (`directsdk.py`), `fetch_usage` and `discover_models` use `relay_gate()`
  instead of a hard-coded `Admission("https://api.anthropic.com")`.
- `admission.py`: `Admission(..., configured=True)` also accepts plain `http://` for the configured upstream, since
  the gateway is plain HTTP on the agent's own bridge. Everything else keeps upstream's rule (HTTPS, or HTTP only on
  loopback).
- `plugin.yaml`: the setting in `config_schema`.

Lines we added are marked `OpenHut`. To offer upstream: the same setting, without the plain-HTTP allowance.

## openhut-ui (ours)

`openhut-ui/` turns a reply's ```` ```spec ```` card (`packages/common/src/cards/card.ts`) into something each chat can show.
Its `transform_llm_output` hook sends the finished reply to the gateway's `POST /cards/render`, which posts the card to
Slack as Block Kit in the turn's thread and answers with the reply's words, or swaps the card for a text version on
other chats. The desktop app (`api_server`) is left alone: the thread stream renders cards itself. A Slack card button
comes back through `register_slack_action_handler` and `inject_message` as the person's reply. `hermes-files.ts`
enables it (`plugins.enabled`) and allows `allow_gateway_injection`.
