#!/bin/sh
set -eu
KEY="${1:?image-smoke.sh <app key> (the key whose sha256 the runtime was installed with)}"
D="${DOCKER:-docker}"
rt() { $D exec openhut "$@"; }
api() { rt curl -fsS -H "authorization: Bearer $KEY" -H 'content-type: application/json' "$@"; }
fail() { echo "smoke: $*" >&2; $D exec openhut sh -c 'tail -n 40 /var/log/openhut/agentd.log /var/log/openhut/app.log' >&2 || true; exit 1; }
wait_for() { i=0; until eval "$2" >/dev/null 2>&1; do i=$((i+1)); [ "$i" -gt "$1" ] && return 1; sleep 3; done; }

wait_for 100 'rt curl -fsS http://127.0.0.1:8787/health' || fail "no /health"
if ! api http://127.0.0.1:8787/api/cloud | grep -q '"status":"on"'; then
  url=$(api -X POST http://127.0.0.1:8787/api/cloud/sessions -d '{}' | sed -n 's/.*"authorizationUrl":"\([^"]*\)".*/\1/p')
  link=$(curl -fsS "$url" | grep -o 'href="[^"]*">mo@example.com<' | sed 's/^href="//; s/">mo@example.com<$//; s/&amp;/\&/g')
  back=$(curl -s -o /dev/null -D - "$link" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r')
  rt curl -fsS -o /dev/null "$back" || fail "sign in to the dev cloud at $url"
  wait_for 40 "api http://127.0.0.1:8787/api/cloud | grep -q '\"status\":\"on\"'" || fail "the runtime didn't sign in"
  echo "smoke: signed in as mo@example.com"
fi
agent=$(api -X POST http://127.0.0.1:8787/api/agents -d '{"name":"Smoke","instructions":"# Smoke\nYou echo."}') || fail "create an agent"
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
rt curl -fsS -o /dev/null -X DELETE -H "authorization: Bearer $KEY" "http://127.0.0.1:8787/api/agents/$id" || fail "delete the agent"
echo "smoke: ok"
