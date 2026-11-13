#!/bin/sh
set -eu
JAKEBOX_URL="${JAKEBOX_URL:-https://get.jakebox.dev}"
JAKEBOX_SHA256="@JAKEBOX_SHA256@"
GVISOR=20261109.0
NODE=22.23.5
CLAUDE=2.1.311
PREFIX=/opt/jakebox
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'jakebox: %s\n' "$*" >&2; exit 1; }
retry() { n=0; until timeout 600 "$@"; do n=$((n+1)); [ $n -ge 4 ] && return 1; echo "  retrying: $1 ($n)"; sleep 5; done; }
fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 4 --retry-all-errors --connect-timeout 15 -m 900 "$1" -o "$2"; else retry wget -qO "$2" -T 30 "$1"; fi; }
check() { printf '%s  %s\n' "$2" "$3" | "$1" -c - >/dev/null || die "checksum mismatch: $3"; }
node_ok() { node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }

[ "$(id -u)" = 0 ] || die "run as root:  curl -fsSL $JAKEBOX_URL | sudo sh"
[ "$(uname -s)" = Linux ] || die "JakeBox runs on Linux"
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
node_ok || die "JakeBox needs Node 22.18 or newer (found $(node -v 2>/dev/null || echo none))"

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

say "JakeBox"
fetch "$JAKEBOX_URL/jakebox.tgz" "$TMP/jakebox.tgz"
check sha256sum "$JAKEBOX_SHA256" "$TMP/jakebox.tgz"
rm -rf "$PREFIX.new" && mkdir -p "$PREFIX.new/bin" && tar -xzf "$TMP/jakebox.tgz" -C "$PREFIX.new" --no-same-owner
(cd "$PREFIX.new" && retry npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)
say "Claude Code $CLAUDE"
CACHED="/var/cache/jakebox/claude-$CLAUDE-linux-$NARCH"
if ! printf '%s  %s\n' "$CLAUDE_SHA256" "$CACHED" | sha256sum -c - >/dev/null 2>&1; then
  mkdir -p /var/cache/jakebox
  fetch "https://downloads.claude.ai/claude-code-releases/$CLAUDE/linux-$NARCH/claude" "$TMP/claude"
  check sha256sum "$CLAUDE_SHA256" "$TMP/claude"
  mv "$TMP/claude" "$CACHED"
fi
cp "$CACHED" "$PREFIX.new/bin/claude" && chmod 0755 "$PREFIX.new/bin/claude"
chown -R root:root "$PREFIX.new" && chmod -R go-w "$PREFIX.new"
rm -rf "$PREFIX.old"; [ ! -d "$PREFIX" ] || mv "$PREFIX" "$PREFIX.old"; mv "$PREFIX.new" "$PREFIX"; rm -rf "$PREFIX.old"
id jakebox >/dev/null 2>&1 || { addgroup -S jakebox 2>/dev/null && adduser -S -D -G jakebox jakebox 2>/dev/null; } || useradd --system --user-group --no-create-home jakebox

mkdir -p /etc/jakebox && touch /etc/jakebox/env && chmod 0600 /etc/jakebox/env
IMAGE_OVERRIDE="${AGENT_IMAGE:-}"
. /etc/jakebox/env
IMAGE_OVERRIDE="${IMAGE_OVERRIDE:-${AGENT_IMAGE:-}}"
umask 077
{
  echo "RESOLVER=${RESOLVER:-1.1.1.1}"
  [ -z "$IMAGE_OVERRIDE" ] || echo "AGENT_IMAGE=$IMAGE_OVERRIDE"
  echo "JAKEBOX_MODEL=${JAKEBOX_MODEL:-claude}"
  echo "SETUP_CODE=${SETUP_CODE:-$(od -An -N9 -tx1 /dev/urandom | tr -d ' \n')}"
} > /etc/jakebox/env.new
mv /etc/jakebox/env.new /etc/jakebox/env
. /etc/jakebox/env
umask 022

say "Starting"
STARTED_AFTER=$(date +%s)
if [ -d /run/systemd/system ]; then
  cp "$PREFIX"/install/systemd/*.service /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable -q jakebox-firewall.service docker.service jakebox-agentd.service jakebox.service
  systemctl restart jakebox-firewall.service docker.service jakebox-agentd.service jakebox.service
else
  nohup "$PREFIX/install/host-start.sh" >> /var/log/jakebox-boot.log 2>&1 &
  echo "  No systemd here. After a reboot, run $PREFIX/install/host-start.sh (agents stay stopped until then)."
fi

printf 'Waiting for JakeBox (the first start pulls the ~3 GB agent image)'
fresh() { h=$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null) && echo "$h" | grep -q '"ok":true' &&
  [ "$(echo "$h" | sed -n 's/.*"started":\([0-9]*\).*/\1/p')" -ge "$STARTED_AFTER" ]; }
i=0; until fresh; do
  i=$((i+1)); [ $i -gt 600 ] && die "not up after 30 min; see /var/log/jakebox"; printf .; sleep 3; done
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
printf '\nJakeBox is running. Create your account (the first one is the owner; after that people join by invite):\n  http://%s:8787/setup?code=%s\n' "${IP:-this-server}" "$SETUP_CODE"
echo "Keep port 8787 private (Tailscale or an SSH tunnel) or put TLS in front of it: sign-in travels over plain HTTP."
