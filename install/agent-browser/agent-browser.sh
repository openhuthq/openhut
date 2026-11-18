#!/bin/sh
export AGENT_BROWSER_EXECUTABLE_PATH="$(cat /etc/hermes/chromium-executable-path)"
export AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage,--disable-infobars,--window-size=1280,887
export AGENT_BROWSER_CONFIG=/opt/agent-browser/config.json
export AGENT_BROWSER_PROFILE=/opt/data/home/browser-profile
export AGENT_BROWSER_ACTION_POLICY=/opt/data/browser-policy.json
export AGENT_BROWSER_STREAM_PORT=9223
export AGENT_BROWSER_STREAM_QUALITY=50
export AGENT_BROWSER_STREAM_MAX_WIDTH=1280
export AGENT_BROWSER_STREAM_MAX_HEIGHT=800
export AGENT_BROWSER_NO_VERSION_CHECK=1
grep -qs '"default":"deny"' "$AGENT_BROWSER_ACTION_POLICY" || exec /usr/local/lib/agent-browser "$@"
out=$(mktemp -d)
/usr/local/lib/agent-browser "$@" >"$out/stdout" 2>"$out/stderr"
code=$?
if [ "$code" -ne 0 ] && grep -Eqs "^(.\[[0-9;]*m)*✗ (.\[[0-9;]*m)*Action '[a-z_]+' denied by policy" "$out/stdout" "$out/stderr"; then
  rm -rf "$out"
  echo 'A person is using this browser in OpenHut right now. Wait a minute, then try again.' >&2
  exit 1
fi
cat "$out/stdout"
cat "$out/stderr" >&2
rm -rf "$out"
exit "$code"
