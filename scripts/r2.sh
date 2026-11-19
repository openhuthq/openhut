#!/bin/sh
set -eu
BUCKET=${OPENHUT_R2_BUCKET:-openhut-releases}
URL=https://dl.openhut.dev
FOREVER='public, max-age=31536000, immutable'

put() {
  if [ "$(wc -c < "$2")" -gt 300000000 ]; then big "$@"; else
    npx -y wrangler@4.164.0 r2 object put "$BUCKET/$1" --file "$2" --remote --cache-control "$3" --content-type "${4:-application/octet-stream}" >/dev/null
  fi
  echo "r2: $1"
}

big() {
  if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
    auth="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
    verified=$(curl -fsS -H "$auth" https://api.cloudflare.com/client/v4/user/tokens/verify || curl -fsS -H "$auth" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify")
    AWS_ACCESS_KEY_ID=$(printf '%s' "$verified" | sed -n 's/.*"id":"\([0-9a-f]*\)".*/\1/p')
    AWS_SECRET_ACCESS_KEY=$(printf '%s' "$CLOUDFLARE_API_TOKEN" | shasum -a 256 | cut -d' ' -f1)
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  fi
  aws s3 cp "$2" "s3://$BUCKET/$1" --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" --region auto --cache-control "$3" --content-type "${4:-application/octet-stream}" --only-show-errors
}

claude() {
  version=$(sed -n 's/^CLAUDE=//p' install/install.sh)
  tmp=$(mktemp -d)
  for arch in x64 arm64; do
    key=claude/$version/linux-$arch/claude.zst
    if curl -fsI "$URL/$key" >/dev/null; then echo "r2: $key is there"; continue; fi
    machine=$([ "$arch" = arm64 ] && echo aarch64 || echo x86_64)
    want=$(sed -n "/^  $machine)/,/CLAUDE_SHA256=/s/.*CLAUDE_SHA256=//p" install/install.sh)
    curl -fsSL -o "$tmp/claude" "https://downloads.claude.ai/claude-code-releases/$version/linux-$arch/claude"
    [ "$(shasum -a 256 "$tmp/claude" | cut -d' ' -f1)" = "$want" ] || { echo "r2: claude $version linux-$arch doesn't match install.sh's checksum" >&2; exit 1; }
    zstd -q -f -19 --long=27 -T0 "$tmp/claude" -o "$tmp/claude.zst"
    put "$key" "$tmp/claude.zst" "$FOREVER"
  done
  rm -rf "$tmp"
}

release() {
  v=$1 dir=$2
  for file in OpenHut-arm64.dmg "OpenHut-$v-arm64.zip" "OpenHut-$v-arm64.zip.blockmap" OpenHut-x64.AppImage openhut-x64.deb OpenHut-Setup-x64.exe OpenHut-Setup-x64.exe.blockmap; do
    put "v$v/$file" "$dir/$file" "$FOREVER"
  done
  for file in OpenHut-arm64.dmg OpenHut-x64.AppImage openhut-x64.deb OpenHut-Setup-x64.exe; do
    put "latest/$file" "$dir/$file" 'public, max-age=300'
  done
  for feed in latest.yml latest-mac.yml latest-linux.yml; do
    sed -e "s#^\(  *- url: \)#\1v$v/#" -e "s#^path: #path: v$v/#" "$dir/$feed" > "$dir/$feed.r2"
    put "$feed" "$dir/$feed.r2" 'public, max-age=60' text/yaml
  done
}

case "${1:-}" in
  claude) claude ;;
  check) tmp=$(mktemp) && date > "$tmp" && big check/large-uploads "$tmp" 'no-store' text/plain && echo 'r2: large uploads work' ;;
  release) [ $# -eq 3 ] || { echo 'usage: scripts/r2.sh release <version> <folder with the release files>' >&2; exit 2; }; release "$2" "$3" ;;
  *) echo 'usage: scripts/r2.sh claude | check | release <version> <folder>' >&2; exit 2 ;;
esac
