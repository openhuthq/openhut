#!/bin/sh
set -eu
KEY="${1:?image-smoke.sh <app key> (the key whose sha256 the runtime was installed with)}"
D="${DOCKER:-docker}"
rt() { $D exec openhut "$@"; }
api() { rt curl -fsS -H "authorization: Bearer $KEY" -H 'content-type: application/json' "$@"; }
fail() { echo "smoke: $*" >&2; $D exec openhut sh -c 'tail -n 40 /var/log/openhut/agentd.log /var/log/openhut/app.log' >&2 || true; exit 1; }
wait_for() { i=0; until eval "$2" >/dev/null 2>&1; do i=$((i+1)); [ "$i" -gt "$1" ] && return 1; sleep 3; done; }

wait_for 100 'rt curl -fsS http://127.0.0.1:8787/health' || fail "no /health"
# The Claude sign-in runs `claude setup-token` under script(1) for a terminal (seat-sign-in.ts); run that same command, without the app's database, and it must hand back a claude.ai link.
rt sh -c 'command -v script' >/dev/null || fail "no script(1) in the image, so the Claude sign-in can't start"
link=$(rt sh -c 'd=$(mktemp -d); cd "$d"; HOME=$d CLAUDE_CONFIG_DIR=$d BROWSER=/bin/true TERM=xterm-256color timeout 30 script -qfec "stty cols 4000 rows 60; exec $OPENHUT_CLAUDE setup-token" /dev/null </dev/null | tr "\033\007" "\n\n" | grep -o "https://claude\.[a-z]*/[^ ]*oauth/authorize?[^ ]*" | head -n 1; rm -rf "$d"')
case "$link" in https://claude.ai/*|https://claude.com/*) echo "smoke: the Claude sign-in starts at ${link%%\?*}" ;; *) fail "the Claude sign-in gave no claude.ai link: $link" ;; esac
if ! api http://127.0.0.1:8787/api/cloud | grep -q '"status":"on"'; then
  url=$(api -X POST http://127.0.0.1:8787/api/cloud/sessions -d '{}' | sed -n 's/.*"authorizationUrl":"\([^"]*\)".*/\1/p')
  link=$(curl -fsS "$url" | grep -o 'href="[^"]*">mo@example.com<' | sed 's/^href="//; s/">mo@example.com<$//; s/&amp;/\&/g')
  back=$(curl -s -o /dev/null -D - "$link" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r')
  back=$(node -e 'const u = new URL(process.argv[1]); console.log(u.searchParams.get("to") ?? u.href)' "$back")
  rt curl -fsS -o /dev/null "$back" || fail "sign in to the dev cloud at $url"
  wait_for 40 "api http://127.0.0.1:8787/api/cloud | grep -q '\"status\":\"on\"'" || fail "the runtime didn't sign in"
  echo "smoke: signed in as mo@example.com"
fi
# A device joins the server: a join code from it, signIn through openhutCloud, a knock it approves, then /api through the relay's tunnel.
KEY="$KEY" CLOUD="${CLOUD:-http://127.0.0.1:8793}" node --input-type=module <<'EOF' || fail "a device joining the server"
const root = `file://${process.cwd()}/packages/common/src/`
const { openhutCloud } = await import(`${root}cloud/openhut-cloud.ts`)
const { webKey } = await import(`${root}tunnel/index.ts`)
const { toBase64 } = await import(`${root}vault/public.ts`)
const { execFileSync } = await import('node:child_process')
const api = (method, path, body) => JSON.parse(execFileSync('docker', ['exec', 'openhut', 'curl', '-fsS', '-X', method, '-H', `authorization: Bearer ${process.env.KEY}`,
  '-H', 'content-type: application/json', ...method === 'GET' ? [] : ['-d', JSON.stringify(body ?? {})], `http://127.0.0.1:8787${path}`]).toString() || '{}')
const until = async (what, read) => { for (let i = 0; i < 60; i++, await new Promise((r) => setTimeout(r, 1000))) { const v = await read().catch(() => undefined); if (v) return v } throw new Error(`timed out: ${what}`) }
const pair = (alg, use) => crypto.subtle.generateKey(alg, false, use)
const signing = await pair('Ed25519', ['sign', 'verify']), box = await pair('X25519', ['deriveBits'])
const raw = async (k) => new Uint8Array(await crypto.subtle.exportKey('raw', k))
const id = toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(box.publicKey)]))
const kv = new Map()
const cloud = openhutCloud.device({ url: process.env.CLOUD, store: { get: async (k) => kv.get(k), set: async (k, v) => void kv.set(k, v) },
  key: { id: async () => id, sign: async (b) => new Uint8Array(await crypto.subtle.sign('Ed25519', signing.privateKey, b)), noise: () => webKey(box) } })
