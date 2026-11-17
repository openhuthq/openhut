#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../release"

if [ -n "${NOTARY_PROFILE:-}" ]; then
  auth=(--keychain-profile "$NOTARY_PROFILE")
else
  echo "$NOTARY_KEY_P8_BASE64" | base64 --decode > "${RUNNER_TEMP:-/tmp}/notary.p8"
  auth=(--key "${RUNNER_TEMP:-/tmp}/notary.p8" --key-id "$NOTARY_KEY_ID")
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
notarize "$dmg"
staple "$dmg"
zip=$(ls OpenHut-*-arm64.zip 2>/dev/null | head -1 || true)
if [ -n "$zip" ]; then rm -f "$zip" "$zip.blockmap"; ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"; fi

spctl -a -vvv -t exec "$app" 2>&1 | tee /dev/stderr | grep -q "source=Notarized Developer ID"
xcrun stapler validate "$dmg"
q=$(mktemp -d)/quarantined.dmg
cp "$dmg" "$q"
xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;$(uuidgen)" "$q"
spctl -a -vvv -t open --context context:primary-signature "$q" 2>&1 | tee /dev/stderr | grep -q "source=Notarized Developer ID"
echo "Notarized, stapled and accepted by Gatekeeper."
