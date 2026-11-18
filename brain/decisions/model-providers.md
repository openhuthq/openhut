---
status: accepted
---
# Model providers: Claude, Codex and API keys

## Decision
Owner, 2026-11-18 (design prototype: Settings, Models and the agent panel). An agent's model is no longer one of four ids but a **model key**, `<provider>:<model>` (`claude:sonnet`, `codex:gpt-5.5`, `openrouter:google/gemini-3.5-flash`, `openai:gpt-5.5`, `xai:grok-5`). Five providers: the Claude and Codex subscriptions, and the OpenRouter, OpenAI and xAI API keys. After you paste a key, the runtime asks the provider which models it serves; you switch on the ones agents may use. Each agent has a model, a Fallback model and three Helper models (summarising long chats, naming chats, learning from chats; Automatic picks a fast model of the same provider as its main one).

Owner, 2026-11-18 (later): the picker is a **nested dropdown**. It's a menu of providers, and each provider's models open in a submenu beside it (Base UI `Menu.SubmenuRoot`). It is not one flat list, and not a drill-in step that replaces the list. `ModelPicker`'s props stay the same. "Automatic" (the first switched-on fast model of the main model's provider) is decided in one place, `fastModelOf` in `common`, so what the app shows can't drift from what the runtime writes.

This reverses "Codex is coming soon" in `app-aggregates-runtimes.md`: Codex is live, on the computer where you signed in (see Limits).

## The modules
One idea per module, each hiding what changes when a provider is added.

| Module | Interface | Hides |
| --- | --- | --- |
| `common/models/provider.ts` | `PROVIDERS` and `providerInfo(id)` (id, kind, name, blurb, where the key is made), `Provider`, `ProviderModel`, `UpdateProvider`, `splitModelKey`, `modelKey`, `fastModelOf` | What the app and the runtime both need to say about a provider, the only reader and writer of model keys, and the one rule for Automatic. Nothing about how to reach a provider. |
| `runtime/server/models/providers/` | `providers[id]` from `index.ts`: `connected()`, `listModels()`, `upstream`, `route()`, `setup()` | One file per provider (`claude.ts`, `codex.ts`, `openrouter.ts`, `openai.ts`, `xai.ts`) holds everything that is *that provider*: its credential, how its models are fetched and parsed, the broker upstream (origin, allowed paths, how the real key is added) and the Hermes config. `shared.ts` has the types, `keyed()` for API-key providers and the HTTP helpers. **A new provider is one file here, one line in `index.ts` and one row in `PROVIDERS`.** |
| `runtime/server/models/model-slots.ts` | `resolveSlots({ model, fallback, helpers, catalog })` | A pure function from an agent's choices to the six concrete slots Hermes needs (primary, fallback, compression, title, review, approval), including what Automatic means. |
| `runtime/server/models/provider-service.ts` + controller | `list`, `get`, `update` (`apiKey` and `models` switches), `disconnect`, `refresh` on `/api/providers` | Where keys and model lists are stored (`install_setting`), the on/off state, and that connecting *tests* the key by listing the models with it. |
| `gateway/broker.ts` | `upstreams` map | Now built from `providers[*].upstream` plus Telegram. The forwarding code did not change. |
| `agents/hermes-files.ts` | `renderFiles({ agent: { slots } })` | Writes each slot with the provider's own `route()` and each used provider's `setup()` once (env, plugin settings, `auth.json`). No `if (provider === …)` outside `models/providers/`. |
| `packages/client` `providers` | `list`, `connect`, `refresh`, `disconnect`, `setModels`, `mergeProviders` | "Put it on these computers": one action fanned out to each runtime, and the merge of per-computer answers into the one list Settings shows. |
| renderer `features/models/` | `useProviders`, `ModelPicker` | The picker used for Model, Fallback and the three Helpers: a menu of providers with each provider's models in a submenu (Base UI `Menu.SubmenuRoot`, filtered with `Menu.FilterProvider` past 8 models). |

