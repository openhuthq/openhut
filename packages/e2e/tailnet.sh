#!/bin/sh
set -u
cd "$(dirname "$0")/../.."
R=packages/e2e/results/tailnet
PORT=8098
BOX=openhut-tailnet
HOST_IMAGE=$(sed -n 's/^HOST_IMAGE=//p' install/install.sh)
fail() { echo "tailnet e2e: $*"; exit 1; }
in_box() { docker exec "$BOX" "$@"; }
stop_mirror() { [ -z "${MIRROR:-}" ] && return; kill -INT "$MIRROR" 2>/dev/null; MIRROR=; sleep 1; }
mirror() {
  stop_mirror
  cp "$1/install.sh" "$1/index.html"
  (cd private/site && WRANGLER_SEND_METRICS=false exec node_modules/.bin/wrangler dev --ip 0.0.0.0 --port $PORT --inspector-port 0 \
    --assets "../../$1" --show-interactive-dev-session=false --log-level warn) >>"$R/mirror.log" 2>&1 &
  MIRROR=$!
  i=0; until curl -fs -o /dev/null http://127.0.0.1:$PORT/; do i=$((i+1)); [ $i -gt 150 ] && fail "mirror of $1 on :$PORT"; sleep 0.2; done
}
copy_test() { in_box mkdir -p /opt/openhut/packages/e2e/src && docker cp packages/e2e/src/tailnet.ts "$BOX":/opt/openhut/packages/e2e/src/tailnet.ts >/dev/null; }
run_phase() { docker exec -e OPENHUT_COMPUTER_KEY="$COMPUTER" "$BOX" node --test-force-exit --test-reporter=spec /opt/openhut/packages/e2e/src/tailnet.ts "$1"; }

rm -rf "$R" && mkdir -p "$R"
trap 'stop_mirror; docker rm -f "$BOX" openhut-tailnet-host >/dev/null 2>&1' EXIT
OUT=dist/tailnet-1 BUILD=tailnet-1 BASE=http://host.docker.internal:$PORT ./scripts/release.sh || fail "release"
mirror dist/tailnet-1
docker rm -f "$BOX" >/dev/null 2>&1
docker run -d --privileged --name "$BOX" -v openhut-tailnet-docker:/var/lib/docker -v openhut-apkcache:/etc/apk/cache -v openhut-dlcache:/var/cache/openhut \
  -v "$PWD/$R:/results" --add-host host.docker.internal:host-gateway --entrypoint sh "$HOST_IMAGE" \
  -c 'if [ -x /opt/openhut/install/host-start.sh ]; then exec /opt/openhut/install/host-start.sh; fi; exec sleep infinity' >/dev/null || fail "box"
in_box timeout 300 apk add -q curl || fail "curl"

echo "--- install over the tailnet route: curl -fsSL … | OPENHUT_MODEL=test OPENHUT_ROUTE=tailnet sh"
in_box sh -c "curl -fsSL http://host.docker.internal:$PORT | OPENHUT_MODEL=test OPENHUT_ROUTE=tailnet sh" 2>&1 | tee "$R/install.log"
COMPUTER=$(sed -n 's/^OPENHUT_KEY=//p' "$R/install.log" | tail -1)
[ -n "$COMPUTER" ] || fail "the install didn't print the computer's key"
copy_test || fail "copy test"
run_phase pair; pair=$?

echo "--- upgrade with no settings, the way Update now runs it"
OUT=dist/tailnet-2 PIN="docker.io/$(cat install/agent-image)" BUILD=tailnet-2 BASE=http://host.docker.internal:$PORT ./scripts/release.sh || fail "release 2"
mirror dist/tailnet-2
in_box sh -c "curl -fsSL http://host.docker.internal:$PORT | sh" 2>&1 | tee "$R/upgrade.log"
copy_test || fail "copy test"
run_phase after-upgrade; upgrade=$?
in_box cat /var/log/openhut/app.log > "$R/app.log" 2>&1
docker rm -f "$BOX" >/dev/null 2>&1

echo "--- the host half: a bare Linux host (no /.dockerenv) runs OpenHut in the openhut container, publishes 8788 on 127.0.0.1 and asks Tailscale to serve it"
HOSTBOX=openhut-tailnet-host
docker rm -f "$HOSTBOX" >/dev/null 2>&1
docker run -d --privileged --name "$HOSTBOX" -v openhut-tailnet-host-docker:/var/lib/docker -v "$PWD/$R:/results" --add-host host.docker.internal:host-gateway \
  --entrypoint sh "$HOST_IMAGE" -c 'rm -f /.dockerenv; exec sleep infinity' >/dev/null || fail "host box"
docker exec "$HOSTBOX" sh -c '(dockerd >/var/log/dockerd.log 2>&1 &); apk add -q curl; printf "%s\n" "#!/bin/sh" "echo \"\$*\" >> /results/tailscale-calls.log" "[ \"\$*\" != \"serve --help\" ] || echo \"  --tcp uint\"" > /usr/local/bin/tailscale; chmod +x /usr/local/bin/tailscale' || fail "host box setup"
docker exec "$HOSTBOX" sh -c "curl -fsSL http://host.docker.internal:$PORT | OPENHUT_MODEL=test OPENHUT_ROUTE=tailnet sh" 2>&1 | tee "$R/host-install.log"
COMPUTER=$(sed -n 's/^OPENHUT_KEY=//p' "$R/host-install.log" | tail -1)
ports=$(docker exec "$HOSTBOX" docker port openhut)
echo "$ports"
upgrade_reply=$(docker exec "$HOSTBOX" sh -c 'curl -s -o /dev/null -w %{http_code} -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" http://127.0.0.1:8788/')
echo "a WebSocket upgrade on the host's 127.0.0.1:8788 answered $upgrade_reply"
docker exec "$HOSTBOX" docker exec openhut mkdir -p /opt/openhut/packages/e2e/src && docker cp packages/e2e/src/tailnet.ts "$HOSTBOX":/tmp/tailnet.ts >/dev/null &&
  docker exec "$HOSTBOX" docker cp /tmp/tailnet.ts openhut:/opt/openhut/packages/e2e/src/tailnet.ts >/dev/null || fail "copy test into the container"
docker exec "$HOSTBOX" docker exec -e RESULTS=/tmp -e OPENHUT_COMPUTER_KEY="$COMPUTER" openhut node --test-force-exit --test-reporter=spec /opt/openhut/packages/e2e/src/tailnet.ts pair; host=$?
cat "$R/tailscale-calls.log"
grep -qx "serve --bg --tcp 8788 tcp://127.0.0.1:8788" "$R/tailscale-calls.log" && served=0 || served=1
echo "$ports" | grep -q "8788/tcp -> 127.0.0.1:8788" && published=0 || published=1
[ "$upgrade_reply" = 101 ] && reachable=0 || reachable=1
docker rm -f "$HOSTBOX" >/dev/null 2>&1

echo "pair=$pair after-upgrade=$upgrade host=$host served=$served published=$published reachable=$reachable"
[ $pair -eq 0 ] && [ $upgrade -eq 0 ] && [ $host -eq 0 ] && [ $served -eq 0 ] && [ $published -eq 0 ] && [ $reachable -eq 0 ]
