#!/bin/sh
set -eu
D="${DOCKER:-docker}"
rt() { $D exec openhut "$@"; }
api() { rt curl -fsS -H "cookie: ${COOKIE:-}" -H 'content-type: application/json' "$@"; }
fail() { echo "smoke: $*" >&2; $D exec openhut sh -c 'tail -n 40 /var/log/openhut/agentd.log /var/log/openhut/app.log' >&2 || true; exit 1; }
wait_for() { i=0; until eval "$2" >/dev/null 2>&1; do i=$((i+1)); [ "$i" -gt "$1" ] && return 1; sleep 3; done; }

wait_for 100 'rt curl -fsS http://127.0.0.1:8787/health' || fail "no /health"
wait_for 20 "curl -fsS -o /dev/null http://127.0.0.1/setup" || fail "Caddy doesn't serve the app on :80 before an address is set"
COOKIE=$(api -i -X POST http://127.0.0.1:8787/api/people -d "{\"address\":\"https://smoke.example.com\",\"email\":\"smoke@example.com\",\"password\":\"smoke-test-password\"}" | sed -n 's/^set-cookie: \(openhut_session=[^;]*\).*/\1/ip') || fail "create the owner"
[ -n "$COOKIE" ] || fail "no session cookie after creating the owner"
rt cat /data/app/Caddyfile | grep -q '^smoke.example.com {' || fail "the Caddyfile doesn't serve the address"
rt curl -fsS http://127.0.0.1:8787/setup | grep -q '<div id="root">' || fail "the web app isn't served"
echo "smoke: the first visitor became the owner, and the web app is served"
rt sh -c 'command -v script' >/dev/null || fail "no script(1) in the image, so the Claude sign-in can't start"
link=$(rt sh -c 'd=$(mktemp -d); cd "$d"; HOME=$d CLAUDE_CONFIG_DIR=$d BROWSER=/bin/true TERM=xterm-256color timeout 30 script -qfec "stty cols 4000 rows 60; exec $OPENHUT_CLAUDE setup-token" /dev/null </dev/null | tr "\033\007" "\n\n" | grep -o "https://claude\.[a-z]*/[^ ]*oauth/authorize?[^ ]*" | head -n 1; rm -rf "$d"')
case "$link" in https://claude.ai/*|https://claude.com/*) echo "smoke: the Claude sign-in starts at ${link%%\?*}" ;; *) fail "the Claude sign-in gave no claude.ai link: $link" ;; esac
i=0; until agent=$(api -X POST http://127.0.0.1:8787/api/agents -d '{"name":"Smoke","instructions":"# Smoke\nYou echo."}' 2>/dev/null); do
  i=$((i+1)); [ "$i" -gt 20 ] && fail "create an agent"; sleep 3
done
id=$(printf '%s' "$agent" | sed -n 's/.*"id":"\(ag_[a-z0-9]*\)".*/\1/p')
[ -n "$id" ] || fail "no agent id in $agent"
echo "smoke: agent $id"
api -X PATCH "http://127.0.0.1:8787/api/agents/$id" -d '{"wanted":"running"}' >/dev/null || fail "start the agent"
wait_for 300 "[ \"\$(rt docker inspect -f '{{.State.Running}}' ag-$id)\" = true ]" || fail "ag-$id never ran"
runtime=$(rt docker inspect -f '{{.HostConfig.Runtime}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.Config.User}}' "ag-$id")
echo "smoke: ag-$id runs with runtime, read-only, cap-drop, user: $runtime"
case "$runtime" in "runsc true [ALL] 10000:10000") ;; *) fail "ag-$id isn't isolated as expected: $runtime" ;; esac
rt docker exec "ag-$id" dmesg 2>/dev/null | grep -qi gvisor || fail "ag-$id's kernel isn't gVisor"
rt docker exec "ag-$id" sh -c '[ ! -e /var/run/docker.sock ] && [ ! -e /run/agentd ]' || fail "ag-$id can see a Docker or agentd socket"
ip=$(rt docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "ag-$id")
token=$(rt sed -n 's/^API_SERVER_KEY=//p' "/data/agent-conf/$id/.env")
wait_for 100 "rt curl -fsS -H 'authorization: Bearer $token' http://$ip:8642/v1/models" || fail "ag-$id's API never answered"
reply=$(rt curl -fsS -m 180 -H "authorization: Bearer $token" -H 'content-type: application/json' "http://$ip:8642/v1/chat/completions" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"smoke test ping"}]}') || fail "chat"
printf '%s' "$reply" | grep -q 'smoke test ping' || fail "the reply doesn't echo: $reply"
echo "smoke: the agent answered: $(printf '%s' "$reply" | head -c 300)"
[ -n "${KEEP:-}" ] || rt curl -fsS -o /dev/null -H "cookie: $COOKIE" -X DELETE "http://127.0.0.1:8787/api/agents/$id" || fail "delete the agent"
echo "smoke: ok"
