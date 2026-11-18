#!/bin/sh
P=/opt/openhut
[ -d "$P.old" ] || exit 0
if command -v flock >/dev/null 2>&1; then flock -n /run/openhut-install.lock true || exit 0; fi
echo "openhut: an update didn't finish, so the previous release is back"
rm -rf "$P.failed"
[ ! -d "$P" ] || mv "$P" "$P.failed"
mv "$P.old" "$P"
if [ -d /data/app.before-update ]; then rm -rf /data/app && cp -a /data/app.before-update /data/app; fi
rm -rf "$P.failed"
exit 10
