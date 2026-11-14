#!/bin/sh
set -eu
FASTMONKEY_URL="${FASTMONKEY_URL:-https://fastmonkey.dev}"
FASTMONKEY_SHA256="@FASTMONKEY_SHA256@"
FASTMONKEY_BUILD="@FASTMONKEY_BUILD@"
GVISOR=20261109.0
NODE=22.23.5
CLAUDE=2.1.311
PREFIX=/opt/fastmonkey
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'fastmonkey: %s\n' "$*" >&2; exit 1; }
retry() { n=0; until timeout 600 "$@"; do n=$((n+1)); [ $n -ge 4 ] && return 1; echo "  retrying: $1 ($n)"; sleep 5; done; }
fetch() { curl -fsSL --retry 4 --retry-all-errors --connect-timeout 15 -m 900 "$1" -o "$2"; }
check() { printf '%s  %s\n' "$2" "$3" | "$1" -c - >/dev/null || die "checksum mismatch: $3"; }
node_ok() { node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }

[ "$(uname -s)" = Linux ] || die "Fast Monkey runs only on Linux (Debian, Ubuntu or Alpine; x86_64 or arm64), not $(uname -s). On a Mac or Windows, run this inside a Linux VM or on a Linux server."
[ "$(id -u)" = 0 ] || die "run as root:  curl -fsSL $FASTMONKEY_URL | sudo sh"
if command -v flock >/dev/null 2>&1; then
  exec 9>/run/fastmonkey-install.lock
  flock -n 9 || die "another install or update is already running"
fi
case "$(uname -m)" in
  x86_64)  ARCH=x86_64 NARCH=x64
           CLAUDE_SHA256=86dc1fcc69498159eaf15f446613e847010f9036bfbbdffd4c49350be8489ada
           GVISOR_SHA512=0a0041fd862f4ea3042a9db8d41c742f48a01f909699adc2a0256e46d85e53f97b82b9fd154b3dce636f62b8d557677639f91c77d13f3f875ff9fa535275393c
           NODE_SHA256=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8 ;;
  aarch64) ARCH=aarch64 NARCH=arm64
           CLAUDE_SHA256=2e2496c9a8065df93acb0fca2d341f59a6b8777649b2e025ab8c9bcd5eef61f3
           GVISOR_SHA512=a0b5d911512ef5fe70e833821e653a90c4d06c7027246ee49423f1d2fe2b2a509389a637797248958b90e49a069bb079ecde860efe1871b1d980ec0fe17e18ac
           NODE_SHA256=2babb9eb5264860d540849f4b064a6fbdebcdc323657d9d382ce23d313fd5e09 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

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
node_ok || die "Fast Monkey needs Node 22.18 or newer (found $(node -v 2>/dev/null || echo none))"

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

say "Fast Monkey"
fetch "$FASTMONKEY_URL/fastmonkey.tgz" "$TMP/fastmonkey.tgz"
check sha256sum "$FASTMONKEY_SHA256" "$TMP/fastmonkey.tgz"
rm -rf "$PREFIX.new" && mkdir -p "$PREFIX.new/bin" && tar -xzf "$TMP/fastmonkey.tgz" -C "$PREFIX.new" --no-same-owner
(cd "$PREFIX.new" && retry npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)
say "Claude Code $CLAUDE"
CACHED="/var/cache/fastmonkey/claude-$CLAUDE-linux-$NARCH"
if ! printf '%s  %s\n' "$CLAUDE_SHA256" "$CACHED" | sha256sum -c - >/dev/null 2>&1; then
  mkdir -p /var/cache/fastmonkey
  fetch "https://downloads.claude.ai/claude-code-releases/$CLAUDE/linux-$NARCH/claude" "$TMP/claude"
  check sha256sum "$CLAUDE_SHA256" "$TMP/claude"
  mv "$TMP/claude" "$CACHED"