const { code } = api('POST', '/api/cloud/join-codes')
const me = await cloud.signIn({ joinCode: code })
const team = me.home
const knock = cloud.knock({ team, nonce: toBase64(crypto.getRandomValues(new Uint8Array(32))) })
await knock.ask({ name: 'Smoke device', os: 'linux' })
const at = `/api/cloud/workspaces/${team}/requests/${encodeURIComponent(id)}`
await until('the server to see the knock', async () => api('POST', `${at}/reviews`))
await knock.reveal()
const faces = await until('the faces on the server', async () => api('GET', '/api/cloud').workspaces.find((w) => w.id === team)?.requests.find((r) => r.device === id)?.faces)
api('POST', `${at}/approvals`, { faces })
await until('the approval', async () => (await knock.state()).step === 'approved')
const tunnel = await cloud.open({ team, timeout: 30_000 })
const res = await tunnel.fetch('/api/agents')
if (res.status !== 200) throw new Error(`/api/agents through the tunnel answered ${res.status}`)
console.log(`smoke: a device signed in with a join code as ${me.email}, was let in, and read /api/agents through the relay`)
process.exit(0)
EOF
i=0; until agent=$(api -X POST http://127.0.0.1:8787/api/agents -d '{"name":"Smoke","instructions":"# Smoke\nYou echo."}' 2>/dev/null); do
  i=$((i+1)); [ "$i" -gt 20 ] && fail "create an agent"; sleep 3
done
id=$(printf '%s' "$agent" | sed -n 's/.*"id":"\(ag_[a-z0-9]*\)".*/\1/p')
[ -n "$id" ] || fail "no agent id in $agent"
echo "smoke: agent $id"
api -X PATCH "http://127.0.0.1:8787/api/agents/$id" -d '{"wanted":"running"}' >/dev/null || fail "start the agent"
wait_for 300 "[ \"\$(rt docker inspect -f '{{.State.Running}}' ag-$id)\" = true ]" || fail "ag-$id never ran"
runtime=$(rt docker inspect -f '{{.HostConfig.Runtime}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.Config.User}}' "ag-$id")
echo "smoke: ag-$id runs with runtime, read-only, cap-drop, user: $runtime"
case "$runtime" in "runsc true [ALL] 10000:10000") ;; *) fail "ag-$id isn't isolated as expected: $runtime" ;; esac
rt docker exec "ag-$id" dmesg 2>/dev/null | grep -qi gvisor || fail "ag-$id's kernel isn't gVisor"
rt docker exec "ag-$id" sh -c '[ ! -e /var/run/docker.sock ] && [ ! -e /run/agentd ]' || fail "ag-$id can see a Docker or agentd socket"
ip=$(rt docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "ag-$id")
token=$(rt sed -n 's/^API_SERVER_KEY=//p' "/data/agent-conf/$id/.env")
wait_for 100 "rt curl -fsS -H 'authorization: Bearer $token' http://$ip:8642/v1/models" || fail "ag-$id's API never answered"
reply=$(rt curl -fsS -m 180 -H "authorization: Bearer $token" -H 'content-type: application/json' "http://$ip:8642/v1/chat/completions" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"smoke test ping"}]}') || fail "chat"
printf '%s' "$reply" | grep -q 'smoke test ping' || fail "the reply doesn't echo: $reply"
echo "smoke: the agent answered: $(printf '%s' "$reply" | head -c 300)"
[ -n "${KEEP:-}" ] || rt curl -fsS -o /dev/null -X DELETE -H "authorization: Bearer $KEY" "http://127.0.0.1:8787/api/agents/$id" || fail "delete the agent"
echo "smoke: ok"
