#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
app="$here/build/OpenHut Passkey.app"
mkdir -p "$app/Contents/MacOS"
swiftc -O -target arm64-apple-macos14.0 "$here/Passkey.swift" -o "$app/Contents/MacOS/passkey"
cp "$here/Info.plist" "$app/Contents/Info.plist"
if [ -n "${PASSKEY_PROFILE:-}" ]; then
  cp "$PASSKEY_PROFILE" "$app/Contents/embedded.provisionprofile"
  codesign --force --options runtime --timestamp --entitlements "$here/passkey.entitlements" --sign "${PASSKEY_IDENTITY:-Developer ID Application}" "$app"
fi
echo "$app"
