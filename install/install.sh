#!/bin/sh
set -eu
OPENHUT_URL="${OPENHUT_URL:-https://openhut.dev}"
OPENHUT_SHA256="@OPENHUT_SHA256@"
OPENHUT_BUILD="@OPENHUT_BUILD@"
OPENHUT_TGZ="@OPENHUT_TGZ@"
MIN_APP_VERSION="@OPENHUT_MIN_APP@"
GVISOR=20261109.0
NODE=22.23.5
CLAUDE=2.1.311
AGENT_BROWSER=0.43.0
HOST_IMAGE=docker:28-dind@sha256:2a232a42256f70d78e3cc5d2b5d6b3276710a0de0596c145f627ecfae90282ac
PREFIX=/opt/openhut
JOIN_CODE="${OPENHUT_JOIN:-}"
ROUTE="${OPENHUT_ROUTE:-}"
TAILNET_PORT=8788
[ "${1:-}" != join ] || JOIN_CODE="${2:-}"
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'openhut: %s\n' "$*" >&2; exit 1; }
retry() { n=0; until timeout 600 "$@"; do n=$((n+1)); [ $n -ge 4 ] && return 1; echo "  retrying: $1 ($n)"; sleep 5; done; }
fetch() { curl -fsSL --retry 4 --retry-all-errors --connect-timeout 15 -m 900 "$1" -o "$2"; }
check() { printf '%s  %s\n' "$2" "$3" | "$1" -c - >/dev/null || die "checksum mismatch: $3"; }
joining() { [ -n "$JOIN_CODE" ]; }
tailnet() { [ "$ROUTE" = tailnet ]; }
serve_tailnet() {
  command -v tailscale >/dev/null 2>&1 || die "Tailscale isn't installed on this computer. Install it from tailscale.com/download, sign in, then try again."
  ${SUDO:-} tailscale serve --help 2>&1 | grep -q -- '--tcp' || die "this Tailscale is too old to share a port with your tailnet. Update Tailscale, then try again."
  say "Opening port $TAILNET_PORT to your tailnet only"
  ${SUDO:-} timeout 300 tailscale serve --bg --tcp "$TAILNET_PORT" "tcp://127.0.0.1:$TAILNET_PORT" || die "Tailscale didn't open port $TAILNET_PORT to your tailnet. If it printed a link, open it to allow Serve on your tailnet, then try again."
}
key_line() { k=$(curl -fsS --unix-socket /data/app/openhut.sock http://openhut/api/admin 2>/dev/null | sed -n 's/.*"relay":{"key":"\([0-9a-f]\{64\}\)".*/\1/p'); [ -z "$k" ] || echo "OPENHUT_KEY=$k"; }
node_ok() { node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }

write_env() {
  mkdir -p /etc/openhut && touch /etc/openhut/env && chmod 0600 /etc/openhut/env
  IMAGE_OVERRIDE="${AGENT_IMAGE:-}"
  SOURCE_URL="$OPENHUT_URL"
  LISTEN="${OPENHUT_CONTAINER:+0.0.0.0}"
  . /etc/openhut/env
  LISTEN="${LISTEN:-${OPENHUT_HOST:-}}"
  IMAGE_OVERRIDE="${IMAGE_OVERRIDE:-${AGENT_IMAGE:-}}"
  umask 077
  {
    echo "RESOLVER=${RESOLVER:-1.1.1.1}"
    [ -z "$IMAGE_OVERRIDE" ] || echo "AGENT_IMAGE=$IMAGE_OVERRIDE"
    echo "OPENHUT_MODEL=${OPENHUT_MODEL:-claude}"
    echo "OPENHUT_URL=$SOURCE_URL"
    [ -z "$CLIENT_KEY" ] || echo "OPENHUT_CLIENT_KEY_SHA256=$CLIENT_KEY"
    if tailnet; then echo "OPENHUT_ROUTE=tailnet"; echo "OPENHUT_TAILNET_PORT=$TAILNET_PORT"; echo "OPENHUT_RELAY_URL="
    elif joining; then echo "OPENHUT_JOIN='$JOIN_CODE'"; fi
    [ -z "$LISTEN" ] || echo "OPENHUT_HOST=$LISTEN"
    [ -z "${OPENHUT_CLOUD_URL:-}" ] || echo "OPENHUT_CLOUD_URL=$OPENHUT_CLOUD_URL"
  } > /etc/openhut/env.new
  mv /etc/openhut/env.new /etc/openhut/env
  . /etc/openhut/env
  umask 022
}
stop_app() {
  if [ -d /run/systemd/system ]; then systemctl stop openhut.service 2>/dev/null || true
  else pkill -f "install/supervise.sh /var/log/openhut/app.log" 2>/dev/null || true; pkill -f "^node $PREFIX/packages/.*/app\.ts" 2>/dev/null || true; sleep 1; fi
}
start() {
  STARTED_AFTER=$(date +%s)
  [ ! -f "$PREFIX/install/recover.sh" ] || cp "$PREFIX/install/recover.sh" /etc/openhut/recover.sh
  if [ -d /run/systemd/system ]; then
    cp "$PREFIX"/install/systemd/*.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable -q openhut-firewall.service docker.service openhut-agentd.service openhut.service
    systemctl restart ${1-openhut-firewall.service docker.service openhut-agentd.service} openhut.service
  else
    nohup "$PREFIX/install/host-start.sh" >> /var/log/openhut-boot.log 2>&1 9>&- &
  fi
}
go_back() {
  rm -rf "$PREFIX.failed"; mv "$PREFIX" "$PREFIX.failed"; mv "$PREFIX.old" "$PREFIX"
  if [ -d /data/app.before-update ]; then stop_app; rm -rf /data/app && cp -a /data/app.before-update /data/app; fi
  [ ! -f /data/app.before-update.env ] || cp /data/app.before-update.env /etc/openhut/env
  start || true
  rm -rf "$PREFIX.failed"
}
fresh() { h=$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null) && echo "$h" | grep -q '"ok":true' &&
  [ "$(echo "$h" | sed -n 's/.*"started":\([0-9]*\).*/\1/p')" -ge "$STARTED_AFTER" ]; }
up() { i=0; until fresh; do i=$((i+1)); [ $i -gt "$1" ] && return 1; printf .; sleep 3; done; }
running() {
  if tailnet; then echo "OpenHut is running. Your Mac reaches it over your tailnet."; key_line
  elif [ -n "$ASKED" ]; then echo "OpenHut is running and asking to join your computers. Check the six digits in the OpenHut app and accept it there."
  elif joining; then echo "OpenHut is running."
  else echo "OpenHut is running for the app key sha256:$(printf '%s' "$CLIENT_KEY" | cut -c1-8)..."; fi
}

NO_KEY="no app key: add this computer from the OpenHut app (Settings > Computers), which gives you the command to run here (curl -fsSL openhut.dev | sh -s -- join <code>)"
[ -z "$ROUTE" ] || tailnet || die "OPENHUT_ROUTE can only be tailnet."
if joining; then printf '%s' "$JOIN_CODE" | grep -Eqx "openhut://join\?[0-9A-Za-z_.~%=&:/?-]+" || die "that join code isn't one the OpenHut app gave. Copy the whole command from the app again."; fi
if [ -n "${OPENHUT_APP_VERSION:-}" ] && [ "${MIN_APP_VERSION#@}" = "$MIN_APP_VERSION" ] &&
  [ "$(printf '%s\n%s\n' "$MIN_APP_VERSION" "$OPENHUT_APP_VERSION" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" != "$MIN_APP_VERSION" ]; then
  die "this release needs the OpenHut app $MIN_APP_VERSION or newer, and yours is $OPENHUT_APP_VERSION. Update OpenHut, then try again. Nothing changed here."
fi
container() {
  $D run -d --name openhut --privileged --restart unless-stopped -p 127.0.0.1:8787:8787 ${PUBLISH:-} -v openhut:/var/lib/docker --entrypoint sh "$1" \
    -c 'if [ -x /opt/openhut/install/host-start.sh ]; then exec /opt/openhut/install/host-start.sh; fi; exec sleep infinity' >/dev/null
}

if [ ! -f /.dockerenv ] && [ ! -d "$PREFIX" ]; then
  SUDO=; [ "$(id -u)" = 0 ] || SUDO=sudo
  if ! command -v docker >/dev/null 2>&1; then
    [ "$(uname -s)" = Linux ] || die "OpenHut runs in Docker. Install Docker Desktop (https://docs.docker.com/desktop/), open it, then run this again."
    say "Docker"
    if command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -qq && $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io >/dev/null
    elif command -v apk >/dev/null 2>&1; then $SUDO apk add -q docker && $SUDO rc-update add docker default >/dev/null && $SUDO service docker start >/dev/null
    else die "install Docker, then run this again"; fi
  fi
  D=docker; docker info >/dev/null 2>&1 || D="$SUDO docker"
  i=0; until $D info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 30 ] && die "Docker isn't running. Start it, then run this again."; sleep 1; done
  say "OpenHut container"
  bound() { [ "$($D container inspect -f "{{range (index .HostConfig.PortBindings \"$1/tcp\")}}{{.HostIp}}{{end}}" openhut 2>/dev/null)" = 127.0.0.1 ]; }
  PUBLISH=
  if tailnet; then
    PUBLISH="-p 127.0.0.1:$TAILNET_PORT:$TAILNET_PORT"
    command -v tailscale >/dev/null 2>&1 || die "Tailscale isn't installed on this computer. Install it from tailscale.com/download, sign in, then try again."
    if ! bound "$TAILNET_PORT" && { ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null; } | grep -Eq "[:.]$TAILNET_PORT[[:space:]]"; then die "port $TAILNET_PORT is taken on this computer, so your Mac can't reach OpenHut over Tailscale. Free it, then try again. Nothing changed here."; fi
  elif $D container inspect openhut >/dev/null 2>&1 && bound "$TAILNET_PORT"; then
    PUBLISH="-p 127.0.0.1:$TAILNET_PORT:$TAILNET_PORT"
  fi
  if ! $D container inspect openhut >/dev/null 2>&1; then
    joining || tailnet || printf '%s' "${OPENHUT_CLIENT_KEY_SHA256:-}" | grep -Eqx '[0-9a-f]{64}' || die "$NO_KEY"
    container "$HOST_IMAGE"
  elif ! bound 8787 || { [ -n "$PUBLISH" ] && ! bound "$TAILNET_PORT"; }; then
    say "Publishing OpenHut on this computer's 127.0.0.1 only (the container is kept: its data comes along)"
    $D stop -t 30 openhut >/dev/null
    $D commit openhut openhut:kept >/dev/null
    $D rm openhut >/dev/null
    container openhut:kept
  fi
  $D start openhut >/dev/null
  ! tailnet || serve_tailnet
  printf '%s\n' "$JOIN_CODE" | $D exec -i -e OPENHUT_CONTAINER=1 -e "OPENHUT_ROUTE=$ROUTE" -e "OPENHUT_CLIENT_KEY_SHA256=${OPENHUT_CLIENT_KEY_SHA256:-}" -e "OPENHUT_APP_VERSION=${OPENHUT_APP_VERSION:-}" openhut sh -c "read -r OPENHUT_JOIN; export OPENHUT_JOIN; apk add -q curl && curl -fsSL $OPENHUT_URL | sh" || exit 1
  exit 0
fi

[ "$(uname -s)" = Linux ] || die "OpenHut runs only on Linux (Debian, Ubuntu or Alpine; x86_64 or arm64), not $(uname -s). On a Mac or Windows, run this inside a Linux VM or on a Linux server."
[ "$(id -u)" = 0 ] || die "run as root:  curl -fsSL $OPENHUT_URL | sudo sh"
ENROLLED="$(sed -n 's/^OPENHUT_CLIENT_KEY_SHA256=//p' /etc/openhut/env 2>/dev/null || true)"
CLIENT_KEY="${OPENHUT_CLIENT_KEY_SHA256:-$ENROLLED}"
ASKED="$JOIN_CODE"
[ -n "$ASKED" ] || ROUTE="${ROUTE:-$(sed -n 's/^OPENHUT_ROUTE=//p' /etc/openhut/env 2>/dev/null || true)}"
tailnet || JOIN_CODE="${JOIN_CODE:-$(sed -n "s/^OPENHUT_JOIN='\(.*\)'$/\1/p" /etc/openhut/env 2>/dev/null || true)}"
joining || tailnet || printf '%s' "$CLIENT_KEY" | grep -Eqx '[0-9a-f]{64}' || die "$NO_KEY"
if command -v flock >/dev/null 2>&1; then
  exec 9>/run/openhut-install.lock
  i=0; until flock -n 9; do
    [ $i -eq 0 ] && say "Waiting for another install to finish"
    i=$((i+1)); [ $i -ge 180 ] && die "another install or update is still running after 3 minutes; try again when it's done"; sleep 1
  done
fi
[ -z "$ENROLLED" ] || [ -z "$CLIENT_KEY" ] || [ "$ENROLLED" = "$CLIENT_KEY" ] || echo "  A new app key: the app that added this computer before can't reach it anymore."
if [ "$(cat "$PREFIX/BUILD" 2>/dev/null)" = "$OPENHUT_BUILD" ] && [ -f /etc/openhut/env ]; then
  say "Pairing with this computer"
  write_env
  start ''
  printf 'Waiting for OpenHut'
  up 100 || { printf '\n'; die "OpenHut didn't come back with the new key; see /var/log/openhut"; }
  printf '\n'
  ! tailnet || [ -f /.dockerenv ] || serve_tailnet
  running
  exit 0
fi
case "$(uname -m)" in
  x86_64)  ARCH=x86_64 NARCH=x64
           CLAUDE_SHA256=86dc1fcc69498159eaf15f446613e847010f9036bfbbdffd4c49350be8489ada
           AGENT_BROWSER_SHA512=598f2fcb649a6b7a11b7a5c49b3e1269ed56e6a4bd4e361c6d7e8813e7716fcb3600f7cbf57c908cc1c2ea3059ae1c2a0c122f51e4cc093fcfd9cab75cb3d207
           GVISOR_SHA512=0a0041fd862f4ea3042a9db8d41c742f48a01f909699adc2a0256e46d85e53f97b82b9fd154b3dce636f62b8d557677639f91c77d13f3f875ff9fa535275393c
           NODE_SHA256=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8 ;;
  aarch64) ARCH=aarch64 NARCH=arm64
           CLAUDE_SHA256=2e2496c9a8065df93acb0fca2d341f59a6b8777649b2e025ab8c9bcd5eef61f3
           AGENT_BROWSER_SHA512=f030b6df82c69570a7f00d985c693ac28cb5b938f27b1bed1ddfd33901cbad5dac7d43190fae3b1d31c427217edb3d49d68477e0b681e63a8727d7744440be0b
           GVISOR_SHA512=a0b5d911512ef5fe70e833821e653a90c4d06c7027246ee49423f1d2fe2b2a509389a637797248958b90e49a069bb079ecde860efe1871b1d980ec0fe17e18ac
           NODE_SHA256=2babb9eb5264860d540849f4b064a6fbdebcdc323657d9d382ce23d313fd5e09 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
TMP=$(mktemp -d)
trap 'code=$?; rm -rf "$TMP"; if [ -n "${SWAPPED:-}" ] && [ -d "$PREFIX.old" ]; then echo "openhut: the install stopped after the swap, so the previous release is going back"; go_back; fi; exit $code' EXIT

say "Packages"
if command -v apk >/dev/null 2>&1; then
  PKGS="nodejs npm iptables ip6tables iproute2 curl zstd tar su-exec"
  command -v docker >/dev/null 2>&1 || PKGS="$PKGS docker"
  CACHE=--no-cache; [ -d /etc/apk/cache ] && CACHE=
  retry apk add $CACHE -q $PKGS
elif command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  retry apt-get update -qq && retry apt-get install -y -qq curl ca-certificates zstd tar xz-utils iptables iproute2 >/dev/null
  command -v docker >/dev/null 2>&1 || retry apt-get install -y -qq docker.io >/dev/null
  if ! node_ok; then
    say "Node $NODE"
    fetch "https://nodejs.org/dist/v$NODE/node-v$NODE-linux-$NARCH.tar.xz" "$TMP/node.tar.xz"
    check sha256sum "$NODE_SHA256" "$TMP/node.tar.xz"
    tar -xJf "$TMP/node.tar.xz" -C /usr/local --strip-components=1 --no-same-owner
  fi
else
  die "needs apt (Debian, Ubuntu) or apk (Alpine)"
fi
node_ok || die "OpenHut needs Node 22.18 or newer (found $(node -v 2>/dev/null || echo none))"

say "gVisor $GVISOR"
fetch "https://storage.googleapis.com/gvisor/releases/release/$GVISOR/$ARCH/gvisor.tar.zstd" "$TMP/gvisor.tar.zstd"
check sha512sum "$GVISOR_SHA512" "$TMP/gvisor.tar.zstd"
tar --zstd -xf "$TMP/gvisor.tar.zstd" -C /usr/local/bin --no-same-owner
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || echo '{}' > /etc/docker/daemon.json
node -e 'const f="/etc/docker/daemon.json",fs=require("fs"),j=JSON.parse(fs.readFileSync(f,"utf8"));j.runtimes={...j.runtimes,runsc:{path:"/usr/local/bin/runsc"}};fs.writeFileSync(f,JSON.stringify(j,null,2))'
if docker info >/dev/null 2>&1; then
  pkill -HUP -x dockerd || true
  i=0; until docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"runsc"'; do
    i=$((i+1)); [ $i -gt 15 ] && die "Docker didn't load the runsc runtime; restart Docker and run this again"; sleep 1; done
fi

say "OpenHut"
fetch "$OPENHUT_TGZ" "$TMP/openhut.tgz"
check sha256sum "$OPENHUT_SHA256" "$TMP/openhut.tgz"
rm -rf "$PREFIX.new" && mkdir -p "$PREFIX.new/bin" && tar -xzf "$TMP/openhut.tgz" -C "$PREFIX.new" --no-same-owner
(cd "$PREFIX.new" && retry npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)
say "Claude Code $CLAUDE"
CACHED="/var/cache/openhut/claude-$CLAUDE-linux-$NARCH"
if ! printf '%s  %s\n' "$CLAUDE_SHA256" "$CACHED" | sha256sum -c - >/dev/null 2>&1; then
  mkdir -p /var/cache/openhut
  fetch "https://downloads.claude.ai/claude-code-releases/$CLAUDE/linux-$NARCH/claude" "$TMP/claude"
  check sha256sum "$CLAUDE_SHA256" "$TMP/claude"
  mv "$TMP/claude" "$CACHED"
fi
cp "$CACHED" "$PREFIX.new/bin/claude" && chmod 0755 "$PREFIX.new/bin/claude"
say "agent-browser $AGENT_BROWSER"
CACHED="/var/cache/openhut/agent-browser-$AGENT_BROWSER-linux-$NARCH.tgz"
if ! printf '%s  %s\n' "$AGENT_BROWSER_SHA512" "$CACHED" | sha512sum -c - >/dev/null 2>&1; then
  mkdir -p /var/cache/openhut
  fetch "https://registry.npmjs.org/@agent-browser/cli-linux-$NARCH-gnu/-/cli-linux-$NARCH-gnu-$AGENT_BROWSER.tgz" "$TMP/agent-browser.tgz"
  check sha512sum "$AGENT_BROWSER_SHA512" "$TMP/agent-browser.tgz"
  mv "$TMP/agent-browser.tgz" "$CACHED"
fi
tar -xzf "$CACHED" -C "$TMP" package/bin/agent-browser && cp "$TMP/package/bin/agent-browser" "$PREFIX.new/bin/agent-browser" && chmod 0755 "$PREFIX.new/bin/agent-browser"
chown -R root:root "$PREFIX.new" && chmod -R go-w "$PREFIX.new"
if [ -d /data/app ] && [ -d "$PREFIX" ]; then
  say "Saving a copy of the data in case the new release has to be undone"
  stop_app
  rm -rf /data/app.before-update
  cp -a /data/app /data/app.before-update || { rm -rf /data/app.before-update; start '' || true; die "couldn't keep a copy of the data (is the disk full?), so nothing changed"; }
  cp /etc/openhut/env /data/app.before-update.env 2>/dev/null || rm -f /data/app.before-update.env
fi
rm -rf "$PREFIX.old"; [ ! -d "$PREFIX" ] || mv "$PREFIX" "$PREFIX.old"; mv "$PREFIX.new" "$PREFIX"; SWAPPED=1
id openhut >/dev/null 2>&1 || { addgroup -S openhut >/dev/null 2>&1 && adduser -S -D -G openhut openhut >/dev/null 2>&1; } || useradd --system --user-group --no-create-home openhut

say "Starting"
write_env
start || echo "  Something didn't start cleanly; waiting for OpenHut to answer anyway."
[ -d /run/systemd/system ] || [ -n "${OPENHUT_CONTAINER:-}" ] || echo "  No systemd here. After a reboot, run $PREFIX/install/host-start.sh (agents stay stopped until then)."
TRIES=600
[ -d "$PREFIX.old" ] && cmp -s "$PREFIX.old/install/agent-image" "$PREFIX/install/agent-image" && TRIES=100
printf 'Waiting for OpenHut'
if ! up "$TRIES"; then
  printf '\n'
  [ -d "$PREFIX.old" ] || die "not up after 30 min; see /var/log/openhut"
  say "The new release didn't come up. Going back to the previous one"
  go_back
  up 600 || die "the new release didn't come up, and the previous one didn't come back either; see /var/log/openhut"
  printf '\n'
  die "the new release didn't come up, so the previous one is running again"
fi
rm -rf "$PREFIX.old"
printf '\n'
! tailnet || [ -f /.dockerenv ] || serve_tailnet
docker image inspect "${AGENT_IMAGE:-$(cat "$PREFIX/install/agent-image")}" >/dev/null 2>&1 || echo "The agent image (about 1 GB) is still downloading; agents start once it's done."
echo "OpenHut sends anonymous usage events to openhut.dev. Turn it off in Settings > General. Details: https://openhut.dev/docs/security"
running
