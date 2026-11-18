#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../release"

if [ -n "${NOTARY_PROFILE:-}" ]; then
  auth=(--keychain-profile "$NOTARY_PROFILE")
else
  p8=$(umask 077 && mktemp "${RUNNER_TEMP:-/tmp}/notary.XXXXXX")
  trap 'rm -f "$p8"' EXIT
  echo "$NOTARY_KEY_P8_BASE64" | base64 --decode > "$p8"
  auth=(--key "$p8" --key-id "$NOTARY_KEY_ID")
  [ -n "${NOTARY_ISSUER_ID:-}" ] && auth+=(--issuer "$NOTARY_ISSUER_ID")
fi

notarize() {
  out=$(xcrun notarytool submit "$1" "${auth[@]}" --wait --timeout 2h 2>&1)
  echo "$out" | tail -2
  echo "$out" | grep -q "status: Accepted" && return 0
  id=$(echo "$out" | sed -n 's/^ *id: //p' | head -1)
  [ -n "$id" ] && xcrun notarytool log "$id" "${auth[@]}" || true
  echo "notarization not accepted for $1" >&2
  return 1
}

staple() {
  for attempt in 1 2 3 4 5 6; do
    xcrun stapler staple "$1" && return 0
    echo "stapling $1 failed (attempt $attempt of 6), trying again in 30 s"
    sleep 30
  done
  return 1
}

app=mac-arm64/OpenHut.app
dmg=OpenHut-arm64.dmg
codesign --verify --deep --strict "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" app.zip
notarize app.zip
rm app.zip
staple "$app"
rm -rf dmg-rebuild
(cd .. && npx electron-builder --mac dmg --arm64 --prepackaged "release/$app" -c.directories.output=release/dmg-rebuild --publish never)
mv "dmg-rebuild/$dmg" "$dmg"
codesign --verify --strict "$dmg"
rm -rf dmg-rebuild
notarize "$dmg"
staple "$dmg"
zip=$(ls OpenHut-*-arm64.zip 2>/dev/null | head -1 || true)
if [ -n "$zip" ]; then rm -f "$zip"; ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"; fi
rm -f ./*.blockmap
[ -z "$zip" ] || node -e "require(require.resolve('app-builder-lib/out/targets/blockmap/blockmap.js', { paths: [process.cwd()] })).buildBlockMap(process.argv[1], 'gzip', process.argv[1] + '.blockmap')" "$zip"
node - <<'JS'
const { createHash } = require('node:crypto')
const { readFileSync, statSync, writeFileSync } = require('node:fs')
const sum = (file) => createHash('sha512').update(readFileSync(file)).digest('base64')
let file = ''
const lines = readFileSync('latest-mac.yml', 'utf8').split('\n').filter((line) => !/^\s*blockMapSize:/.test(line)).map((line) => {
  const named = /^(\s*-?\s*)(url|path): (.+)$/.exec(line)
  if (named) file = named[3].trim()
  if (/^\s*sha512: /.test(line)) return line.replace(/sha512: .*/, `sha512: ${sum(file)}`)
  if (/^\s*size: /.test(line)) return line.replace(/size: .*/, `size: ${statSync(file).size}`)
  return line
})
writeFileSync('latest-mac.yml', lines.join('\n'))
JS
cat latest-mac.yml

spctl -a -vvv -t exec "$app" 2>&1 | tee /dev/stderr | grep -q "source=Notarized Developer ID"
xcrun stapler validate "$dmg"
mnt=$(mktemp -d)
hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$mnt" "$dmg" >/dev/null
inner=0
xcrun stapler validate "$mnt/OpenHut.app" && inner=1
hdiutil detach "$mnt" >/dev/null || hdiutil detach -force "$mnt" >/dev/null
[ "$inner" = 1 ] || { echo "The app inside $dmg has no stapled ticket, so Gatekeeper needs the network to open it once it's copied out." >&2; exit 1; }
q=$(mktemp -d)/quarantined.dmg
cp "$dmg" "$q"
xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;$(uuidgen)" "$q"
spctl -a -vvv -t open --context context:primary-signature "$q" 2>&1 | tee /dev/stderr | grep -q "source=Notarized Developer ID"
echo "Notarized, stapled and accepted by Gatekeeper."
