#!/bin/sh
# Full end-to-end run on a Mac with Docker Desktop: a bare Linux server container, JakeBox installed with ONE curl
# command, then the test phases:
#   tampered install on a throwaway server (must be refused) -> install build e2e-1 on the bare server -> main
#   -> install build e2e-2 over it (upgrade) -> after-upgrade
#   -> server restart -> after-restart -> report
# Needs: Docker Desktop running; Node 22.18+ on the Mac (serves the release, writes the report); 127.0.0.1:8098, :8099
# and :8787 free.
# Caches kept between runs (named volumes): Docker images (jakebox-docker), Alpine packages (jakebox-apkcache) and the
# Claude CLI download (jakebox-dlcache). Everything else starts empty.
set -u
cd "$(dirname "$0")/../.."
R=packages/e2e/results   # this run's results, gitignored
fail() { echo "e2e: $*"; exit 1; }
healthy() { curl -fsS http://127.0.0.1:8787/health 2>/dev/null | grep -q '"ok":true'; }
wait_healthy() { i=0; until healthy; do i=$((i+3)); [ $i -ge "$1" ] && return 1; sleep 3; done; }
redact() { sed -E 's/(code=)[0-9a-f]+/\1<redacted>/'; }
in_host() { docker exec jakebox-host "$@"; }

# Nothing from an earlier run may sit next to this run's results; the sources it tested are fingerprinted, so the report
# can tell when the tree has changed since.
rm -rf "$R" && mkdir -p "$R"
node packages/e2e/src/sources.ts > "$R/sources.sha256"
BUILD=e2e-1 BASE=http://host.docker.internal:8099 ./scripts/release.sh || fail "release"
node packages/e2e/src/serve.ts 8099 > dist/serve.log 2>&1 & SERVE=$!
trap 'kill $SERVE 2>/dev/null' EXIT
serving() { i=0; until curl -fsS -o /dev/null "http://127.0.0.1:$1/"; do i=$((i+1)); [ $i -gt 50 ] && fail "release server on :$1"; sleep 0.2; done; }
serving 8099

# The Docker volume only caches images. Remove every container, network and volume an earlier run left in it.
docker rm -f jakebox-host jakebox-lan jakebox-tamper >/dev/null 2>&1
docker run --rm --privileged -v jakebox-docker:/var/lib/docker --entrypoint sh docker:28-dind -c '
  (dockerd >/dev/null 2>&1 &); i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && exit 1; sleep 1; done
  docker ps -aq | xargs -r docker rm -f >/dev/null; docker network prune -f >/dev/null; docker volume prune -af >/dev/null
  echo "server cache: $(docker images -q | wc -l) images, $(docker ps -aq | wc -l) containers, $(docker network ls -q --filter type=custom | wc -l) networks"' || fail "cache cleanup"

# Stand-ins for the customer's network, outside the server: one listener with an address in each private range and at
# the cloud metadata address. The server reaches them; agents must not.
for n in "jb-lan10 10.99.0" "jb-lan172 172.29.0" "jb-lan192 192.168.77" "jb-meta 169.254.169"; do
  set -- $n; docker network inspect "$1" >/dev/null 2>&1 || docker network create --subnet "$2.0/24" "$1" >/dev/null || fail "network $1"
done
docker run -d --name jakebox-lan --network jb-lan10 --ip 10.99.0.10 --entrypoint sh docker:28-dind -c 'exec nc -lk -p 80 -e true' >/dev/null || fail "lan listener"
docker network connect --ip 172.29.0.10 jb-lan172 jakebox-lan && docker network connect --ip 192.168.77.10 jb-lan192 jakebox-lan &&
  docker network connect --ip 169.254.169.254 jb-meta jakebox-lan || fail "lan listener networks"

# A bare server: Alpine with Docker binaries, nothing of ours. On first boot it just waits; after the install, a restart
# boots JakeBox the way systemd would on a real host.
docker run -d --privileged --name jakebox-host -p 127.0.0.1:8787:8787 \
  -v jakebox-docker:/var/lib/docker -v jakebox-apkcache:/etc/apk/cache -v jakebox-dlcache:/var/cache/jakebox -v "$PWD/$R:/results" \
  --add-host host.docker.internal:host-gateway --entrypoint sh docker:28-dind \
  -c 'if [ -x /opt/jakebox/install/host-start.sh ]; then exec /opt/jakebox/install/host-start.sh; fi; exec sleep infinity' >/dev/null || fail "server"
docker network connect --ip 10.99.0.2 jb-lan10 jakebox-host && docker network connect --ip 172.29.0.2 jb-lan172 jakebox-host &&
  docker network connect --ip 192.168.77.2 jb-lan192 jakebox-host && docker network connect --ip 169.254.169.2 jb-meta jakebox-host || fail "server networks"

in_host timeout 300 apk add -q curl || fail "curl"   # a stock server has curl; the bare docker:dind image doesn't

echo "--- a mirror serving a jakebox.tgz with one byte changed: the installer must refuse it"
mkdir -p dist/tampered && sed 's|host.docker.internal:8099|host.docker.internal:8098|g' dist/install.sh > dist/tampered/install.sh &&
  cp dist/jakebox.tgz dist/tampered/ && printf 'X' | dd of=dist/tampered/jakebox.tgz bs=1 seek=4096 conv=notrunc 2>/dev/null || fail "tampered release"
node packages/e2e/src/serve.ts 8098 dist/tampered > dist/serve-tampered.log 2>&1 & BAD=$!
serving 8098
# On its own throwaway server, so the real install below still starts from a bare one.
docker run -d --name jakebox-tamper -v jakebox-apkcache:/etc/apk/cache --add-host host.docker.internal:host-gateway \
  --entrypoint sh docker:28-dind -c 'exec sleep infinity' >/dev/null || fail "tamper server"
docker exec jakebox-tamper timeout 300 apk add -q curl || fail "curl on the tamper server"
docker exec jakebox-tamper sh -c 'curl -fsSL http://host.docker.internal:8098 | JAKEBOX_MODEL=test sh; echo "installer exit=$?"; ls -d /opt/jakebox 2>&1' 2>&1 | redact | tee "$R/tamper.log"
kill $BAD 2>/dev/null; docker rm -f jakebox-tamper >/dev/null

echo "--- install: curl -fsSL http://host.docker.internal:8099 | JAKEBOX_MODEL=test sh"
in_host sh -c 'curl -fsSL http://host.docker.internal:8099 | JAKEBOX_MODEL=test sh' 2>&1 | redact | tee "$R/install.log"
grep -q "JakeBox is running" "$R/install.log" || fail "install"
# The test isn't part of the release; it runs on the server next to the app (it needs root, Docker and the app's packages).
copy_test() { in_host mkdir -p /opt/jakebox/packages/e2e/src && docker cp packages/e2e/src/e2e.ts jakebox-host:/opt/jakebox/packages/e2e/src/e2e.ts >/dev/null &&
  in_host chown -R root:root /opt/jakebox/packages/e2e; }   # docker cp keeps the Mac's owner
copy_test || fail "copy test"

in_host node /opt/jakebox/packages/e2e/src/e2e.ts main; main=$?

echo "--- upgrade: a new build, installed over the running server with the same command and no settings"
# Its pin names the same image another way, so the run can tell agentd took the new release's pin.
PIN="docker.io/$(cat install/agent-image)" BUILD=e2e-2 BASE=http://host.docker.internal:8099 ./scripts/release.sh || fail "release 2"
in_host sh -c 'curl -fsSL http://host.docker.internal:8099 | sh' 2>&1 | redact | tee "$R/upgrade.log"
wait_healthy 300 || echo "e2e: not healthy 5 min after the upgrade"
copy_test || fail "copy test"   # the upgrade swapped in a clean /opt/jakebox
in_host node /opt/jakebox/packages/e2e/src/e2e.ts after-upgrade; upgrade=$?

echo "--- restarting the server"; docker restart jakebox-host >/dev/null
wait_healthy 600 || echo "e2e: not healthy 10 min after the restart"
in_host node /opt/jakebox/packages/e2e/src/e2e.ts after-restart; after=$?

for f in boot agentd app; do in_host sh -c "grep -v -e ExperimentalWarning -e trace-warnings /var/log/jakebox/$f.log" > "$R/$f.log" 2>&1; done
node packages/e2e/src/report.ts > "$R/e2e-report.md"; report=$?
echo "main=$main after-upgrade=$upgrade after-restart=$after report=$report -> $R/e2e-report.md"
[ $main -eq 0 ] && [ $upgrade -eq 0 ] && [ $after -eq 0 ] && [ $report -eq 0 ]
