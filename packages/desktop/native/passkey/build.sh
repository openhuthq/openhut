#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
app="$here/build/OpenHut Passkey.app"
profile=${PASSKEY_PROFILE-$here/OpenHut_Passkey.provisionprofile}
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
swiftc -O -target arm64-apple-macos14.0 "$here/Passkey.swift" -o "$app/Contents/MacOS/passkey"
cp "$here/Info.plist" "$app/Contents/Info.plist"
sign() {
  codesign --force --options runtime --timestamp ${PASSKEY_KEYCHAIN:+--keychain "$PASSKEY_KEYCHAIN"} --sign "${PASSKEY_IDENTITY:-Developer ID Application}" "$@" "$app"
}
if [ -n "$profile" ] && [ -f "$profile" ]; then
  cp "$profile" "$app/Contents/embedded.provisionprofile"
  sign --entitlements "$here/passkey.entitlements"
elif [ -n "${PASSKEY_SIGN:-}" ]; then
  sign
fi
echo "$app"
