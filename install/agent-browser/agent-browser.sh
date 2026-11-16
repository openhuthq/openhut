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
exec /usr/local/lib/agent-browser "$@"
