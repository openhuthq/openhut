# Vendored Hermes plugins

`claude-subscription-directsdk/` is NousResearch/hermes-official-plugins at `6313fad5ddf2c060e7b16782f4860c0d5cdbfcac`
(the commit Hermes v0.23.1's own plugin catalog pins), runtime files only, unmodified, MIT. agentd mounts this folder
read-only as every agent's `plugins/`, so it's the only plugin an agent can load. It drives the `claude` CLI, which the
installer downloads (pinned version and checksum) and agentd mounts read-only too.
