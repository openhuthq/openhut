#!/bin/sh
set -eu
IMAGE="${OPENHUT_IMAGE:-@OPENHUT_IMAGE@}"
RUNTIME="${RUNTIME_IMAGE:-@OPENHUT_RUNTIME_IMAGE@}"
OPENHUT_BUILD="@OPENHUT_BUILD@"
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'openhut: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "OpenHut runs on a Linux server with Docker, not $(uname -s)"
[ "${IMAGE#@}${RUNTIME#@}" = "$IMAGE$RUNTIME" ] || die "this installer has no OpenHut image pinned. Download it again from openhut.dev."
SUDO=; [ "$(id -u)" = 0 ] || SUDO=sudo
if ! command -v docker >/dev/null 2>&1; then
  say "Docker"
  if command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -qq && $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io >/dev/null
  elif command -v apk >/dev/null 2>&1; then $SUDO apk add -q docker && $SUDO rc-update add docker default >/dev/null && $SUDO service docker start >/dev/null
  else die "install Docker, then run this again"; fi
fi
D=docker; docker info >/dev/null 2>&1 || D="$SUDO docker"
i=0; until $D info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 30 ] && die "Docker isn't running. Start it, then run this again."; sleep 1; done

exists() { $D container inspect "$1" >/dev/null 2>&1; }
pull() { n=0; until $D pull -q "$1" >/dev/null; do n=$((n+1)); [ $n -ge 4 ] && die "couldn't download $1"; echo "  retrying the download ($n)"; sleep 5; done; }