fi
cp "$CACHED" "$PREFIX.new/bin/claude" && chmod 0755 "$PREFIX.new/bin/claude"
chown -R root:root "$PREFIX.new" && chmod -R go-w "$PREFIX.new"
rm -rf "$PREFIX.old"; [ ! -d "$PREFIX" ] || mv "$PREFIX" "$PREFIX.old"; mv "$PREFIX.new" "$PREFIX"
id fastmonkey >/dev/null 2>&1 || { addgroup -S fastmonkey >/dev/null 2>&1 && adduser -S -D -G fastmonkey fastmonkey >/dev/null 2>&1; } || useradd --system --user-group --no-create-home fastmonkey

mkdir -p /etc/fastmonkey && touch /etc/fastmonkey/env && chmod 0600 /etc/fastmonkey/env
IMAGE_OVERRIDE="${AGENT_IMAGE:-}"
SOURCE_URL="$FASTMONKEY_URL"
. /etc/fastmonkey/env
IMAGE_OVERRIDE="${IMAGE_OVERRIDE:-${AGENT_IMAGE:-}}"
umask 077
{
  echo "RESOLVER=${RESOLVER:-1.1.1.1}"
  [ -z "$IMAGE_OVERRIDE" ] || echo "AGENT_IMAGE=$IMAGE_OVERRIDE"
  echo "FASTMONKEY_MODEL=${FASTMONKEY_MODEL:-claude}"
  echo "SETUP_CODE=${SETUP_CODE:-$(od -An -N9 -tx1 /dev/urandom | tr -d ' \n')}"
  echo "FASTMONKEY_URL=$SOURCE_URL"
} > /etc/fastmonkey/env.new
mv /etc/fastmonkey/env.new /etc/fastmonkey/env
. /etc/fastmonkey/env
umask 022

start() {
  STARTED_AFTER=$(date +%s)
  if [ -d /run/systemd/system ]; then
    cp "$PREFIX"/install/systemd/*.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable -q fastmonkey-firewall.service docker.service fastmonkey-agentd.service fastmonkey.service
    systemctl restart fastmonkey-firewall.service docker.service fastmonkey-agentd.service fastmonkey.service
  else
    nohup "$PREFIX/install/host-start.sh" >> /var/log/fastmonkey-boot.log 2>&1 9>&- &
  fi
}
fresh() { h=$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null) && echo "$h" | grep -q '"ok":true' &&
  [ "$(echo "$h" | sed -n 's/.*"started":\([0-9]*\).*/\1/p')" -ge "$STARTED_AFTER" ]; }
up() { i=0; until fresh; do i=$((i+1)); [ $i -gt "$1" ] && return 1; printf .; sleep 3; done; }

say "Starting"
start
[ -d /run/systemd/system ] || echo "  No systemd here. After a reboot, run $PREFIX/install/host-start.sh (agents stay stopped until then)."
TRIES=600
[ -d "$PREFIX.old" ] && cmp -s "$PREFIX.old/install/agent-image" "$PREFIX/install/agent-image" && TRIES=100
printf 'Waiting for Fast Monkey (the first start pulls the ~3 GB agent image)'
if ! up "$TRIES"; then
  printf '\n'
  [ -d "$PREFIX.old" ] || die "not up after 30 min; see /var/log/fastmonkey"
  say "The new release didn't come up. Going back to the previous one"
  rm -rf "$PREFIX.failed"; mv "$PREFIX" "$PREFIX.failed"; mv "$PREFIX.old" "$PREFIX"
  start
  rm -rf "$PREFIX.failed"
  up 600 || die "the new release didn't come up, and the previous one didn't come back either; see /var/log/fastmonkey"
  printf '\n'
  die "the new release didn't come up, so the previous one is running again"
fi
rm -rf "$PREFIX.old"
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
printf '\nFast Monkey is running. Create your account (the first one is the owner; after that people join by invite):\n  http://%s:8787/setup?code=%s\n' "${IP:-this-server}" "$SETUP_CODE"
echo "Keep port 8787 private (Tailscale or an SSH tunnel) or put TLS in front of it: sign-in travels over plain HTTP."
