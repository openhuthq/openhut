#!/bin/sh
# openhut-updater. R7: it lives in the base image (/usr/local/lib/openhut-updater), never in the per-release layer it replaces, and
# runs an install.sh only when verify-installer.mjs finds its hash in a signed release.json whose Rekor entry is MIN_AGE_SECONDS old (SEC6; 0 for now).
set -u
cd /tmp
HERE=$(cd "$(dirname "$0")/.." && pwd)
REQUEST=/data/update.request LOG=/data/update.log EXIT=/data/update.log.exit
RELEASE=${OPENHUT_RELEASE:-https://github.com/openhuthq/openhut/releases/latest/download}
signed() { for ext in '' .sig .rekor; do curl -fsSL --retry 3 "$RELEASE/release.json$ext" -o "$1/release.json$ext" || return 1; done; }
apply() { # <sha256 the admin page checked> <app version>
  rm -f "$EXIT"; d=$(mktemp -d)
  if ! curl -fsSL --retry 3 "$OPENHUT_URL" -o "$d/install.sh"; then echo "openhut: couldn't download the release from $OPENHUT_URL"; code=2
  elif ! printf '%s  %s\n' "$1" "$d/install.sh" | sha256sum -c - >/dev/null 2>&1; then echo "openhut: a newer release came out after this update was checked. Check for updates again."; code=3
  elif ! signed "$d"; then echo "openhut: couldn't download the signed release from $RELEASE, so nothing changed"; code=2
  elif ! node "$HERE/install/verify-installer.mjs" "$d/install.sh" "$d"; then code=4
  else OPENHUT_SHA256=$1 OPENHUT_APP_VERSION=$2 OPENHUT_UPDATER=1 sh "$d/install.sh"; code=$?; fi
  rm -rf "$d"; echo "$code" > "$EXIT"
}
exec 9>/data/install.lock
if flock -n 9 && docker container inspect openhut-previous >/dev/null 2>&1; then
  echo "openhut: an update didn't finish, so the previous release is back"
  docker rm -f openhut >/dev/null 2>&1
  [ ! -d /data/app.before-update ] || { rm -rf /data/app && cp -a /data/app.before-update /data/app; }
  [ ! -f /data/app.before-update.env ] || cp /data/app.before-update.env /data/etc/env
  docker rename openhut-previous openhut && docker start openhut >/dev/null
fi
flock -u 9
while :; do
  if [ -f "$REQUEST" ] && flock -n 9; then
    sha= version=
    read -r sha version < "$REQUEST" || true
    rm -f "$REQUEST"
    case "$sha:$version" in
      *[!0-9a-z.:-]*) echo "openhut: ignored an update request that isn't a sha256 and a version" ;;
      ????????????????????????????????????????????????????????????????:*) apply "$sha" "$version" > "$LOG" 2>&1 ;;
      *) echo "openhut: ignored an update request that isn't a sha256 and a version" ;;
    esac
    flock -u 9
  fi
  sleep 2
done