## How it works
- **Keys.** An API key is sealed in `install_setting` (`provider_key_<id>`) and never leaves the runtime. The agent's own gateway token is the stand-in everywhere (`credentials-broker.md`): the key providers are Hermes `custom` endpoints whose `base_url` is `<gateway>/u/<provider>/v1` and whose `api_key` is the agent token. The broker passes `POST /v1/chat/completions`, `POST /v1/responses` and `GET /v1/models` and adds the real `Authorization`. So an agent never holds a provider key, and rotating one is a database write.
- **Model lists.** `list()` calls the provider with the key: OpenAI and xAI `GET /v1/models` (ids only; non-chat models such as images, embeddings and speech are dropped by name), OpenRouter `GET /api/v1/key` (the check, `/models` is public) then `/api/v1/models` (names, context length and prices; OpenRouter quotes dollars per token, the app shows dollars per million). Codex `GET /models` on the ChatGPT backend with the signed-in token, falling back to `gpt-5.5` when the answer isn't understood. Claude is a fixed list of the three aliases the Claude Code CLI takes. A 401 or 403 while connecting is `400 "<Provider> refused that key"`, nothing is saved. A provider that doesn't answer is 502 and nothing is saved either.
- **Switches.** The stored list holds each model's `on`. First connect switches on a hand-picked list where the provider has one (OpenRouter: each top lab's frontier model and its cheaper, faster sibling, `STARTERS` in `providers/openrouter.ts`; owner, 2026-11-18, because OpenRouter's API has no popularity signal and its eight newest were GPT-6.2 variants and their `:batch` copies), otherwise the eight newest. Update the list when a lab ships a new frontier; a stale entry only means a newer model starts off; **a refresh keeps your switches, adds new models switched off and drops models the provider no longer serves**, so a refresh never enables anything on its own. A switched-off model stays out of the pickers and is refused by the API (`409`), but an agent already using it keeps using it.
- **Disconnect.** Deletes the key (or the Claude seat, or the Codex tokens) and the list. Agents that used it get 409 from the broker, and their health reads "Not ready" with "<Provider> isn't connected".
- **Put it on.** The app sends the key to each ticked computer's runtime and each tests it; the first refusal stops the loop. Claude still spreads by `account.sync` (seat), Codex does not (below).
- **Agent health.** `no_seat` now means "the provider of its model isn't connected on this computer". The enum keeps its name so older apps parse it.
- **Test mode.** `OPENHUT_MODEL=test` counts Claude as connected (there is no seat to sign in to) so the dev app can pick models; Hermes still gets the test model in every slot.

