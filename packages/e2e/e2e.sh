#!/bin/sh
set -u
cd "$(dirname "$0")/../.."
R=packages/e2e/results
fail() { echo "e2e: $*"; exit 1; }
healthy() { curl -fsS http://127.0.0.1:8787/health 2>/dev/null | grep -q '"ok":true'; }
wait_healthy() { i=0; until healthy; do i=$((i+3)); [ $i -ge "$1" ] && return 1; sleep 3; done; }
redact() { sed -E 's/(code=)[0-9a-f]+/\1<redacted>/'; }
in_host() { docker exec fastmonkey-host "$@"; }
run_phase() { in_host node --test-force-exit --test-reporter=spec /opt/fastmonkey/packages/e2e/src/e2e.ts "$1"; }
tree_sha() { { git rev-parse HEAD; git diff HEAD --binary; git ls-files -o --exclude-standard -z | xargs -0 shasum -a 256; } | shasum -a 256 | cut -d' ' -f1; }
stop_mirror() { [ -z "${MIRROR:-}" ] && return; kill -INT "$MIRROR" 2>/dev/null; i=0; while curl -fs -o /dev/null http://127.0.0.1:8099/ && [ $i -lt 50 ]; do i=$((i+1)); sleep 0.2; done; MIRROR=; }
mirror() {
  stop_mirror
  (cd packages/site && WRANGLER_SEND_METRICS=false exec ../../node_modules/.bin/wrangler dev --ip 0.0.0.0 --port 8099 --inspector-port 0 \
    --assets "../../$1" --show-interactive-dev-session=false --log-level warn) >>"$R/mirror.log" 2>&1 &
  MIRROR=$!
  i=0; until curl -fs -o /dev/null http://127.0.0.1:8099/; do i=$((i+1)); [ $i -gt 150 ] && fail "mirror of $1 on :8099"; sleep 0.2; done
}

rm -rf "$R" && mkdir -p "$R"
tree_sha > "$R/tree.sha256"
BUILD=e2e-1 BASE=http://host.docker.internal:8099 ./scripts/release.sh || fail "release"
trap stop_mirror EXIT
mirror dist

docker rm -f fastmonkey-host fastmonkey-lan >/dev/null 2>&1
docker run --rm --privileged -v fastmonkey-docker:/var/lib/docker --entrypoint sh docker:28-dind -c '
  (dockerd >/dev/null 2>&1 &); i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && exit 1; sleep 1; done
  docker ps -aq | xargs -r docker rm -f >/dev/null; docker network prune -f >/dev/null; docker volume prune -af >/dev/null
  echo "server cache: $(docker images -q | wc -l) images, $(docker ps -aq | wc -l) containers, $(docker network ls -q --filter type=custom | wc -l) networks"' || fail "cache cleanup"

for n in "fm-lan10 10.99.0" "fm-lan172 172.29.0" "fm-lan192 192.168.77" "fm-meta 169.254.169"; do
  set -- $n; docker network inspect "$1" >/dev/null 2>&1 || docker network create --subnet "$2.0/24" "$1" >/dev/null || fail "network $1"
done
docker run -d --name fastmonkey-lan --network fm-lan10 --ip 10.99.0.10 --entrypoint sh docker:28-dind -c 'exec nc -lk -p 80 -e true' >/dev/null || fail "lan listener"
docker network connect --ip 172.29.0.10 fm-lan172 fastmonkey-lan && docker network connect --ip 192.168.77.10 fm-lan192 fastmonkey-lan &&
  docker network connect --ip 169.254.169.254 fm-meta fastmonkey-lan || fail "lan listener networks"

docker run -d --privileged --name fastmonkey-host -p 127.0.0.1:8787:8787 \
  -v fastmonkey-docker:/var/lib/docker -v fastmonkey-apkcache:/etc/apk/cache -v fastmonkey-dlcache:/var/cache/fastmonkey -v "$PWD/$R:/results" \
  --add-host host.docker.internal:host-gateway --entrypoint sh docker:28-dind \
  -c 'if [ -x /opt/fastmonkey/install/host-start.sh ]; then exec /opt/fastmonkey/install/host-start.sh; fi; exec sleep infinity' >/dev/null || fail "server"
docker network connect --ip 10.99.0.2 fm-lan10 fastmonkey-host && docker network connect --ip 172.29.0.2 fm-lan172 fastmonkey-host &&
  docker network connect --ip 192.168.77.2 fm-lan192 fastmonkey-host && docker network connect --ip 169.254.169.2 fm-meta fastmonkey-host || fail "server networks"

in_host timeout 300 apk add -q curl || fail "curl"

echo "--- install: curl -fsSL http://host.docker.internal:8099 | FASTMONKEY_MODEL=test sh"
in_host sh -c 'curl -fsSL http://host.docker.internal:8099 | FASTMONKEY_MODEL=test sh' 2>&1 | redact | tee "$R/install.log"
grep -q "Fast Monkey is running" "$R/install.log" || fail "install"
copy_test() { in_host mkdir -p /opt/fastmonkey/packages/e2e/src && docker cp packages/e2e/src/e2e.ts fastmonkey-host:/opt/fastmonkey/packages/e2e/src/e2e.ts >/dev/null &&
  in_host chown -R root:root /opt/fastmonkey/packages/e2e; }
copy_test || fail "copy test"

run_phase main; main=$?

PIN="docker.io/$(cat install/agent-image)" BUILD=e2e-2 BASE=http://host.docker.internal:8099 ./scripts/release.sh || fail "release 2"
echo "--- a tampered upgrade: the mirror serves e2e-2 with one byte of fastmonkey.tgz changed; the installer must refuse it and leave e2e-1"
mkdir dist/tampered && cp dist/install.sh dist/fastmonkey.tgz dist/tampered/ &&
  printf 'X' | dd of=dist/tampered/fastmonkey.tgz bs=1 seek=4096 conv=notrunc 2>/dev/null || fail "tampered release"
mirror dist/tampered
in_host sh -c 'curl -fsSL http://host.docker.internal:8099 | sh; echo "installer exit=$?"; echo "BUILD $(cat /opt/fastmonkey/BUILD)"' 2>&1 | redact | tee "$R/tamper.log"
mirror dist

echo "--- upgrade: a new build, installed over the running server with the same command and no settings"
in_host sh -c 'curl -fsSL http://host.docker.internal:8099 | sh' 2>&1 | redact | tee "$R/upgrade.log"
wait_healthy 300 || echo "e2e: not healthy 5 min after the upgrade"
copy_test || fail "copy test"
run_phase after-upgrade; upgrade=$?

echo "--- restarting the server"; docker restart fastmonkey-host >/dev/null
wait_healthy 600 || echo "e2e: not healthy 10 min after the restart"
run_phase after-restart; after=$?

for f in boot agentd app; do in_host sh -c "grep -v -e ExperimentalWarning -e trace-warnings /var/log/fastmonkey/$f.log" > "$R/$f.log" 2>&1; done
[ "$(tree_sha)" = "$(cat "$R/tree.sha256")" ] && tree=same || tree=changed
node packages/e2e/src/report.ts "$tree" > "$R/e2e-report.md"; report=$?
echo "main=$main after-upgrade=$upgrade after-restart=$after report=$report -> $R/e2e-report.md"
[ $main -eq 0 ] && [ $upgrade -eq 0 ] && [ $after -eq 0 ] && [ $report -eq 0 ]
