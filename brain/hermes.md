# Hermes

Every agent runs on Hermes Agent (Nous Research, MIT). Docs: https://hermes-agent.nousresearch.com/docs

- One agent = one profile = one container (`brain/decisions/one-container-per-agent.md`).
- Profiles don't sandbox: file tools and the shell can read anything the process user can.
- No HTTP API creates profiles or starts gateways. Run `hermes gateway run` in the foreground with `HERMES_HOME` set; `gateway start` needs systemd and `-p <id>` ignores `HERMES_HOME`.
- The gateway multiplexes by default (`gateway.multiplex_profiles`): one process serves every profile, and `gateway.profile_routes` sends a channel, chat or user to a profile. That only keeps profiles organised; they share one process, one OS user and one disk. Hermes SECURITY.md: capability separation needs separate instances, and "the only security boundary against an adversarial LLM is the operating system".
- An agent can read its own `.env` (a plain `cat` isn't flagged). Env scrubbing, the approval regex and output redaction are heuristics, so keep team keys in our gateway.
- Gumloop's Vault doesn't stop leaks: it injects secrets as env vars into the sandbox. Only a broker that adds the secret outside the agent does (our MCP gateway; a model-key proxy).
- Approvals: whoever's message triggered a command can always approve it, on top of `approvals.approvers`. Approvals are answered in the chat that raised them.
- A rate limit with a named reset is waited out for up to 600 s per retry (`agent.api_max_retries`, default 3).
- Claude subscription: the official `claude-subscription-directsdk` plugin runs the Claude Code CLI. It accepts `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, needs `USER` set and a writable `CLAUDE_CONFIG_DIR`, and is experimental. **Neither the plugin nor `claude` ships in the Hermes image** (only a catalog entry pinning hermes-official-plugins `6313fad`); JakeBox vendors the plugin and mounts both read-only (`plugins/` is `$HERMES_HOME/plugins`). `sonnet`/`opus`/`haiku` aliases need Claude Code ≥ 2.1.293.
- Relay (one shared bot fronting many gateways) is experimental, and Nous's connector is private.
- Tool Search is on by default and hides MCP tools behind `tool_search`/`tool_call`. JakeBox agents set `tools.tool_search.enabled: "off"`, because our gateway already discloses tools progressively.
- The API server channel needs `API_SERVER_KEY` of at least 16 characters, or it silently doesn't start ("No messaging platforms enabled").
- Under gVisor, Hermes sees bind-mounted folders as a cross-VM filesystem and switches SQLite to `journal_mode=DELETE` (slower, still safe).
- Hermes v0.23.1 (image 3.2 GB, arm64 + amd64) runs as `--entrypoint /opt/hermes/bin/hermes gateway run` under runsc, uid 10000, with a read-only root; pass `--init`.
- Hermes runs its own Slack (Socket Mode), email (IMAP/SMTP) and WhatsApp (QR bridge) gateways. Two profiles can't share a Slack token.
- Email: set `EMAIL_AUTHSERV_ID` or mail is dropped. One gateway per mailbox.
- `approvals.approvers` defaults to `"*"`; set it. The sender can still approve their own command, so allowed users must be trusted.
- `config.yaml` is writable by the agent's own tools unless mounted read-only. Hermes also imports `hooks/*/handler.py` at startup; mount `hooks/` read-only and set `PYTHONNOUSERSITE=1`.
- gVisor can't use Docker's embedded DNS on user networks; mount a `resolv.conf`.
- MCP: `mcp_servers.<name>` with `url` + `headers`; tool filters via `tools.include`/`exclude`. Config changes need a restart.
- Unverified, test on the Beelink: WhatsApp bridge under gVisor, log rotation, writable paths under `--read-only`.
- Channel approvals (pairing) live in `platforms/pairing/`, or in legacy `pairing/` as soon as that has any file, so lock both read-only or an agent can approve outsiders for itself.
- Under gVisor with `--init`, Hermes is always PID 2, so after `docker stop` + `start` its own stale `gateway.pid` (or, failing that, `gateway_state.json`) looks live and it exits ("A gateway is already running (PID 2)") until the status goes stale (~90 s). agentd deletes `gateway.pid`, `gateway.lock` and `gateway_state.json` before every start; `HERMES_GATEWAY_LOCK_DIR` points at the per-start `/tmp`.
- Hermes pauses an MCP server for ~59 s after three refused calls in a row ("rejected the last 3 calls … Paused"). Gateway denials count, so an agent probing what it may do locks itself out for a minute.
- Slack runs in Socket Mode: `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (`connections:write`), `SLACK_ALLOWED_USERS` (member IDs) or `SLACK_ALLOW_ALL_USERS=true`. Strangers' messages are dropped silently, never answered with a pairing code. Its lock needs a writable `HERMES_GATEWAY_LOCK_DIR` (a read-only `$HOME` makes connect fail with EROFS).
- WhatsApp never shows a QR from the gateway: it refuses to start the bridge until `platforms/whatsapp/session/creds.json` exists, and doesn't retry. Pair with `node <bridge>/bridge.js --pair-only --pair-json --session …` inside the container: JSON lines `qr` (raw payload, rotates ~20 s), then `connected`; restart the agent after. Killing the `docker exec` client doesn't stop it.
- The image ships the bridge's code but no `node_modules` and no npm, so Hermes would `npm install` at runtime. JakeBox prepares it per image on the host (`install/whatsapp-bridge.sh`, with the `node_modules/.hermes-pkg-hash` stamp = first 16 hex of sha256(package.json)) and mounts it read-only at `$HERMES_HOME/scripts/whatsapp-bridge`, which Hermes uses when its install tree isn't writable.
- `WHATSAPP_ALLOWED_USERS` takes digits (`+` stripped); `*` is everyone and empty is nobody. Approvers are compared as the bridge reports senders: `<digits>@s.whatsapp.net`.

