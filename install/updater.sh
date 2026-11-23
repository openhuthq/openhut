#!/bin/sh
set -u
cd /tmp
REQUEST=/data/update.request
SCRIPT=$(node --input-type=module -e "import { UPDATE_SCRIPT } from '/opt/openhut/packages/runtime/src/agentd/update.ts'; process.stdout.write(UPDATE_SCRIPT)")
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
      ????????????????????????????????????????????????????????????????:*)
        OPENHUT_SHA256=$sha OPENHUT_APP_VERSION=$version OPENHUT_UPDATER=1 LOG=/data/update.log EXIT=/data/update.log.exit sh -c "$SCRIPT" ;;
      *) echo "openhut: ignored an update request that isn't a sha256 and a version" ;;
    esac
    flock -u 9
  fi
  sleep 2
done
