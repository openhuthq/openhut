#!/bin/sh
set -u
cd /tmp || exit 1
REQUEST=/data/update.request LOG=/data/update.log EXIT=/data/update.log.exit
apply() { # <sha256 the runtime checked> <app version>
  rm -f "$EXIT"; d=$(mktemp -d)
  if ! curl -fsSL --retry 3 "$OPENHUT_URL" -o "$d/install.sh"; then echo "openhut: couldn't download the new version from $OPENHUT_URL"; code=2
  elif ! printf '%s  %s\n' "$1" "$d/install.sh" | sha256sum -c - >/dev/null 2>&1; then echo "openhut: a newer version came out after this update was checked. Check for updates again."; code=3
  else OPENHUT_APP_VERSION=$2 OPENHUT_UPDATER=1 sh "$d/install.sh"; code=$?; fi
  rm -rf "$d"; echo "$code" > "$EXIT"
}

old=$(docker container inspect -f '{{.Image}}' openhut-updater-old 2>/dev/null) && { docker rm -f openhut-updater-old >/dev/null; docker image rm "$old" >/dev/null 2>&1; }
exec 9>/data/install.lock
if flock -n 9 && docker container inspect openhut-previous >/dev/null 2>&1; then
  echo "openhut: an update didn't finish, so the previous version is back"
  docker rm -f openhut >/dev/null 2>&1
  docker run --rm -v openhut-data:/data --entrypoint sh "$(docker container inspect -f '{{.Image}}' openhut-previous)" \
    -c '[ ! -d /data/app.before-update ] || { rm -rf /data/app && cp -a /data/app.before-update /data/app; }'
  docker rename openhut-previous openhut && docker start openhut >/dev/null
fi
flock -u 9
while :; do
  if [ -f "$REQUEST" ] && flock -n 9; then
    sha='' version=''
    read -r sha version < "$REQUEST" || true
    rm -f "$REQUEST"
    if printf '%s' "$sha" | grep -Eqx '[0-9a-f]{64}' && printf '%s' "$version" | grep -Eqx '[0-9.]*'; then apply "$sha" "$version" > "$LOG" 2>&1
    else echo "openhut: ignored an update request that isn't a sha256 and a version"; fi
    flock -u 9
  fi
  sleep 2
done