if [ "${1:-}" = join ]; then
  rdata() { $D run --rm -v openhut-runtime-data:/data --entrypoint sh "$RUNTIME" -c "$@"; }
  NAME="${OPENHUT_NAME:-$(uname -n | tr -cd 'A-Za-z0-9._-' | cut -c1-64)}"
  NET="${OPENHUT_NETWORK:-$($D container inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' openhut-runtime 2>/dev/null || true)}"
  case "$NET" in bridge|default) NET= ;; esac
  say "OpenHut runtime ($RUNTIME)"
  pull "$RUNTIME"
  if [ $# -ge 3 ]; then
    printf '%s' "$2" | grep -Eqx 'https?://[A-Za-z0-9.-]+(:[0-9]+)?' || die "give the main install's address and code: sh -s -- join https://agents.example.com ohj_..."
    printf '%s' "$3" | grep -Eqx 'ohj_[A-Za-z0-9_-]{20,100}' || die "that code doesn't look right. Copy the whole command from Settings › Computers again."
    rdata 'umask 077; printf "%s %s\n" "$1" "$2" > /data/link' sh "$2" "$3"
  elif ! rdata '[ -s /data/link ]'; then die "join needs the main install's address and a code from Settings › Computers › Add a computer"
  elif exists openhut-runtime && [ "$($D container inspect -f '{{.Image}}' openhut-runtime)" = "$($D image inspect -f '{{.Id}}' "$RUNTIME")" ]; then echo "The OpenHut runtime is already running this release."; exit 0; fi
  linked() { i=0; until $D exec openhut-runtime test -f /run/openhut-linked 2>/dev/null; do i=$((i+1)); [ $i -gt 100 ] && return 1; printf .; sleep 3; done; }
  PREVIOUS=
  if exists openhut-runtime; then
    $D stop -t 10 openhut-runtime >/dev/null
    $D rm -f openhut-runtime-previous >/dev/null 2>&1 || true
    $D rename openhut-runtime openhut-runtime-previous
    PREVIOUS=1
  fi
  undo() { $D rm -f openhut-runtime >/dev/null 2>&1 || true; $D rename openhut-runtime-previous openhut-runtime && $D start openhut-runtime >/dev/null; }
  $D run -d --name openhut-runtime --hostname "$NAME" --restart unless-stopped --privileged --read-only --tmpfs /run:size=256m --tmpfs /tmp:size=1g \
    -v openhut-runtime:/var/lib/docker -v openhut-runtime-data:/data -v /var/run/docker.sock:/host/docker.sock ${NET:+--network "$NET"} \
    -e "OPENHUT_RUNTIME_IMAGE=$RUNTIME" -e "OPENHUT_NAME=$NAME" ${RESOLVER:+-e "RESOLVER=$RESOLVER"} --log-opt max-size=10m --log-opt max-file=3 "$RUNTIME" >/dev/null ||
    { [ -z "$PREVIOUS" ] || undo; die "couldn't start the OpenHut runtime container"; }
  printf 'Connecting to the main install'
  if ! linked; then
    printf '\n'
    [ -n "$PREVIOUS" ] || die "the runtime didn't connect to the main install in 5 minutes; see docker logs openhut-runtime and check that this machine can reach its address"
    undo
    die "the new version didn't connect, so this computer went back to the previous one"
  fi
  printf '\n'
  if [ -n "$PREVIOUS" ]; then OLD=$($D container inspect -f '{{.Image}}' openhut-runtime-previous); $D rm -f openhut-runtime-previous >/dev/null; $D image rm "$OLD" >/dev/null 2>&1 || true; fi
  echo "This computer runs agents for $(rdata 'cut -d" " -f1 /data/link'). Manage it in Settings › Computers there."
  exit 0
fi
envof() { $D container inspect -f '{{range .Config.Env}}{{println .}}{{end}}' openhut 2>/dev/null | sed -n "s/^$1=//p"; }
updater() {
  [ "$($D container inspect -f '{{.Config.Image}}' openhut-updater 2>/dev/null || true)" != "$IMAGE" ] || return 0
  $D rm -f openhut-updater-old >/dev/null 2>&1 || true
  ! exists openhut-updater || $D rename openhut-updater openhut-updater-old
  $D run -d --name openhut-updater --restart unless-stopped --read-only --tmpfs /tmp:size=64m \
    --cap-drop ALL --security-opt no-new-privileges --security-opt label=disable \
    -v /var/run/docker.sock:/var/run/docker.sock -v openhut-data:/data -e "OPENHUT_URL=$URL" \
    --log-opt max-size=1m --log-opt max-file=2 --entrypoint /usr/local/lib/openhut-updater.sh "$IMAGE" >/dev/null
}
NAME="${OPENHUT_NAME:-$(envof OPENHUT_NAME)}"; NAME="${NAME:-$(uname -n | tr -cd 'A-Za-z0-9._-' | cut -c1-64)}"
URL="${OPENHUT_URL:-$(envof OPENHUT_URL)}"; URL="${URL:-https://openhut.dev}"
MODEL="${OPENHUT_MODEL:-$(envof OPENHUT_MODEL)}" RESOLVER="${RESOLVER:-$(envof RESOLVER)}"

say "OpenHut $OPENHUT_BUILD ($IMAGE)"
pull "$IMAGE"
if exists openhut && [ "$($D container inspect -f '{{.Image}}' openhut)" = "$($D image inspect -f '{{.Id}}' "$IMAGE")" ]; then
  updater
  echo "OpenHut is already running this release."
  exit 0
fi

data() { $D run --rm -v openhut-data:/data --entrypoint sh "$IMAGE" -c "$1"; }
start() {
  $D network inspect openhut >/dev/null 2>&1 || $D network create openhut >/dev/null
  $D run -d --name openhut --hostname openhut --network openhut --restart unless-stopped --read-only --tmpfs /run:size=64m --tmpfs /tmp:size=1g \
    --sysctl net.ipv4.ip_unprivileged_port_start=80 -v /var/run/docker.sock:/var/run/docker.sock -v openhut-data:/data \
    -p 80:80 -p 443:443 -p 127.0.0.1:8787:8787 --log-opt max-size=10m --log-opt max-file=3 \
    -e "OPENHUT_NAME=$NAME" -e "OPENHUT_URL=$URL" ${MODEL:+-e "OPENHUT_MODEL=$MODEL"} ${RESOLVER:+-e "RESOLVER=$RESOLVER"} \
    "$IMAGE" >/dev/null
}
up() { i=0; until $D exec openhut curl -fsS http://127.0.0.1:8787/health 2>/dev/null | grep -q '"ok":true'; do i=$((i+1)); [ $i -gt 200 ] && return 1; printf .; sleep 3; done; }

PREVIOUS='' FROM=''
if exists openhut; then
  FROM=$($D exec openhut cat /opt/openhut/BUILD 2>/dev/null || true)
  say "Saving a copy of the data in case the new release has to be undone"
  $D stop -t 10 openhut >/dev/null
  data 'rm -rf /data/app.before-update; [ ! -d /data/app ] || cp -a /data/app /data/app.before-update' || { $D start openhut >/dev/null; die "couldn't keep a copy of the data (is the disk full?), so nothing changed"; }
  $D rm -f openhut-previous >/dev/null 2>&1 || true
  $D rename openhut openhut-previous
  PREVIOUS=1
fi
say "Starting"
undo() {
  $D rm -f openhut >/dev/null 2>&1 || true
  data '[ ! -d /data/app.before-update ] || { rm -rf /data/app && cp -a /data/app.before-update /data/app; }'
  $D rename openhut-previous openhut && $D start openhut >/dev/null
}
start || { [ -z "$PREVIOUS" ] || undo; die "couldn't start the OpenHut container"; }
printf 'Waiting for OpenHut'
if ! up; then
  printf '\n'
  [ -n "$PREVIOUS" ] || die "not up after 10 minutes; see docker logs openhut"
  say "The new release didn't come up. Going back to the previous one"
  undo
  up || die "the new release didn't come up, and the previous one didn't come back either; see docker logs openhut"
  printf '\n'
  die "the new version didn't start, so OpenHut went back to ${FROM:-the previous one}"
fi
printf '\n'
if [ -n "$PREVIOUS" ]; then
  OLD=$($D container inspect -f '{{.Image}}' openhut-previous)
  $D rm -f openhut-previous >/dev/null
  $D image rm "$OLD" >/dev/null 2>&1 || true
fi
[ -z "${OPENHUT_UPDATER:-}" ] || echo 0 > /data/update.log.exit
updater
echo "OpenHut is running."
ADDRESS=$($D exec openhut openhut address 2>/dev/null || true)
case "$ADDRESS" in
  https://*) printf '\n  Open %s\n\n' "$ADDRESS" ;;
  *) printf '\n  Open http://%s and create your account. The first person to open it becomes the owner.\n' "$(hostname -I 2>/dev/null | awk '{print $1}')"
     printf '  You set the HTTPS address there; point its DNS at this server first. OpenHut gets the certificate itself (ports 80 and 443).\n\n' ;;
esac
