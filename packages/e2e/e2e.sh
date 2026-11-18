#!/bin/sh
set -u
[ "$(uname)" = Darwin ] && [ -z "${E2E_AWAKE:-}" ] && E2E_AWAKE=1 exec caffeinate -is "$0" "$@"
cd "$(dirname "$0")/../.."
R=packages/e2e/results
HOST_IMAGE=$(sed -n 's/^HOST_IMAGE=//p' install/install.sh)
fail() { echo "e2e: $*"; exit 1; }
healthy() { in_host curl -fsS http://127.0.0.1:8787/health 2>/dev/null | grep -q '"ok":true'; }
wait_healthy() { i=0; until healthy; do i=$((i+3)); [ $i -ge "$1" ] && return 1; sleep 3; done; }
redact() { sed -E 's/(code=)[0-9a-f]+/\1<redacted>/'; }
in_host() { docker exec openhut-host "$@"; }
run_phase() { docker exec -e OPENHUT_E2E_KEY="$KEY" openhut-host node --test-force-exit --test-reporter=spec /opt/openhut/packages/e2e/src/e2e.ts "$1"; }
tree_sha() { { git rev-parse HEAD; git diff HEAD --binary; git ls-files -o --exclude-standard -z | xargs -0 shasum -a 256; } | shasum -a 256 | cut -d' ' -f1; }
stop_mirror() { [ -z "${MIRROR:-}" ] && return; kill -INT "$MIRROR" 2>/dev/null; i=0; while curl -fs -o /dev/null http://127.0.0.1:8099/ && [ $i -lt 50 ]; do i=$((i+1)); sleep 0.2; done; MIRROR=; }
mirror() {
  stop_mirror
  curl -fs -o /dev/null http://127.0.0.1:8099/ && fail ":8099 already answers; stop the mirror an earlier run left behind"
  (cd private/site && WRANGLER_SEND_METRICS=false exec node_modules/.bin/wrangler dev --ip 0.0.0.0 --port 8099 --inspector-port 0 \
    --assets "../../$1" --show-interactive-dev-session=false --log-level warn) >>"$R/mirror.log" 2>&1 &
  MIRROR=$!
  i=0; until curl -fs -o /dev/null http://127.0.0.1:8099/; do i=$((i+1)); [ $i -gt 150 ] && fail "mirror of $1 on :8099"; sleep 0.2; done
}

rm -rf "$R" && mkdir -p "$R"
KEY=$(openssl rand -hex 32) && KEY_SHA256=$(printf %s "$KEY" | shasum -a 256 | cut -c1-64) || fail "app key"
tree_sha > "$R/tree.sha256"
BUILD=e2e-1 BASE=http://host.docker.internal:8099 ./scripts/release.sh || fail "release"
trap stop_mirror EXIT
mirror dist

docker rm -f openhut-host openhut-lan >/dev/null 2>&1
docker run --rm --privileged -v openhut-docker:/var/lib/docker --entrypoint sh "$HOST_IMAGE" -c '
  (dockerd >/dev/null 2>&1 &); i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && exit 1; sleep 1; done
  docker ps -aq | xargs -r docker rm -f >/dev/null; docker network prune -f >/dev/null; docker volume prune -af >/dev/null
  echo "server cache: $(docker images -q | wc -l) images, $(docker ps -aq | wc -l) containers, $(docker network ls -q --filter type=custom | wc -l) networks"' || fail "cache cleanup"

for n in "fm-lan10 10.99.0" "fm-lan172 172.29.0" "fm-lan192 192.168.77" "fm-meta 169.254.169"; do
  set -- $n; docker network inspect "$1" >/dev/null 2>&1 || docker network create --subnet "$2.0/24" "$1" >/dev/null || fail "network $1"
done
docker run -d --name openhut-lan --network fm-lan10 --ip 10.99.0.10 --entrypoint sh "$HOST_IMAGE" -c 'nc -lk -p 443 -e true & exec nc -lk -p 80 -e true' >/dev/null || fail "lan listener"
docker network connect --ip 172.29.0.10 fm-lan172 openhut-lan && docker network connect --ip 192.168.77.10 fm-lan192 openhut-lan &&
  docker network connect --ip 169.254.169.254 fm-meta openhut-lan || fail "lan listener networks"

docker run -d --privileged --name openhut-host -p 127.0.0.1:8787:8787 \
  -v openhut-docker:/var/lib/docker -v openhut-apkcache:/etc/apk/cache -v openhut-dlcache:/var/cache/openhut -v "$PWD/$R:/results" \
  --add-host host.docker.internal:host-gateway --entrypoint sh "$HOST_IMAGE" \
  -c 'if [ -x /opt/openhut/install/host-start.sh ]; then exec /opt/openhut/install/host-start.sh; fi; exec sleep infinity' >/dev/null || fail "server"
docker network connect --ip 10.99.0.2 fm-lan10 openhut-host && docker network connect --ip 172.29.0.2 fm-lan172 openhut-host &&
  docker network connect --ip 192.168.77.2 fm-lan192 openhut-host && docker network connect --ip 169.254.169.2 fm-meta openhut-host || fail "server networks"

in_host timeout 300 apk add -q curl || fail "curl"

echo "--- install: curl -fsSL http://host.docker.internal:8099 | OPENHUT_MODEL=test OPENHUT_CLIENT_KEY_SHA256=<the app key's hash> sh"
in_host sh -c "curl -fsSL http://host.docker.internal:8099 | OPENHUT_MODEL=test OPENHUT_CLIENT_KEY_SHA256=$KEY_SHA256 sh" 2>&1 | redact | tee "$R/install.log"
grep -q "OpenHut is running" "$R/install.log" || fail "install"
copy_test() { in_host mkdir -p /opt/openhut/packages/e2e/src && docker cp packages/e2e/src/e2e.ts openhut-host:/opt/openhut/packages/e2e/src/e2e.ts >/dev/null &&
  in_host chown -R root:root /opt/openhut/packages/e2e; }
copy_test || fail "copy test"

run_phase main; main=$?

echo "--- re-add: the app adds this computer again with a new key; the same build pairs instead of reinstalling, then the first key is added back"
KEY2=$(openssl rand -hex 32) && KEY2_SHA256=$(printf %s "$KEY2" | shasum -a 256 | cut -c1-64) || fail "second app key"
answers() { in_host curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $1" http://127.0.0.1:8787/api/me; }
{ in_host sh -c "curl -fsSL http://host.docker.internal:8099 | OPENHUT_CLIENT_KEY_SHA256=$KEY2_SHA256 sh" 2>&1
  echo "first key $(answers "$KEY"), new key $(answers "$KEY2")"
  in_host sh -c "curl -fsSL http://host.docker.internal:8099 | OPENHUT_CLIENT_KEY_SHA256=$KEY_SHA256 sh" 2>&1
  echo "first key again $(answers "$KEY"), new key $(answers "$KEY2")"; } | redact | tee "$R/re-add.log"

PIN="docker.io/$(cat install/agent-image)" BUILD=e2e-2 BASE=http://host.docker.internal:8099 ./scripts/release.sh || fail "release 2"
echo "--- a tampered upgrade: the mirror serves e2e-2 with one byte of openhut.tgz changed; the installer must refuse it and leave e2e-1"
mkdir dist/tampered && cp dist/install.sh dist/openhut.tgz dist/tampered/ &&
  printf 'X' | dd of=dist/tampered/openhut.tgz bs=1 seek=4096 conv=notrunc 2>/dev/null || fail "tampered release"
mirror dist/tampered
in_host sh -c 'curl -fsSL http://host.docker.internal:8099 | sh; echo "installer exit=$?"; echo "BUILD $(cat /opt/openhut/BUILD)"' 2>&1 | redact | tee "$R/tamper.log"
mirror dist

echo "--- upgrade: a new build, installed over the running server with the same command and no settings"
in_host sh -c 'curl -fsSL http://host.docker.internal:8099 | sh' 2>&1 | redact | tee "$R/upgrade.log"
wait_healthy 300 || echo "e2e: not healthy 5 min after the upgrade"
copy_test || fail "copy test"
run_phase after-upgrade; upgrade=$?

echo "--- an update cut short: /opt/openhut.old is still there when the server restarts, so the previous release must come back"
in_host sh -c 'rm -rf /data/app.before-update && cp -a /opt/openhut /opt/openhut.old && touch /opt/openhut.old/RECOVERED' || fail "an interrupted update"
echo "--- restarting the server"; docker restart openhut-host >/dev/null
wait_healthy 600 || echo "e2e: not healthy 10 min after the restart"
run_phase after-restart; after=$?

PIN="docker.io/$(cat install/agent-image)" BUILD=e2e-3 BASE=http://host.docker.internal:8099 ./scripts/release.sh || fail "release 3"
echo "--- Update now with a broken release: its app can't start, so the installer must put e2e-2 back"
mkdir -p dist/broken/tree && tar -xzf dist/openhut.tgz -C dist/broken/tree &&
  echo "throw new Error('this release is broken on purpose')" > dist/broken/tree/packages/runtime/src/server/app.ts && echo e2e-broken > dist/broken/tree/BUILD &&
  COPYFILE_DISABLE=1 tar -czf dist/broken/openhut.tgz -C dist/broken/tree . && rm -rf dist/broken/tree &&
  sed -e "s|^OPENHUT_SHA256=.*|OPENHUT_SHA256=\"$(shasum -a 256 dist/broken/openhut.tgz | cut -d' ' -f1)\"|" -e 's|^OPENHUT_BUILD=.*|OPENHUT_BUILD="e2e-broken"|' dist/install.sh > dist/broken/install.sh || fail "broken release"
mirror dist/broken
run_phase update-broken; broken=$?
mirror dist
echo "--- Update now: e2e-3, installed from Admin's API"
run_phase update; update=$?

for f in boot agentd app; do in_host sh -c "grep -v -e ExperimentalWarning -e trace-warnings /var/log/openhut/$f.log" > "$R/$f.log" 2>&1; done
[ "$(tree_sha)" = "$(cat "$R/tree.sha256")" ] && tree=same || tree=changed
node packages/e2e/src/report.ts "$tree" > "$R/e2e-report.md"; report=$?
echo "main=$main after-upgrade=$upgrade after-restart=$after update-broken=$broken update=$update report=$report -> $R/e2e-report.md"
[ $main -eq 0 ] && [ $upgrade -eq 0 ] && [ $after -eq 0 ] && [ $broken -eq 0 ] && [ $update -eq 0 ] && [ $report -eq 0 ]
