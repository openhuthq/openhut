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


# R3: every release.json CI logs in Rekor is announced at releases/<sha256>.json (with .sig and .rekor). The release monitor
# (private/api/src/releases/release-monitor.ts) alerts on any Rekor entry signed by the release key that isn't announced here.
announce() {
  sha=$(shasum -a 256 "$1/release.json" | cut -d' ' -f1)
  for ext in '' .sig .rekor; do put "releases/$sha.json$ext" "$1/release.json$ext" "$FOREVER" application/json; done
}

# R4: the stable pointer (a release.json Promote signed, or re-signed for halt or rollback) is announced, then served at channels/stable/.
# Packs are content-addressed at packs/<sha512 hex>, so a re-signed pointer needs no copies.
pointer() {
  announce "$1"
  for ext in '' .sig .rekor; do put "channels/stable/release.json$ext" "$1/release.json$ext" 'public, max-age=60' application/json; done
  # R9: the install.sh this pointer names (a signed file, at packs/<sha512 hex>) is served at channels/stable/install.sh;
  # openhut.dev/install.sh redirects to stable's. Servers' updater checks it against channels/stable/release.json again.
  hex=$(node -p "Buffer.from(JSON.parse(require('fs').readFileSync(process.argv[1])).files['install.sh'] ?? '', 'base64').toString('hex')" "$1/release.json")
  [ -n "$hex" ] || return 0
  curl -fsS -o "$1/install.sh.served" "$URL/packs/$hex"
  [ "$(shasum -a 512 "$1/install.sh.served" | cut -d' ' -f1)" = "$hex" ] || { echo "r2: packs/$hex isn't the install.sh $1/release.json names" >&2; exit 1; }
  put "channels/stable/install.sh" "$1/install.sh.served" 'public, max-age=60' 'text/plain; charset=utf-8'
}

packs() {
  for file in "$1"/openhut-*.tgz "$1"/openhut-*.json "$1"/install.sh "$1"/openhut.tgz; do
    [ -f "$file" ] || continue
    key=packs/$(shasum -a 512 "$file" | cut -d' ' -f1)
    if curl -fsI "$URL/$key" >/dev/null; then echo "r2: $key is there"; else put "$key" "$file" "$FOREVER"; fi
  done
}

case "${1:-}" in
  claude) claude ;;
  check) tmp=$(mktemp) && date > "$tmp" && big check/large-uploads "$tmp" 'no-store' text/plain && echo 'r2: large uploads work' ;;
  pointer) [ $# -eq 2 ] || { echo 'usage: scripts/r2.sh pointer <folder with release.json, .sig and .rekor>' >&2; exit 2; }; pointer "$2" ;;
  packs) [ $# -eq 2 ] || { echo 'usage: scripts/r2.sh packs <folder with openhut-*.tgz and .json>' >&2; exit 2; }; packs "$2" ;;
  *) echo 'usage: scripts/r2.sh claude | check | pointer <folder> | packs <folder>' >&2; exit 2 ;;
esac
