#!/bin/sh
# Web only (owner, 2026-11-25): the desktop app, the phone app, passkeys and the recovery kit are gone; restore them from the tag
# archive/desktop-and-e2e-2026-11-25. This fails if a reference comes back.
hits=$(git grep -I -i -l -E 'electron|passkey|touch ?id|recovery kit|@capacitor|packages/(desktop|phone)|openhut://|on your mac|open openhut' -- . ':!package-lock.json' ':!scripts/web-only-check.sh' ':!private')
[ -z "$hits" ] && exit 0
echo "Desktop, phone or end-to-end encryption references are back (web only, scripts/web-only-check.sh):"
echo "$hits"
exit 1