## Hermes: what it can and cannot do
Checked in the Hermes source at tag `v0.23.1` (the image's version), not run live.
- **Fallback: yes, one entry.** `fallback_providers: [ { provider, model, base_url, api_key } ]` (the older `fallback_model` still works). Hermes walks the list when the primary is exhausted (rate limit, billing, repeated errors), says so in the chat ("Model fallback: … unavailable; using … via …") and goes back to the primary on a later turn after a cooldown. It also skips an entry that resolves to the same backend as the one that failed. We write exactly one entry; Hermes could take a chain, the app offers one (the design shows one).
- **Fallback is not "if the key is invalid".** It starts on errors from the primary; a primary that was never connected fails at once and falls back too.
- **Fallback on the Claude subscription plugin is unverified.** `bind_route_entry` builds the client with `resolve_provider_client`. The directsdk plugin is registered as a normal provider, and auxiliary tasks already resolve it the same way, but nobody has seen it bound as a *fallback* live. Codex (`openai-codex`) and `custom` endpoints are ordinary cases. If Claude-as-fallback misbehaves, drop `claude` from the fallback picker.
- **Helpers: yes, per task.** `auxiliary.compression`, `auxiliary.title_generation` and `auxiliary.background_review` each take `{ provider, model, base_url, api_key }` (`approval` is also written, Automatic, because approvals are off and it would otherwise be unset). "Summarising long chats" is `compression`, "Naming chats" is `title_generation`, "Learning from chats" is `background_review` (the post-turn fork that saves memory and patches skills; with a model other than the main one it replays a compact digest, about 3 to 5 times cheaper). Hermes has its own auto mode (`provider: auto` inherits the main model); we always write the concrete model Automatic resolved to instead, as the Claude path did with Haiku, so what the app shows is what runs.
- **Everything else stays on "auto".** Vision, MCP and the other auxiliary tasks inherit the main model.
- **Config changes restart the agent**, like every other file we render. A change to a model list that changes what Automatic resolves to reaches agents at the next reconcile (30 s), which restarts only the agents whose files differ.
- **`context_length`.** A `custom` endpoint's context window is probed otherwise, so we write the listed one when we have it (OpenRouter does; OpenAI and xAI list ids only).

## What I chose not to build
- **A table of models.** The stored list is JSON in `install_setting` per provider, like the Codex tokens. A few hundred models read once per request is nothing, and nothing queries across them.
- **Per-computer switches in the UI.** The Settings list shows one set of switches and applies them to every computer that holds the provider. Computers drift only if you change one by hand through its API.
- **A chain of fallbacks, or per-helper fallbacks.** One fallback per agent, as designed.
- **Provider "kinds" or plugin loading.** Five entries in a map. A sixth is a sixth entry.
- **Codex on a second computer.** See Limits.
- **Real prices for OpenAI and xAI.** Their model endpoints don't list prices, so those rows show the provider and nothing invented.
- **Fast-model ratings from the providers.** `tier` is a name heuristic (`mini`, `nano`, `flash`, `haiku`, `lite`, `fast`, `small` count as fast, as whole words: `gemini` contains `mini`, and before that rule every Gemini model counted as fast). It only decides what Automatic helpers use.

## Limits
- **Codex is per computer.** OpenAI's refresh tokens are single use (`credentials-broker.md`), so copying one to a second computer, as Claude's seat is copied, makes whichever refreshes second fail. The sign-in runs on This Mac and `account.sync` still pushes only Claude. The runtime endpoints (`/api/admin/codex-sign-ins`) work on any computer, so a per-computer sign-in is the way to add it later.
- Agents on a remote computer see only the providers connected on that computer.
- `Agent.model` changed from an enum to a model key: **bump `MIN_APP_VERSION` with the next app release**, an older app can't parse the new agent.
- A model id the provider retires stays on an agent that uses it until someone changes it; the broker relays the provider's error.

## Trying it without real accounts
`scripts/fake-providers.ts` is one small server (127.0.0.1:18650, `FAKE_PROVIDERS_PORT` moves it) that plays OpenRouter, OpenAI, xAI and the ChatGPT backend: model lists (OpenRouter with prices and context, OpenAI and xAI with non-chat models mixed in so the filter shows), a key check (any key containing `bad` is a 401), chat completions and responses with a canned `Fake <provider> reply (<model>): <last message>` (streamed when asked), and a ChatGPT device-code sign-in that shows `WDJB-MJHT` and completes `FAKE_CODEX_SIGN_IN_MS` (4000) after the code was requested. Prices and models are made up. `FAKE_OPENROUTER_COUNT=1500` pads OpenRouter's list to that many models, to try Show all and the switches on a long list.
- `npm run dev:fake` is `npm run dev` with `OPENHUT_FAKE_PROVIDERS=1`: `scripts/dev.ts` starts the fake server and points the runtime at it through `OPENHUT_OPENROUTER_API`, `OPENHUT_OPENAI_API`, `OPENHUT_XAI_API`, `OPENHUT_CODEX_API` and `OPENHUT_CODEX_AUTH_API` (all read only by `platform/config.ts`).
- On its own, `node scripts/fake-providers.ts` serves and prints the `export` lines for a runtime you start another way.
- Dev runs `OPENHUT_MODEL=test`: Claude counts as connected, and agents get the test model in every slot, so a chat answers `ECHO: …` whatever you pick. The fake chat endpoints are reached through the broker: take an agent's token from `$OPENHUT_DATA/agentd/agents/<id>/config.yaml` (`api_key`) and `curl -H "Authorization: Bearer <token>" -d '{"model":"x","messages":[{"role":"user","content":"hi"}]}' http://127.0.0.1:8081/u/openai/v1/chat/completions` (after connecting OpenAI with any key). `OPENHUT_GATEWAY_PORT` moves the gateway if 8081 is taken (an installed OpenHut holds it).
- Keys that end with a real-looking string work; anything shorter than 8 characters is refused by the API before it reaches the fake.

## Where things are
`common/src/models/provider.ts`; `runtime/src/server/models/providers/*.ts`, `runtime/src/server/models/{model-slots,provider-service,provider-controller}.ts`; `packages/client` `providers` and `mergeProviders`; renderer `features/models/` (labels, api, ModelPicker, HelperRows), `features/agents/model-rows.tsx` (panel rows and the Helper models sheet, `/agents/:id/helpers`), `features/settings/models.tsx` (the Models tab; the open step is `?open=<provider>` in the URL, `?open=seat` is still Claude's sign-in dialog).

## Gotchas
- The Settings step for a provider is derived from state, not the URL: `?open=openrouter` is Connect while the provider isn't connected and Manage once it is, so a successful connect needs no navigation and the "Found N models" notice lives in the step's own state.
- `Esc` in a provider step goes back to the Models list (the Dialog takes an `onEscape` that Settings sets only while a step is open), and focus returns to the row's pill you came from (`returningTo` in `settings/models.tsx`). Esc inside a Disconnect confirm cancels the confirm first (its capture listener runs before the Dialog's).
- Disconnect calls `open()` *before* the mutation, then the component unmounts when `connected` flips; the hook-level `onError` toasts because per-call callbacks don't run after unmount. A step derived from state would otherwise show Connect (and, for Codex, start a new sign-in) for a provider you just removed.
- Long lists: a switch flip is an optimistic `setQueryData` that keeps every other model object, rows are `memo`ised on the model object and a stable `onSwitch(id, on)`, and TanStack's structural sharing keeps the refetch from replacing unchanged models. No virtualiser; try `FAKE_OPENROUTER_COUNT=1500` first if it gets slow again.
- The panel keeps DESIGN.md's plain rows ("Model", "Fallback", "Helper models" with the value on the right) instead of the prototype's label plus soft trigger, and the sidebar line still shows the agent's job, not its model name: both are deliberate, the sidebar line is the agent's one line of identity.
- While a model change is saving the panel's status reads "Restarting…" (amber, the real PATCH duration, at least 1.8 s), from `useRestarting`.
- The Codex sign-in runs on the local runtime only (the request is relative), by design above.
- `GET /api/providers` on an offline computer isn't fetched; the app shows its last known list, greyed like agents.
- Model ids can contain slashes and colons (`openrouter:google/gemini-3.5-flash`). The agent API and config carry them whole; nothing splits on `/`. Only the first `:` splits provider from model.
- Moving an agent to a computer that doesn't have its provider keeps the model; it shows "Not ready" there until the provider is connected. The move dialog doesn't warn yet.
