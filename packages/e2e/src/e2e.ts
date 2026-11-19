import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { connect, createServer } from 'node:net'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDeepStrictEqual, promisify, stripVTControlCharacters } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Admin, Health, Update } from '@openhut/common/admin/admin.ts'
import type { Agent, Grant } from '@openhut/common/agents/agent.ts'
import type { ApiError, Deleted, List } from '@openhut/common/api.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import type { Connection, ConnectionEvent } from '@openhut/common/connections/connection.ts'
import type { Me } from '@openhut/common/team/team.ts'
import type { AgentdReplies } from '../../runtime/src/agentd/agentd.ts'

const sh = promisify(execFile)
const APP = 'http://127.0.0.1:8787'
const BROWSE_URL = 'https://example.com/'
const BROWSE_TITLE = 'Example Domain'
const OPENHUT = '/opt/openhut'
const RESULTS = process.env.RESULTS ?? '/results'
const DENIED = 'Denied: no connection grants postgres_query to this agent.'
const KEY = process.env.OPENHUT_E2E_KEY ?? ''
const AGENTS_NET = '10.200.0.0/16'
const DOCKER_USER_JUMP = ['DOCKER-USER', '-s', AGENTS_NET, '-j', 'AGENT']
const FIREWALL_SCRIPT = `${OPENHUT}/install/agents-firewall.sh`
const AGENTD_PROCESS = `^node ${OPENHUT}/packages/runtime/src/agentd/agentd.ts`
const APP_PROCESS = `^node ${OPENHUT}/packages/runtime/src/server/app.ts`
const UNTRUSTED_CA = /self-signed|unable to (get|verify)/i
const WHATSAPP_PAIRING = /^(2@|https:\/\/wa\.me\/)/
const SERVER_LISTENER_PORT = 9999
const FENCE_CHECKS = ['private address', 'cloud metadata', 'tailnet address', 'host listener', 'public https', 'gateway']
const DNS_QUERY = '123401000001000000000000076578616d706c6503636f6d0000010001'
const GW = `import urllib.request, json, os
req = urllib.request.Request(os.environ["URL"], data=os.environ["BODY"].encode(), headers={"authorization": "Agent " + os.environ["TOKEN"], "content-type": "application/json", "accept": "application/json, text/event-stream"})
try:
    r = urllib.request.urlopen(req, timeout=60); print(json.dumps({"status": r.status, "body": r.read().decode()}))
except urllib.error.HTTPError as e:
    print(json.dumps({"status": e.code, "body": e.read().decode()}))`
const BROKER = `import urllib.request, json, os
body = os.environ["BODY"].encode() or None
req = urllib.request.Request(os.environ["URL"], data=body, method=os.environ["METHOD"], headers={"authorization": "Bearer " + os.environ["TOKEN"], "content-type": "application/json", "anthropic-version": "2023-06-01"})
try:
    r = urllib.request.urlopen(req, timeout=60); print(json.dumps({"status": r.status, "body": r.read().decode()}))
except urllib.error.HTTPError as e:
    print(json.dumps({"status": e.code, "body": e.read().decode()}))`
const PROBE = `
import socket, json, os, subprocess
def tcp(h, p):
    try:
        socket.create_connection((h, p), timeout=4).close(); return "open"
    except socket.timeout: return "timeout"
    except Exception as e: return type(e).__name__
def can_write(p):
    try:
        open(p, "a").close(); return True
    except Exception: return False
paths = {"root": "/usr/fm_probe", "config": "/opt/data/config.yaml", "env": "/opt/data/.env", "soul": "/opt/data/SOUL.md",
         "hooks": "/opt/data/hooks/x.py", "plugins": "/opt/data/plugins/x.py", "pairing": "/opt/data/platforms/pairing/slack-approved.json",
         "legacy_pairing": "/opt/data/pairing/slack-approved.json", "claude_settings": "/opt/data/.claude/settings.json", "claude_cli": "/usr/local/bin/claude"}
def can_rename(p):
    try:
        os.rename(p, p + ".moved"); os.rename(p + ".moved", p); return True
    except Exception: return False
def udp_dns(server):
    q = bytes.fromhex("${DNS_QUERY}")
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(3)
    try:
        s.sendto(q, (server, 53)); s.recvfrom(512); return "answered"
    except socket.timeout: return "timeout"
    except Exception as e: return type(e).__name__
renames = ["/opt/data/platforms", "/opt/data/.claude", "/opt/data/platforms/pairing", "/opt/data/.claude/settings.json", "/opt/data/config.yaml",
           "/opt/data/.env", "/opt/data/SOUL.md", "/opt/data/hooks", "/opt/data/plugins", "/opt/data/pairing"]
o = {"uid": os.getuid(), "kernel": open("/proc/version").read().strip()[:80],
     "writable": {k: can_write(p) for k, p in paths.items()}, "renamable": {p: can_rename(p) for p in renames},
     "udp_dns": {"other_resolver": udp_dns("8.8.8.8"), "own_resolver": udp_dns(open("/etc/resolv.conf").read().split()[1])},
     "capeff": [l.split()[1] for l in open("/proc/self/status") if l.startswith("CapEff")][0],
     "docker_sock": os.path.exists("/var/run/docker.sock"), "agentd_sock": os.path.exists("/run/agentd")}
try: socket.getaddrinfo("example.com", 443); o["dns"] = "ok"
except Exception as e: o["dns"] = type(e).__name__
o["net"] = {k: tcp(h, p) for k, (h, p) in json.loads(os.environ["TARGETS"]).items()}
print(json.dumps(o))`
const FLOOD = `import socket, os, time, json
gw, tok = os.environ["GW"], os.environ["TOKEN"]
def burst(n, payload):
    socks, refused = [], 0
    for i in range(n):
        try:
            s = socket.create_connection((gw, 8081), timeout=1)
        except Exception:
            refused += 1; continue
        try:
            s.sendall(payload)
        except Exception:
            pass
        socks.append(s)
    return socks, refused
held, held_refused = burst(30, b"POST /api/v1/mcp HTTP/1.1\\r\\nHost: x\\r\\n")
time.sleep(3)
for s in held: s.close()
time.sleep(2)
head = ("POST /api/v1/mcp HTTP/1.1\\r\\nHost: x\\r\\nAuthorization: Agent " + tok + "\\r\\nContent-Type: application/json\\r\\nContent-Length: 900000\\r\\n\\r\\n").encode()
bodies, _ = burst(12, head + b"x" * 100000)
time.sleep(8)
got429 = 0
for s in bodies:
    s.settimeout(0.5)
    try:
        if b" 429 " in s.recv(200): got429 += 1
    except Exception:
        pass
    s.close()
print(json.dumps({"headersHeld": len(held), "headersRefused": held_refused, "bodies": len(bodies), "got429": got429}))`
const LIMITS = `import socket, os, time, json
gw, tok = os.environ["GW"], os.environ["TOKEN"]
s = socket.create_connection((gw, 8081), timeout=20)
body = b"x" * 2000000
s.sendall(("POST /api/v1/mcp HTTP/1.1\\r\\nHost: x\\r\\nAuthorization: Agent " + tok + "\\r\\nContent-Type: application/json\\r\\nContent-Length: %d\\r\\n\\r\\n" % len(body)).encode())
try:
    s.sendall(body)
except Exception:
    pass
try:
    big = s.recv(200).decode(errors="replace").split("\\r\\n")[0]
except Exception as e:
    big = type(e).__name__
s.close()
t = time.time()
s = socket.create_connection((gw, 8081), timeout=40)
s.sendall(b"POST /api/v1/mcp HTTP/1.1\\r\\nHost: x\\r\\n")
try:
    first = s.recv(200).decode(errors="replace").split("\\r\\n")[0] or "closed"
except Exception as e:
    first = type(e).__name__
print(json.dumps({"bigBody": big, "slowHeaders": first, "after": round(time.time() - t)}))`
const phase = process.argv[2] ?? 'main'
const results: CheckResult[] = []
const expectedEvents: Record<string, Record<string, number>> = {}

mkdirSync(RESULTS, { recursive: true })
switch (phase) {
  case 'main':
    main()
    break
  case 'after-upgrade':
    afterUpgrade()
    break
  case 'after-restart':
    afterRestart()
    break
  case 'update-broken':
    updateBroken()
    break
  case 'update':
    update()
    break
  default:
    throw new Error(`Unknown phase ${phase}: use main, after-upgrade, after-restart, update-broken or update`)
}
after(() => {
  const file = `${RESULTS}/e2e-${phase}.json`
  const passed = results.filter((r) => r.pass).length
  const report: PhaseResults = { phase, at: new Date().toISOString(), passed, failed: results.length - passed, results }
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`\n${passed}/${results.length} passed -> ${file}`)
})

function main() {
  const dbPassword = randomBytes(12).toString('hex')
  const agentPassword = randomBytes(12).toString('hex')
  const seatToken = `sk-ant-oat01-${randomBytes(24).toString('hex')}`
  const extras: string[] = []
  let owner = ''
  let fw: Firewall = {}
  let whatsapp = ''
  let call: Call
  let conn: Connection
  let dev: Agent
  let sales: Agent
  let devGrant: Grant
  let iso: Isolation

  const q = (sql: string, connectionId?: string) => callTool(dev, { name: 'postgres_query', arguments: { sql }, connectionId })
  const extra = async (name: string, dsn: string) => {
    const x = await call<Connection>('create_connection', { name, dsn })
    extras.push(x.id)
    await call('create_grant', { agentId: dev.id, connectionId: x.id })
    return x.id
  }
  const dropExtras = async () => {
    for (const id of extras.splice(0)) await call('delete_connection', { id })
  }

  check(
    'I1',
    'One curl command installs OpenHut on a bare server; every download matches its pinned checksum',
    '"OpenHut is running", no checksum or tar warnings',
    async () => {
      const log = stripVTControlCharacters(readFileSync(`${RESULTS}/install.log`, 'utf8'))
      return {
        actual: log
          .trim()
          .split('\n')
          .filter((l) => l.startsWith('==>') || /OpenHut is running|mismatch|extended header/.test(l)),
        pass: log.includes('OpenHut is running') && !/checksum mismatch|unknown extended header/i.test(log),
      }
    },
  )

  check(
    'I2',
    'Code that root runs is owned by root and writable by nobody else',
    'no file or folder under /opt/openhut (symlinks aside) owned by another user or group-/world-writable',
    async () => {
      const loose = await shell(`find ${OPENHUT} ! -type l \\( ! -user root -o ! -group root -o -perm -0020 -o -perm -0002 \\) -print | head -5`)
      return { actual: loose || 'none', pass: loose === '' }
    },
  )

  check(
    'I3',
    'The database (holds auth_secret) and settings are private',
    '/data/app 700 openhut, its Postgres folder 700, env 600 root, agent folders 700',
    async () => {
      const perms = await shell("stat -c '%a %U %n' /data/app /data/app/pglite /etc/openhut/env /data/agents /data/agent-conf")
      const modes = perms.split('\n').map((l) => l.split(' ').slice(0, 2).join(' '))
      return { actual: perms, pass: isDeepStrictEqual(modes, ['700 openhut', '700 openhut', '600 root', '700 root', '700 root']) }
    },
  )

  check(
    'A1',
    'The runtime answers only the key the app enrolled; the installer kept its hash, never the key',
    'no key: 401; a wrong key: 401; the enrolled key: 200 on /api/agents and /api/me; /etc/openhut/env holds the sha256; the key itself is in no log',
    async () => {
      const none = await api('GET', '/api/agents')
      const wrong = await api('GET', '/api/agents', undefined, 'not-the-key')
      const right = await api<List<Agent>>('GET', '/api/agents', undefined, KEY)
      owner = (await api<Me>('GET', '/api/me', undefined, KEY)).json.user?.email ?? ''
      const stored = await shell("sed -n 's/^OPENHUT_CLIENT_KEY_SHA256=//p' /etc/openhut/env")
      const leaked = await shell(`grep -rlF -e '${KEY}' ${RESULTS}/install.log /var/log/openhut /var/log/openhut-boot.log /etc/openhut 2>/dev/null || true`)
      const hash = createHash('sha256').update(KEY).digest('hex')
      const logged = readFileSync(`${RESULTS}/install.log`, 'utf8').includes(`sha256:${hash.slice(0, 8)}`)
      return {
        actual: { none: none.status, wrong: wrong.status, right: `${right.status} ${right.json.object}`, owner, stored: stored === hash, logged, leaked: leaked || 'none' },
        pass: KEY.length >= 32 && none.status === 401 && wrong.status === 401 && right.status === 200 && !!owner && stored === hash && logged && leaked === '',
      }
    },
  )

  check(
    'A2',
    'The runtime answers only on loopback, so the key works from nowhere else',
    "with the enrolled key: from a container on the server's Docker bridge no HTTP answer at all; to the server's own LAN address, ECONNREFUSED",
    async () => {
      const bridge = await shell("ip -4 addr show docker0 | sed -n 's/.*inet \\([0-9.]*\\).*/\\1/p'")
      const fromLan = await docker('run', '--rm', 'alpine:3.20', 'sh', '-c', `wget -S -T 3 -O /dev/null --header 'Authorization: Bearer ${KEY}' http://${bridge}:8787/api/agents 2>&1 | grep -q 'HTTP/' && echo answered || echo blocked`)
      const lanIp = await shell("ip -4 route get 1.1.1.1 | sed -n 's/.* src \\([0-9.]*\\).*/\\1/p'")
      const toLanIp = await fetch(`http://${lanIp}:8787/api/agents`, { headers: { authorization: `Bearer ${KEY}` } }).then((r) => `answered ${r.status}`, (e: { cause?: { code?: string } }) => e.cause?.code ?? 'no code')
      return { actual: { bridge, fromLan, lanIp, toLanIp }, pass: !!bridge && fromLan === 'blocked' && !!lanIp && toLanIp === 'ECONNREFUSED' }
    },
  )

  check('T1', 'Usage data identifies no one', 'setup_completed queued with no actor; no email, login or username anywhere (a unit-level check: events.ts in local mode in a node process on the server, not a running desktop app)', async () => {
    const events = `file://${OPENHUT}/packages/runtime/src/server/platform/events.ts`
    const script = `const { emit, takeTelemetry } = await import(${JSON.stringify(events)})
emit({ name: 'setup.completed', actor: { id: 'usr_e2elocal' }, target: { type: 'person', id: 'usr_e2elocal' } })
console.log(JSON.stringify(takeTelemetry()))`
    const { stdout } = await sh('node', ['--input-type=module', '-e', script], { env: { ...process.env, OPENHUT_SOCKET: '/tmp/e2e-local.sock', OPENHUT_MODEL: 'claude' } })
    const sent: { name: string; properties: Record<string, unknown> }[] = JSON.parse(stdout.trim().split('\n').at(-1) ?? '[]')
    return { actual: sent, pass: sent.some((e) => e.name === 'setup_completed') && !/email|login|username|usr_e2elocal/.test(JSON.stringify(sent)) }
  })

  check('A3', 'The installer ends saying which app key it runs for, and serves nothing beyond loopback', 'install log says it runs for the app key; no tailscale serve and no setup link', async () => {
    const log = readFileSync(`${RESULTS}/install.log`, 'utf8')
    const forKey = log.includes('OpenHut is running for the app key')
    return { actual: { forKey, serve: log.includes('tailscale serve'), setupLink: log.includes('/setup?code=') }, pass: forKey && !log.includes('tailscale serve') && !log.includes('/setup?code=') }
  })

  check(
    'A4',
    'The control MCP takes the same enrolled key; there is no OAuth server',
    'no key: 401; with the key it lists tools; OAuth discovery and token endpoints: 404',
    async () => {
      const noLogin = await fetch(`${APP}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
      call = await mcp(KEY)
      const agents = await call<List<Agent>>('list_agents')
      const discovery = (await fetch(`${APP}/.well-known/oauth-authorization-server`)).status
      const token = (await fetch(`${APP}/api/oauth/token`, { method: 'POST' })).status
      return {
        actual: { noLogin: noLogin.status, listAgents: agents.object, discovery, token },
        pass: noLogin.status === 401 && agents.object === 'list' && discovery === 404 && token === 404,
      }
    },
  )

  check('B1', 'Control MCP creates a connection, two agents and a grant', 'Dev granted Orders DB, Sales has none', async () => {
    await startTeamDb(dbPassword, agentPassword)
    await until(() => docker('image', 'inspect', agentImagePin()).then(() => true, () => false), 30 * 60_000, 'the agent image to download')
    conn = await call<Connection>('create_connection', { name: 'Orders DB', dsn: `postgres://openhut_agent:${agentPassword}@172.30.0.10:5432/postgres` })
    dev = await call<Agent>('create_agent', { name: 'Dev', instructions: '# Dev\nYou answer engineers. Use the Orders DB when asked for data.' })
    sales = await call<Agent>('create_agent', { name: 'Sales', instructions: '# Sales\nYou answer customers. You have no database access.' })
    devGrant = await call<Grant>('create_grant', { agentId: dev.id, connectionId: conn.id })
    const grants = (await call<List<Grant>>('list_grants', { agentId: dev.id })).data.map((g) => g.connectionId)
    const salesGrants = (await call<List<Grant>>('list_grants', { agentId: sales.id })).data
    return { actual: { dev: grants, sales: salesGrants }, pass: isDeepStrictEqual(grants, [conn.id]) && salesGrants.length === 0 }
  })

  check('B2', 'Both agents run, one container each', '2 agents, status running', async () => {
    await call('update_agent', { id: dev.id, wanted: 'running' })
    await call('update_agent', { id: sales.id, wanted: 'running' })
    const listed = (await call<List<Agent>>('list_agents')).data
    return { actual: listed.map((a) => `${a.name}:${a.status}`), pass: listed.length === 2 && listed.every((a) => a.status === 'running') }
  })

  check('B3', 'The gateway keeps the DB password: it never comes back out', 'not in any control MCP reply, dashboard page, agent file or log', async () => {
    const outputs = {
      list_connections: await call('list_connections'),
      get_connection: await call('get_connection', { id: conn.id }),
      get_agent: await call('get_agent', { id: dev.id }),
      list_agents: await call('list_agents'),
      created: conn,
      connection_api: (await api('GET', `/api/connections/${conn.id}`, undefined, KEY)).json,
      agent_api: (await api('GET', `/api/agents/${dev.id}`, undefined, KEY)).json,
    }
    const files = await shell(
      `grep -rlF -e '${agentPassword}' -e '${dbPassword}' /data/agent-conf/${dev.id} /data/agents/${dev.id} /var/log/openhut 2>/dev/null || true`,
    )
    const leaks = Object.entries(outputs)
      .filter(([, v]) => JSON.stringify(v).includes(agentPassword))
      .map(([k]) => k)
    return { actual: { leaks, files: files || 'none' }, pass: !leaks.length && !files }
  })

  check(
    'C1',
    'Agent container: pinned image, gVisor, uid 10000, read-only root, no caps, limits, one network, no restart policy',
    'the digest in install/agent-image, runsc, 10000:10000, ro, unprivileged, ALL dropped, none added, no-new-privileges, pids 512, 1 GiB, 1 CPU, only ag-<id> at .2, restart no',
    async () => {
      const spec = await containerSpec(dev.id)
      writeFileSync(`${RESULTS}/dev-container-spec.json`, JSON.stringify(spec, null, 2))
      const digest = agentImagePin().split('@')[1] ?? 'no digest'
      return {
        actual: { ...spec, mounts: undefined, tmpfs: undefined },
        pass:
          spec.image.endsWith(digest) &&
          spec.runtime === 'runsc' &&
          spec.user === '10000:10000' &&
          spec.readOnly &&
          !spec.privileged &&
          isDeepStrictEqual(spec.capDrop, ['ALL']) &&
          !spec.capAdd?.length &&
          !!spec.securityOpt?.includes('no-new-privileges') &&
          spec.pids === 512 &&
          spec.memory === 1 << 30 &&
          spec.nanoCpus === 1e9 &&
          isDeepStrictEqual(spec.networks, [`ag-${dev.id}`]) &&
          spec.ip === `10.200.${dev.net}.2` &&
          spec.restart === 'no',
      }
    },
  )

  check(
    'C2',
    'Exactly these mounts: its own folder, its rendered files read-only, the resolver, the Claude CLI, plugin and WhatsApp bridge read-only',
    'the 12 bind mounts and 4 tmpfs listed in dev-container-spec.json, nothing else',
    async () => {
      const { mounts, tmpfs } = await containerSpec(dev.id)
      const c = `/data/agent-conf/${dev.id}`
      const wantMounts = [
        `${c}/.env -> /opt/data/.env (ro)`,
        `${c}/SOUL.md -> /opt/data/SOUL.md (ro)`,
        `${c}/auth.json -> /opt/data/auth.json (ro)`,
        `${c}/claude-settings.json -> /opt/data/.claude/settings.json (ro)`,
        `${c}/config.yaml -> /opt/data/config.yaml (ro)`,
        `/data/agents/${dev.id} -> /opt/data`,
        `/data/agents/${dev.id}/.claude -> /opt/data/.claude`,
        `/data/agents/${dev.id}/platforms -> /opt/data/platforms`,
        '/etc/agentd/resolv.conf -> /etc/resolv.conf (ro)',
        `${OPENHUT}/bin/claude -> /usr/local/bin/claude (ro)`,
        `${OPENHUT}/vendor/hermes-plugins -> /opt/data/plugins (ro)`,
        '/var/lib/openhut/whatsapp-bridge -> /opt/data/scripts/whatsapp-bridge (ro)',
      ].sort()
      writeFileSync(`${RESULTS}/dev-config.yaml`, redact(readFileSync(`${c}/config.yaml`, 'utf8')))
      return {
        actual: { mounts, tmpfs },
        pass:
          isDeepStrictEqual(mounts, wantMounts) && isDeepStrictEqual(tmpfs, ['/opt/data/hooks', '/opt/data/pairing', '/opt/data/platforms/pairing', '/tmp']),
      }
    },
  )

  check('D1', "Both agents' Hermes gateways come up under gVisor", 'API server answers within 4 min', async () => {
    const t0 = Date.now()
    await Promise.all([waitReady(dev), waitReady(sales)])
    return { actual: `ready in ${Math.round((Date.now() - t0) / 1000)} s`, pass: true }
  })

  check('D2', 'A message reaches the agent and its reply comes back', '"ECHO: hello there"', async () => {
    const echo = await chat(dev, 'hello there')
    return { actual: echo, pass: echo === 'ECHO: hello there' }
  })

  check('D3', 'Dev (granted) queries the team DB through the gateway', 'rows [{n: 42, revenue: 9030.00}]', async () => {
    const d3 = inner(await chat(dev, 'sql: select count(*)::int as n, sum(total)::text as revenue from orders'))
    const row = rowsOf(d3)?.[0]
    return { actual: d3, pass: row?.n === 42 && row?.revenue === '9030.00' }
  })

  check(
    'D5',
    "A granted agent can't write, even with a role that can (one read-only SELECT per call)",
    'role alone can delete (control); via the gateway: delete, nextval() and a stacked "commit; delete" all fail; still 42 rows, sequence at 42',
    async () => {
      const deleteAsTheRole = ['psql', '-U', 'openhut_agent', '-d', 'postgres', '-c', 'begin', '-c', 'delete from orders', '-c', 'rollback']
      const control = await docker('exec', 'teamdb', ...deleteAsTheRole).catch((e) => failure(e))
      const del = (await q('delete from orders')).text
      const seq = (await q("select nextval('orders_id_seq')")).text
      const multi = (await q('select 1; commit; delete from orders')).text
      const left = await orderCount()
      const lastId = (await psql('select last_value from orders_id_seq')).trim()
      return {
        actual: { control: control.replace(/\s+/g, ' '), delete: del, nextval: seq, stacked: multi, rows: left, sequence: lastId },
        pass:
          /DELETE 42/.test(control) &&
          del.startsWith('Failed:') &&
          /read-only transaction/.test(seq) &&
          /cannot insert multiple commands/.test(multi) &&
          left === '42' &&
          lastId === '42',
      }
    },
  )

  check('E1', 'Revoking the grant takes effect on the next call', '"Denied: …" and a new denied audit row', async () => {
    await call('delete_grant', { id: devGrant.id })
    const e1 = inner(await chat(dev, 'sql: select 1 as one'))
    const lastRow = (await call<List<ConnectionEvent>>('list_connection_events', { agentId: dev.id, limit: 1 })).data[0]
    return {
      actual: { reply: e1, audit: `${lastRow?.tool} ${lastRow?.outcome}` },
      pass: e1 === DENIED && lastRow?.outcome === 'denied' && lastRow?.tool === 'postgres_query',
    }
  })

  check('E2', 'Granting again works immediately', 'rows [{seven: 7}]', async () => {
    await call('create_grant', { agentId: dev.id, connectionId: conn.id })
    const e2 = inner(await chat(dev, 'sql: select 7 as seven'))
    return { actual: e2, pass: rowsOf(e2)?.[0]?.seven === 7 }
  })

  check('E3', "A connection's Activity lists the calls through it", "connection events: Dev's calls only, with agent names", async () => {
    const connEvents = (await api<List<ConnectionEvent>>('GET', `/api/connection-events?connectionId=${conn.id}&limit=100`, undefined, KEY)).json.data ?? []
    return {
      actual: { events: connEvents.length, agents: [...new Set(connEvents.map((e) => e.agentName))] },
      pass: connEvents.length >= 3 && connEvents.every((e) => e.agentId === dev.id && e.agentName === 'Dev'),
    }
  })

  check('R1', 'The browser is off until someone switches it on', 'browser false; Hermes\'s own browser toolset disabled; agent-browser is not in the container, so the agent\'s command fails', async () => {
    const agent = (await api<Agent>('GET', `/api/agents/${dev.id}`, undefined, KEY)).json
    const disabled = await docker('exec', `ag-${dev.id}`, 'grep', 'disabled_toolsets', '/opt/data/config.yaml')
    const installed = await docker('exec', `ag-${dev.id}`, 'sh', '-c', 'command -v agent-browser || echo missing')
    const reply = await chat(dev, `browser: open ${BROWSE_URL}`)
    return { actual: { browser: agent.browser, disabled, installed, reply: reply.slice(-160) }, pass: agent.browser === false && disabled.includes('[browser,') && installed === 'missing' && reply.includes('not found') && !reply.includes(BROWSE_TITLE) }
  })

  check('R2', 'Switched on, the agent opens a public page with agent-browser, inside its own gVisor container', 'PATCH 200; the container is rebuilt still runsc and read-only, with a 4 GiB memory limit and agent-browser mounted read-only; the agent\'s command returns the page title', async () => {
    const patched = await api<Agent>('PATCH', `/api/agents/${dev.id}`, { browser: true }, KEY)
    await waitReady(dev)
    const reply = await chat(dev, `browser: open ${BROWSE_URL}`)
    const spec = await docker('inspect', '--format', '{{.HostConfig.Runtime}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.Memory}} {{index .Config.Labels "openhut.browser"}}', `ag-${dev.id}`)
    const mounts: { Destination: string; RW: boolean }[] = JSON.parse(await docker('inspect', '--format', '{{json .Mounts}}', `ag-${dev.id}`))
    const browserMounts = mounts.filter((m) => /agent-browser|browser-policy/.test(m.Destination)).map((m) => `${m.Destination} ${m.RW ? 'rw' : 'ro'}`)
    return {
      actual: { status: patched.status, browser: patched.json.browser, spec, browserMounts, reply: reply.slice(-200) },
      pass: patched.status === 200 && patched.json.browser === true && spec === 'runsc true 4294967296 on' && browserMounts.length === 4 && browserMounts.every((m) => m.endsWith(' ro')) && reply.includes(BROWSE_TITLE),
    }
  })

  check('R3', 'Only while someone looks: the live view streams the agent\'s page, paced by the viewer, and the screencast stops once nobody watches', 'the WebSocket sends the page address and a JPEG frame; while the viewer holds back its ack, the agent scrolling sends no second frame; after the ack one comes; within 30 s of closing agent-browser reports no screencast', async () => {
    const view = await openLive(`/api/browsers/${dev.id}/live?fps=30`, KEY, { ack: false })
    await until(async () => view.lines.some((line) => line.type === 'frame'), 30_000, 'the first live frame')
    for (let i = 0; i < 3; i++) await agentBrowser(dev, 'scroll', i % 2 ? 'up' : 'down', '300')
    await sleep(1500)
    const unacked = view.lines.filter((line) => line.type === 'frame').length
    const first = view.lines.find((line) => line.type === 'frame')
    view.send({ type: 'ack', seq: first?.seq })
    await agentBrowser(dev, 'scroll', 'down', '300')
    await until(async () => view.lines.filter((line) => line.type === 'frame').length > unacked, 30_000, 'a frame after the ack')
    const page = view.lines.find((line) => line.type === 'tabs' || line.type === 'url')
    view.close()
    await until(async () => /Screencasting: false/.test(await agentBrowser(dev, 'stream', 'status')), 30_000, 'the screencast to stop after the view closed')
    return {
      actual: { page: JSON.stringify(page).slice(0, 160), picture: String(first?.data).slice(0, 12), unacked, afterAck: view.lines.filter((line) => line.type === 'frame').length },
      pass: JSON.stringify(page).includes(BROWSE_URL) && String(first?.data).startsWith('/9j/') && unacked === 1 && view.lines.filter((line) => line.type === 'frame').length > 1,
    }
  })

  check('R4', 'Take over: the owner watches live, the agent is paused, the owner\'s clicks and keys drive the page, and handing back frees the agent', 'input before Take over does nothing; hold is confirmed on the socket and outlasts a reconcile (35 s); while held the agent\'s click is refused with "A person is using this browser"; the owner clicks the search box, types gVisor and Enter and the page lands on the gVisor article; hand back is confirmed and the agent browses again; closing the view stops the screencast', async () => {
    await chat(dev, 'browser: open https://www.wikipedia.org/')
    const center = /"(\d+),(\d+)"/.exec(await agentBrowser(dev, 'eval', "(r => Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2))(document.querySelector('#searchInput').getBoundingClientRect())"))
    const box = center ? { x: Number(center[1]), y: Number(center[2]) } : undefined
    const view = await openLive(`/api/browsers/${dev.id}/live`, KEY)
    await until(async () => view.lines.some((line) => line.type === 'frame'), 30_000, 'the first live frame')
    const click = [{ type: 'input_mouse', eventType: 'mousePressed', x: box?.x ?? 0, y: box?.y ?? 0, button: 'left', clickCount: 1 }, { type: 'input_mouse', eventType: 'mouseReleased', x: box?.x ?? 0, y: box?.y ?? 0, button: 'left', clickCount: 1 }]
    const keys = [...'gVisor'].flatMap((key) => [{ type: 'input_keyboard', eventType: 'keyDown', key, text: key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }, { type: 'input_keyboard', eventType: 'keyUp', key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }])
      .concat([{ type: 'input_keyboard', eventType: 'keyDown', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }, { type: 'input_keyboard', eventType: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 }])
    for (const input of [...click, ...keys]) view.send(input)
    await sleep(3000)
    const early = (await agentBrowser(dev, 'get', 'url')).trim().split('\n').pop()
    view.send({ type: 'hold', held: true })
    await until(async () => view.lines.some((line) => line.type === 'hold' && line.held === true), 10_000, 'the hold to be confirmed')
    await sleep(35_000)
    const agentWhileHeld = await agentBrowser(dev, 'click', '#searchInput')
    for (const input of [...click, ...keys]) view.send(input)
    await until(async () => (await agentBrowser(dev, 'get', 'url')).includes('/wiki/GVisor'), 30_000, 'the search to land on the gVisor article')
    const landed = (await agentBrowser(dev, 'get', 'url')).trim().split('\n').pop()
    view.send({ type: 'hold', held: false })
    await until(async () => view.lines.filter((line) => line.type === 'hold').at(-1)?.held === false, 10_000, 'the hand back to be confirmed')
    const agentAfter = await agentBrowser(dev, 'open', BROWSE_URL)
    const frames = view.lines.filter((line) => line.type === 'frame').length
    view.close()
    await until(async () => /Screencasting: false/.test(await agentBrowser(dev, 'stream', 'status')), 30_000, 'the screencast to stop after the view closed')
    return {
      actual: { box, frames, early, agentWhileHeld: agentWhileHeld.trim().slice(0, 120), landed, holds: view.lines.filter((line) => line.type === 'hold').map((line) => line.held), agentAfter: agentAfter.trim().split('\n')[0] },
      pass: !!box && frames >= 2 && early === 'https://www.wikipedia.org/' && /A person is using this browser/.test(agentWhileHeld) && !!landed?.includes('wikipedia.org/wiki/GVisor') && agentAfter.includes(BROWSE_TITLE),
    }
  })

  check('R5', 'Switched off again, the browser is gone', 'PATCH 200; the container is rebuilt without agent-browser and back to its 1 GiB size; the live view is refused (4409)', async () => {
    const patched = await api<Agent>('PATCH', `/api/agents/${dev.id}`, { browser: false }, KEY)
    await waitReady(dev)
    const installed = await docker('exec', `ag-${dev.id}`, 'sh', '-c', 'command -v agent-browser || echo missing')
    const label = await docker('inspect', '--format', '{{index .Config.Labels "openhut.browser"}} {{.HostConfig.Memory}}', `ag-${dev.id}`)
    const view = await openLive(`/api/browsers/${dev.id}/live`, KEY)
    const refused = await view.closed
    return { actual: { status: patched.status, browser: patched.json.browser, installed, label, refused }, pass: patched.status === 200 && patched.json.browser === false && installed === 'missing' && label === 'off 1073741824' && refused.code === 4409 }
  })

  check(
    'K1',
    "A query is cancelled after 15 s, and a call can't lift that for the next one",
    'after a call sets statement_timeout to 0, pg_sleep(20) still fails with "statement timeout" in 14-19 s',
    async () => {
      const off = await q("select set_config('statement_timeout', '0', false) as was")
      const k1 = await q('select pg_sleep(20)')
      return {
        actual: [`set: ${off.text}`, `${k1.ms} ms ${k1.text}`],
        pass: !off.isError && k1.isError && /statement timeout/.test(k1.text) && k1.ms > 14_000 && k1.ms < 19_000,
      }
    },
  )

  check('K2', 'At most 1000 rows come back', '1000 rows, truncated: true', async () => {
    const k3 = await q('select g from generate_series(1, 2000) g')
    const body: { rows?: unknown[]; truncated?: boolean } = k3.text.startsWith('{') ? JSON.parse(k3.text) : {}
    return { actual: { rows: body.rows?.length, truncated: body.truncated }, pass: body.rows?.length === 1000 && body.truncated === true }
  })

  check('K3', 'A data-modifying CTE is refused', 'fails; still 42 rows', async () => {
    const k4 = await q('with d as (delete from orders returning 1) select * from d')
    const left = await orderCount()
    return { actual: `${k4.text} | rows=${left}`, pass: k4.isError && left === '42' }
  })

  check(
    'K4',
    'Connections that could escape read-only are refused: a superuser, a pg_read_server_files role, a member of a superuser role',
    '3 × "Refused: …"',
    async () => {
      const ids = [
        await extra('Superuser DB', `postgres://postgres:${dbPassword}@172.30.0.10:5432/postgres`),
        await extra('Server files DB', `postgres://openhut_files:${agentPassword}@172.30.0.10:5432/postgres`),
        await extra('Superuser member DB', `postgres://openhut_member:${agentPassword}@172.30.0.10:5432/postgres`),
      ]
      const replies: string[] = []
      for (const id of ids) replies.push((await q('select 1', id)).text)
      return { actual: replies, pass: replies.every((t) => /^Failed: Refused: this connection logs in as a superuser/.test(t)) }
    },
  )

  check('K7', 'Ambiguous and malformed calls fail cleanly', '"More than one connection …"; "Unknown arguments: evil." with a hint', async () => {
    try {
      const ambiguous = await q('select 1')
      const malformed = await callTool(dev, { name: 'postgres_query', arguments: { sql: 'select 1', evil: 1 }, connectionId: conn.id })
      return {
        actual: [ambiguous.text, malformed.text],
        pass: /^More than one connection has postgres_query/.test(ambiguous.text) && /^Unknown arguments: evil\./.test(malformed.text),
      }
    } finally {
      await dropExtras()
    }
  })

  check(
    'K8',
    "Results are whole or refused, never cut: under 64 KB they arrive complete; up to 8 MB they're refused as too large for the agent; past 8 MB the read stops",
    '600 rows parse; ~1 MB: "Result too large for the agent"; ~20 MB: "Result too large: over 8 MB"; the app still answers',
    async () => {
      const fits = await q("select g, repeat('x', 40) as pad from generate_series(1, 600) g")
      const oneMb = await q("select g, repeat('x', 1000) as pad from generate_series(1, 1000) g")
      const twentyMb = await q("select repeat('x', 1000000) as x from generate_series(1, 20)")
      const fitsRows = rowsOf(fits.text)?.length
      const h = await health()
      return {
        actual: { fits: `${fitsRows} rows`, oneMB: oneMb.text.slice(0, 90), twentyMB: twentyMb.text.slice(0, 60), health: h.status },
        pass:
          fitsRows === 600 &&
          /^Failed: Result too large for the agent/.test(oneMb.text) &&
          /^Failed: Result too large: over 8 MB/.test(twentyMb.text) &&
          h.status === 200,
      }
    },
  )

  check('K9', 'At most 2 calls per agent per connection run at once', '3 parallel 4-second queries: 2 run, 1 "Busy"', async () => {
    const parallel = await Promise.all([1, 2, 3].map(() => q('select pg_sleep(4)')))
    const busy = parallel.filter((r) => /^Busy:/.test(r.text)).length
    const done = parallel.filter((r) => !r.isError).length
    return { actual: parallel.map((r) => r.text.slice(0, 80)), pass: done === 2 && busy === 1 }
  })

  check(
    'K10a',
    'TLS through the live gateway: require encrypts; verify-full and verify-ca refuse a certificate from an untrusted CA',
    'require: ssl true; verify-full and verify-ca: certificate errors',
    async () => {
      try {
        const live: Record<string, string> = {}
        for (const mode of ['require', 'verify-full', 'verify-ca']) {
          const id = await extra(`TLS ${mode}`, `postgres://openhut_agent:${agentPassword}@teamdb.test:5432/postgres?sslmode=${mode}`)
          live[mode] = (await q('select ssl from pg_stat_ssl where pid = pg_backend_pid()', id)).text
        }
        const refused = (text: string) => text.startsWith('Failed: ') && UNTRUSTED_CA.test(text)
        return { actual: live, pass: rowsOf(live.require)?.[0]?.ssl === true && refused(live['verify-full']) && refused(live['verify-ca']) }
      } finally {
        await dropExtras()
      }
    },
  )

  check(
    'K10b',
    "With a trusted CA, TLS is checked as libpq's sslmode says, by the DSN's name even though the gateway connects to the checked IP",
    'verify-full: right name ok, wrong name fails, untrusted CA fails; verify-ca: wrong name ok, untrusted CA fails',
    async () => {
      const scratch = mkdtempSync('/tmp/fm-tls-')
      try {
        const tls = (host: string, mode: string, trustCa: boolean) =>
          tlsProbe(scratch, `postgres://openhut_agent:${agentPassword}@${host}:5432/postgres?sslmode=${mode}`, trustCa)
        const k10 = {
          fullRightName: await tls('teamdb.test', 'verify-full', true),
          fullWrongName: await tls('wrong.test', 'verify-full', true),
          caWrongName: await tls('wrong.test', 'verify-ca', true),
          fullUntrusted: await tls('teamdb.test', 'verify-full', false),
          caUntrusted: await tls('teamdb.test', 'verify-ca', false),
        }
        const untrusted = (text: string) => text.startsWith('error ') && UNTRUSTED_CA.test(text)
        return {
          actual: k10,
          pass:
            k10.fullRightName === 'ok [{"ssl":true}]' &&
            k10.caWrongName === 'ok [{"ssl":true}]' &&
            /^error .*(altnames|Hostname)/i.test(k10.fullWrongName) &&
            untrusted(k10.fullUntrusted) &&
            untrusted(k10.caUntrusted),
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    },
  )

  check(
    'D6',
    'Every tool call leaves exactly one audit row with its outcome',
    'one row per call the run made, per agent and outcome (activity.json)',
    async () => {
      const devEvents = await events(call, { agentId: dev.id })
      const salesEvents = await events(call, { agentId: sales.id })
      writeFileSync(`${RESULTS}/activity.json`, JSON.stringify({ dev: devEvents, sales: salesEvents }, null, 2))
      const got = { dev: count(devEvents.map((e) => e.outcome)), sales: count(salesEvents.map((e) => e.outcome)) }
      const want = { dev: expectedEvents[dev.id] ?? {}, sales: expectedEvents[sales.id] ?? {} }
      return { actual: { got, want }, pass: isDeepStrictEqual(got, want) }
    },
  )

  check('F1', "Runs as uid 10000 on gVisor's kernel", 'uid 10000, /proc/version says gvisor', async () => {
    iso = await isolation(sales, dev)
    writeFileSync(`${RESULTS}/isolation-probe-sales.json`, JSON.stringify({ probe: iso.probe, matrix: iso.rows }, null, 2))
    return { actual: `uid=${iso.probe.uid} ${iso.probe.kernel}`, pass: iso.probe.uid === 10000 && /gvisor/i.test(iso.probe.kernel) }
  })

  check(
    'F2',
    "Can't write, or rename away, its config, .env, SOUL.md, hooks, plugins, channel approvals, Claude settings or CLI, or the root FS",
    'every write and every rename fails',
    async () => {
      const { writable, renamable } = iso.probe
      return { actual: { writable, renamable }, pass: Object.values(writable).every((w) => w === false) && Object.values(renamable).every((w) => w === false) }
    },
  )

  check('F3', 'No capabilities, no Docker socket, no agentd socket', 'CapEff 0, both false', async () => {
    const p = iso.probe
    return { actual: { capeff: p.capeff, docker: p.docker_sock, agentd: p.agentd_sock }, pass: /^0+$/.test(p.capeff) && !p.docker_sock && !p.agentd_sock }
  })

  check(
    'F4',
    'Network: the gateway, DNS to its resolver and the internet on 443 only; everything else is blocked though the server reaches it',
    'matrix in isolation-probe-sales.json all ok: every blocked target times out from the agent (dropped, not reset), including the LAN and metadata stand-ins on 443 and a listener on the server itself, while the server reaches each one',
    async () => {
      fw = await firewall()
      writeFileSync(`${RESULTS}/firewall.txt`, Object.values(fw).join('\n\n') + '\n')
      return { actual: iso.rows.map((r) => `${r.target}: ${r.agent}/${r.from_server}${r.ok ? '' : ' ✗'}`), pass: iso.pass }
    },
  )

  check('F8', 'agentd proves the fence itself when it starts', "fence report ok on gvisor with exactly six checks: the server's private address, metadata and tailnet address on 443, and a listener agentd holds open on the server for the run, each dropped (a connect timeout; a reset or any answer fails); public HTTPS and the gateway answer", async () => {
    const report = (await agentdAsk('fence')) as AgentdReplies['fence']
    writeFileSync(`${RESULTS}/fence.json`, JSON.stringify(report, null, 2))
    const names = report.checks.map((c) => c.name)
    return {
      actual: { ok: report.ok, sandbox: report.sandbox, checks: report.checks.map((c) => `${c.pass ? 'pass' : 'FAIL'} ${c.name} ${c.expect}: ${c.got}`) },
      pass: report.ok && report.sandbox === 'gvisor' && isDeepStrictEqual(names, FENCE_CHECKS) && report.checks.every((c) => c.pass),
    }
  })

  check('S1', 'The sandbox contract suite passes on the real gVisor implementation', 'node --test contract.test.ts with OPENHUT_SANDBOX=gvisor: every test passes (# tests equals # pass), 0 fail, 0 skipped', async () => {
    const out = await shell(`cd ${OPENHUT}/packages/runtime && OPENHUT_SANDBOX=gvisor timeout 300 node --test --test-reporter=tap test/agentd/sandbox/contract.test.ts 2>&1; true`)
    writeFileSync(`${RESULTS}/contract-gvisor.txt`, out + '\n')
    const count = (name: string) => Number(out.match(new RegExp(`^# ${name} (\\d+)`, 'm'))?.[1] ?? -1)
    const actual = { tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') }
    return { actual, pass: actual.tests > 0 && actual.pass === actual.tests && actual.fail === 0 && actual.skipped === 0 }
  })

  check('F6', "The gateway trusts only the agent's own token", "Dev's token: 200; Dev's id with a forged signature: 401", async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    const token = agentToken(dev.id)
    const own = await gwRaw(dev, token, list)
    const forged = await gwRaw(dev, `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`, list)
    return { actual: `own ${own.status}; forged ${forged.status}`, pass: own.status === 200 && forged.status === 401 }
  })

  check(
    'F7',
    "Only agents reach the gateway port; other containers on the server don't",
    "from the team DB's network: 8081 gets no HTTP answer at all (only 8081 is tested here; 8787 listens on loopback only, see A2)",
    async () => {
      const gateway = await docker('exec', 'teamdb', 'sh', '-c', `wget -S -T 3 -O /dev/null http://172.30.0.1:8081/health 2>&1 | grep -q 'HTTP/' && echo open || echo blocked`)
      return { actual: { gateway_8081: gateway }, pass: gateway === 'blocked' }
    },
  )

  check('R6', 'Only the enrolled key sees or drives an agent\'s browser', 'no key: the live view closes with 4401 before sending anything', async () => {
    const view = await openLive(`/api/browsers/${dev.id}/live`, '')
    const refused = await view.closed
    return { actual: { ...refused, lines: view.lines.length }, pass: refused.code === 4401 && view.lines.length === 0 }
  })

  check(
    'CH1',
    'Slack: the app checks the bot token with Slack before saving anything',
    'slack.com answers invalid_auth: 400 on botToken; no channel saved',
    async () => {
      const badSlack = await api<Channel>(
        'POST',
        '/api/channels',
        {
          kind: 'slack',
          agentId: dev.id,
          botToken: 'xoxb-1111-2222-notarealtoken',
          appToken: 'xapp-1-A111-2222-notarealtoken',
          configToken: 'xoxe.xoxp-1-notarealtoken',
          icon: 'iVBORw0KGgo=',
        },
        KEY,
      )
      const saved = (await call<List<Channel>>('list_channels', { agentId: dev.id })).data.length
      return {
        actual: { status: badSlack.status, param: badSlack.json.error?.param, message: badSlack.json.error?.message, saved },
        pass: badSlack.status === 400 && badSlack.json.error?.param === 'botToken' && /invalid_auth/.test(badSlack.json.error?.message ?? '') && saved === 0,
      }
    },
  )

  check(
    'CH2',
    "WhatsApp: linking shows a real pairing code from WhatsApp, fetched through the agent's own firewall",
    "channel linking; .env has bot mode with the owner and the allowed number; approvals are off; a WhatsApp pairing payload (2@… or a https://wa.me/… link) within 2 min",
    async () => {
      const created = await api<Channel>(
        'POST',
        '/api/channels',
        { kind: 'whatsapp', agentId: dev.id, ownerAddress: '+15551234567', open: false, allowed: ['+15557654321'] },
        KEY,
      )
      whatsapp = created.json.id
      await waitReady(dev)
      const env = readFileSync(`/data/agent-conf/${dev.id}/.env`, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('WHATSAPP_'))
      const approvals = readFileSync(`/data/agent-conf/${dev.id}/config.yaml`, 'utf8').match(/approvals:\n {2}mode: (.*)/)?.[1]
      let qr = ''
      let error = ''
      await until(
        async () => {
          const channel = await api<Channel>('GET', `/api/channels/${whatsapp}`, undefined, KEY)
          qr = channel.json.qr ?? ''
          error = channel.json.error?.message ?? ''
          return !!qr || !!error
        },
        120_000,
        'a WhatsApp pairing code',
      )
      return {
        actual: { status: created.json.status, env, approvals, qr: qr ? `${qr.slice(0, 12)}…` : error },
        pass:
          created.json.status === 'linking' &&
          env.includes('WHATSAPP_MODE=bot') &&
          env.includes('WHATSAPP_ALLOWED_USERS=15551234567,15557654321') &&
          approvals === '"off"' &&
          WHATSAPP_PAIRING.test(qr),
      }
    },
  )

  check(
    'CH3',
    'Unlinking WhatsApp stops pairing, deletes the session and turns WhatsApp off',
    'deleted; no session files; no WHATSAPP_ lines in .env',
    async () => {
      const unlinked = await api<Deleted<'channel'>>('DELETE', `/api/channels/${whatsapp}`, undefined, KEY)
      await waitReady(dev)
      const session = await shell(`ls /data/agents/${dev.id}/platforms/whatsapp/session 2>/dev/null | wc -l`)
      const enabled = readFileSync(`/data/agent-conf/${dev.id}/.env`, 'utf8').includes('WHATSAPP_ENABLED')
      return { actual: { deleted: unlinked.json.deleted, session, env: enabled }, pass: unlinked.json.deleted === true && session.trim() === '0' && !enabled }
    },
  )

  check(
    'U2',
    'Every agent has the pinned Claude CLI and the seat plugin, read-only',
    "claude --version is install.sh's CLAUDE= pin; hermes plugins list shows claude-subscription-directsdk",
    async () => {
      const pin = readFileSync(`${OPENHUT}/install/install.sh`, 'utf8').match(/^CLAUDE=(\S+)/m)?.[1]
      const cli = await docker('exec', '-u', '10000:10000', `ag-${dev.id}`, 'claude', '--version').catch((e) => failure(e))
      const plugins = await docker('exec', '-u', '10000:10000', '-e', 'COLUMNS=250', `ag-${dev.id}`, '/opt/hermes/bin/hermes', 'plugins', 'list').catch((e) =>
        failure(e, 'stdout'),
      )
      const plugin = plugins.split('\n').find((l) => l.includes('claude-subscription-directsdk'))
      return { actual: { pin, cli, plugin: plugin?.replace(/\s+/g, ' ').trim() ?? 'not listed' }, pass: !!pin && cli.split(' ')[0] === pin && !!plugin }
    },
  )

  check(
    'U3',
    "The owner sets the Claude seat over the control MCP; it's sealed and never shown",
    'update_admin answers seat.set true; get_admin agrees; the token is in no reply (test mode keeps it out of .env)',
    async () => {
      const updated = await call<Admin>('update_admin', { seatToken })
      const admin = await call<Admin>('get_admin')
      const replies = [updated, admin, await call('get_agent', { id: dev.id }), await call('list_agents')].map((r) => JSON.stringify(r))
      const leak = [...replies, readFileSync(`/data/agent-conf/${dev.id}/.env`, 'utf8')].some((s) => s.includes(seatToken))
      const outcome = { actual: { updated: updated.seat, admin: admin.seat, leak }, pass: updated.seat?.set === true && admin.seat?.set === true && !leak }
      await waitReady(dev)
      return outcome
    },
  )

  check(
    'X1',
    'No real secret inside any agent: the seat stays in the gateway',
    "grep -a (binary files too) finds no sk-ant-oat01 in Dev's or Sales's /opt/data, their container env (docker inspect and /proc/1/environ), nor any agent's rendered files. This run is in test mode; that claude mode renders only the agent's own token as the stand-in is the hermes-files unit test",
    async () => {
      const inside = async (a: AgentRef) => {
        const files = (await docker('exec', `ag-${a.id}`, 'sh', '-c', 'grep -rlaF sk-ant-oat01 /opt/data 2>/dev/null; true')).trim()
        const env = (await docker('inspect', '-f', '{{json .Config.Env}}', `ag-${a.id}`)) + (await docker('exec', `ag-${a.id}`, 'cat', '/proc/1/environ'))
        return `${files}${env.includes('sk-ant-oat01') ? ' env' : ''}`.trim()
      }
      const found = { dev: await inside(dev), sales: await inside(sales), conf: (await shell('grep -rlaF sk-ant-oat01 /data/agent-conf 2>/dev/null; true')).trim() }
      return { actual: found, pass: !found.dev && !found.sales && !found.conf }
    },
  )

  check(
    'X2',
    "An agent's own token reaches the seat through the gateway; nothing else does",
    "Dev's token on /u/anthropic: 200 and the test model's reply (it answers only the real seat); forged token 401; /v1/models 403; Telegram logOut 403, and percent-encoded log%4Fut 403; an audit row; the seat meter reads the reply's rate-limit headers",
    async () => {
      const token = agentToken(dev.id)
      const ask = { model: 'sonnet', max_tokens: 10, messages: [{ role: 'user', content: 'hello broker' }] }
      const own = await viaBroker(dev, { token, method: 'POST', path: '/u/anthropic/v1/messages', body: ask })
      const forged = await viaBroker(dev, { token: `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`, method: 'POST', path: '/u/anthropic/v1/messages', body: ask })
      const models = await viaBroker(dev, { token, method: 'GET', path: '/u/anthropic/v1/models' })
      const logOut = await viaBroker(dev, { token, method: 'POST', path: `/u/telegram/bot${token}/logOut` })
      const encoded = await viaBroker(dev, { token, method: 'POST', path: `/u/telegram/bot${token}/log%4Fut` })
      const audited = (await events(call, { agentId: dev.id })).find((e) => e.tool === 'anthropic POST /v1/messages')
      const usage = await asOwner<{ windows: { kind: string; percent: number }[] }>('GET', '/api/admin/seat-usage')
      const actual = {
        own: `${own.status} ${messageText(own.body)}`, forged: forged.status, models: models.status, logOut: logOut.status, encoded: encoded.status,
        audit: audited && `${audited.outcome} ${audited.reason}`, meter: usage.json.windows?.map((w) => `${w.kind} ${w.percent}%`).join(', '),
      }
      return {
        actual,
        pass: own.status === 200 && messageText(own.body) === 'ECHO: hello broker' && forged.status === 401 && models.status === 403 && logOut.status === 403 && encoded.status === 403 &&
          actual.audit === 'allowed HTTP 200' && actual.meter === 'five_hour 12%, seven_day 34%',
      }
    },
  )

  check(
    'X3',
    'Rotating the seat restarts nothing; the next call uses the new seat',
    "update_admin with a new token: Dev's container keeps its StartedAt and .env; /u/anthropic answers 200 with the new seat",
    async () => {
      const before = { started: await startedAt(dev.id), env: readFileSync(`/data/agent-conf/${dev.id}/.env`, 'utf8') }
      await call<Admin>('update_admin', { seatToken: `sk-ant-oat01-${randomBytes(24).toString('hex')}` })
      const after = { started: await startedAt(dev.id), env: readFileSync(`/data/agent-conf/${dev.id}/.env`, 'utf8') }
      const reply = await viaBroker(dev, { token: agentToken(dev.id), method: 'POST', path: '/u/anthropic/v1/messages', body: { model: 'sonnet', max_tokens: 10, messages: [{ role: 'user', content: 'after rotation' }] } })
      return {
        actual: { sameStart: before.started === after.started, sameEnv: before.env === after.env, reply: `${reply.status} ${messageText(reply.body)}` },
        pass: before.started === after.started && before.env === after.env && reply.status === 200 && messageText(reply.body) === 'ECHO: after rotation',
      }
    },
  )

  check(
    'X4',
    "Revoking one agent's token: the old one fails at once, the restarted agent holds a new one that works",
    "revoke_agent_token on Dev: the old token 401 on /u/anthropic right away; Dev restarted; config.yaml has a new token that gets 200",
    async () => {
      const old = agentToken(dev.id)
      const startedBefore = await startedAt(dev.id)
      const ask = { model: 'sonnet', max_tokens: 10, messages: [{ role: 'user', content: 'after revoke' }] }
      await call('revoke_agent_token', { id: dev.id })
      const oldReply = await viaBroker(dev, { token: old, method: 'POST', path: '/u/anthropic/v1/messages', body: ask })
      const fresh = agentToken(dev.id)
      await waitReady(dev)
      const newReply = await viaBroker(dev, { token: fresh, method: 'POST', path: '/u/anthropic/v1/messages', body: ask })
      const restarted = startedBefore !== (await startedAt(dev.id))
      return {
        actual: { old: oldReply.status, fresh: newReply.status, changed: old !== fresh, restarted },
        pass: oldReply.status === 401 && newReply.status === 200 && old !== fresh && restarted,
      }
    },
  )

  check(
    'G1',
    'Stop and start keep the same container, and the agent answers again',
    'exited, then running; same container id; API server answers within 2 min',
    async () => {
      const before = await idOf(sales.id)
      await call('update_agent', { id: sales.id, wanted: 'stopped' })
      const stopped = await statusOf(sales.id)
      await call('update_agent', { id: sales.id, wanted: 'running' })
      const t1 = Date.now()
      const restarted = await statusOf(sales.id)
      const afterId = await idOf(sales.id)
      await waitReady(sales, 120_000)
      return {
        actual: `${stopped} -> ${restarted}; same id: ${before === afterId}; answers after ${Math.round((Date.now() - t1) / 1000)} s`,
        pass: stopped === 'exited' && restarted === 'running' && before === afterId,
      }
    },
  )

  check(
    'G2',
    'Editing instructions restarts the agent, which then sees and answers with them',
    'new StartedAt; SOUL.md inside the container has v2; replies "ECHO: hello again"',
    async () => {
      const startedBefore = await startedAt(dev.id)
      await call('update_agent', { id: dev.id, instructions: '# Dev\nUpdated instructions v2.' })
      const startedAfter = await startedAt(dev.id)
      const soul = await docker('exec', `ag-${dev.id}`, 'cat', '/opt/data/SOUL.md')
      await waitReady(dev)
      const reply = await chat(dev, 'hello again')
      return {
        actual: { restarted: startedBefore !== startedAfter, soul, reply },
        pass: startedBefore !== startedAfter && soul.includes('v2') && reply === 'ECHO: hello again',
      }
    },
  )

  check('G3', 'Delete removes the container, the network and both folders', 'all empty', async () => {
    await call('delete_agent', { id: sales.id })
    const gone = {
      container: await docker('ps', '-aq', '--filter', `name=ag-${sales.id}`),
      network: await docker('network', 'ls', '-q', '--filter', `name=ag-${sales.id}`),
      folders: await shell(`ls -d /data/agents/${sales.id} /data/agent-conf/${sales.id} 2>/dev/null || true`),
    }
    return { actual: gone, pass: !gone.container && !gone.network && !gone.folders }
  })

  check(
    'W1',
    'With the firewall gone, health fails and agentd refuses to start an agent',
    '/health 503 firewall:false; start refused "firewall is off"',
    async () => {
      await call('update_agent', { id: dev.id, wanted: 'stopped' })
      await sh('iptables', ['-D', ...DOCKER_USER_JUMP])
      await until(async () => (await health()).status === 503, 15_000, '/health to notice the missing jump')
      const h = await health()
      const refused = await call('update_agent', { id: dev.id, wanted: 'running' }).then(
        () => 'started',
        (e) => failure(e),
      )
      return { actual: { health: h, start: refused }, pass: h.status === 503 && h.firewall === false && /firewall is off/.test(refused) }
    },
  )

  check(
    'W2',
    'Within 30 s agentd puts the firewall back; the app then starts the agent that should be running',
    'health ok again; agentd.log "re-applied the firewall"; Dev running and answering',
    async () => {
      await until(async () => (await health()).ok === true, 45_000, '/health to be ok again')
      await until(async () => (await statusOf(dev.id)) === 'running', 45_000, 'Dev to run again')
      await waitReady(dev, 120_000)
      const log = await shell('tail -n 50 /var/log/openhut/agentd.log')
      return {
        actual: log
          .split('\n')
          .filter((l) => /watchdog/.test(l))
          .slice(-2),
        pass: /re-applied the firewall/.test(log),
      }
    },
  )

  check(
    'W2b',
    'One missing rule is noticed and repaired too, in the right order',
    "after deleting AGENT-IN's agent DROP: health 503; within 30 s health ok and the chains identical to firewall.txt",
    async () => {
      await sh('iptables', ['-D', 'AGENT-IN', '-s', AGENTS_NET, '-j', 'DROP'])
      await until(async () => (await health()).status === 503, 15_000, '/health to notice the missing rule')
      await until(async () => (await health()).ok === true, 45_000, '/health to be ok again')
      const now = await firewall()
      return { actual: { identical: isDeepStrictEqual(now, fw) }, pass: isDeepStrictEqual(now, fw) }
    },
  )

  check(
    'W2c',
    'A rule slipped above a jump is noticed, and the jump goes back to the top',
    "after inserting an ACCEPT above INPUT's jump: health 503; within 30 s health ok and INPUT's first rule is the jump",
    async () => {
      const accept = ['-s', AGENTS_NET, '-j', 'ACCEPT']
      await sh('iptables', ['-I', 'INPUT', '1', ...accept])
      try {
        await until(async () => (await health()).status === 503, 15_000, '/health to notice the rule above the jump')
        await until(async () => (await health()).ok === true, 45_000, '/health to be ok again')
        const first = await shell('iptables -S INPUT | sed -n 2p')
        return { actual: { first }, pass: first === '-A INPUT -j AGENT-IN' }
      } finally {
        await sh('iptables', ['-D', 'INPUT', ...accept])
      }
    },
  )

  check(
    'K11',
    "One agent can't tie up the app",
    '30 connections with unfinished headers: at most 16 get through; 12 slow 900 KB uploads: all but 8 get 429; the app answers meanwhile; afterwards the agent works again',
    async () => {
      const [floodOutput, during] = await Promise.all([
        asAgent(dev, FLOOD, { GW: `10.200.${dev.net}.1`, TOKEN: agentToken(dev.id) }),
        sleep(22_000).then(() => health()),
      ])
      const flood: Flood = JSON.parse(floodOutput)
      const afterwards = (await gwRaw(dev, agentToken(dev.id), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status
      return {
        actual: { ...flood, healthDuring: during.status, afterwards },
        pass:
          flood.headersHeld <= 16 &&
          flood.headersRefused >= 14 &&
          flood.got429 >= flood.bodies - 8 &&
          flood.got429 >= 4 &&
          during.status === 200 &&
          afterwards === 200,
      }
    },
  )

  check(
    'K12',
    "The gateway refuses a body over 1 MB and cuts off headers that don't finish in 10 s",
    '2 MB body: 413; unfinished headers: 408 or closed after 10–15 s',
    async () => {
      const limits: Limits = JSON.parse(await asAgent(dev, LIMITS, { GW: `10.200.${dev.net}.1`, TOKEN: agentToken(dev.id) }))
      return {
        actual: limits,
        pass:
          /\b413\b/.test(limits.bigBody) && (/\b408\b/.test(limits.slowHeaders) || limits.slowHeaders === 'closed') && limits.after >= 10 && limits.after <= 15,
      }
    },
  )

  check(
    'W3',
    "If the firewall can't be put back, agentd stops every agent; once it's back they start again",
    'agentd.log "stopped 1 agents"; Dev exited, health 503; after the fix: health ok, Dev running and answering',
    async () => {
      let healthWhileBroken = 0
      await shell(`chmod 0644 ${FIREWALL_SCRIPT}`)
      try {
        await sh('iptables', ['-D', ...DOCKER_USER_JUMP])
        await until(async () => (await statusOf(dev.id)) === 'exited', 45_000, 'agentd to stop Dev')
        healthWhileBroken = (await health()).status
      } finally {
        await shell(`chmod 0755 ${FIREWALL_SCRIPT}`)
      }
      await until(async () => (await health()).ok === true, 45_000, '/health to be ok again')
      await until(async () => (await statusOf(dev.id)) === 'running', 45_000, 'Dev to run again')
      await waitReady(dev, 120_000)
      const log = await shell('tail -n 50 /var/log/openhut/agentd.log')
      return {
        actual: {
          health: healthWhileBroken,
          log: log
            .split('\n')
            .filter((l) => /stopped \d+ agents/.test(l))
            .slice(-1),
        },
        pass: healthWhileBroken === 503 && /stopped 1 agents/.test(log),
      }
    },
  )

  after(async () => {
    writeFileSync(`${OPENHUT}/packages/runtime/src/server/only-in-the-previous-release.ts`, '')
    const state: Partial<State> = {
      dev: await settled(async () => ({ id: dev.id, net: dev.net })),
      conn: await settled(async () => conn.id),
      envSha: await settled(async () => sha(readFileSync('/etc/openhut/env', 'utf8'))),
      pin: await settled(async () => agentImagePin()),
      fw,
      devContainer: await settled(() => idOf(dev.id)),
      reconciled: await settled(async () => reconcileCount(dev.id)),
      build: await settled(async () => (await health()).build),
      pids: await settled(async () => ({ agentd: await pidOf(AGENTD_PROCESS), app: await pidOf(APP_PROCESS) })),
      devStarted: await settled(() => startedAt(dev.id)),
    }
    writeFileSync(`${RESULTS}/state.json`, JSON.stringify(state))
  })
}

function afterUpgrade() {
  check(
    'I0',
    'The installer refuses a tampered download and changes nothing',
    'the upgrade from a mirror whose openhut.tgz has one byte changed: "checksum mismatch", exit 1, still build e2e-1',
    async () => {
      const tamper = stripVTControlCharacters(readFileSync(`${RESULTS}/tamper.log`, 'utf8'))
      return {
        actual: tamper
          .trim()
          .split('\n')
          .filter((l) => /mismatch|exit=|BUILD/.test(l)),
        pass: /checksum mismatch: \S*openhut\.tgz/.test(tamper) && /installer exit=1/.test(tamper) && /^BUILD e2e-1$/m.test(tamper),
      }
    },
  )

  check(
    'I1',
    'Adding a computer that already runs this build pairs instead of reinstalling; the new key replaces the old one',
    'the same build with a new key: "Pairing with this computer", no Packages step, the replaced-key line; the first key 401 and the new one 200; adding the first key back: 200 and 401',
    async () => {
      const log = stripVTControlCharacters(readFileSync(`${RESULTS}/re-add.log`, 'utf8'))
      return {
        actual: log.trim().split('\n').filter((l) => /Pairing|Packages|new app key|first key/.test(l)),
        pass:
          (log.match(/==> Pairing with this computer/g) ?? []).length === 2 &&
          !/==> Packages/.test(log) &&
          (log.match(/A new app key/g) ?? []).length === 2 &&
          /^first key 401, new key 200$/m.test(log) &&
          /^first key again 200, new key 401$/m.test(log),
      }
    },
  )

  check(
    'UP1',
    "Re-running the curl command upgrades in place, keeps the settings, and agentd follows the new release's image pin",
    '"OpenHut is running"; /etc/openhut/env unchanged (OPENHUT_MODEL=test though not passed, no AGENT_IMAGE stored); the new pin names the same image as docker.io/…, and agentd runs with exactly that',
    async () => {
      const st = savedState()
      const log = stripVTControlCharacters(readFileSync(`${RESULTS}/upgrade.log`, 'utf8'))
      const env = readFileSync('/etc/openhut/env', 'utf8')
      const pin = agentImagePin()
      const h = await health()
      const agentd = (await agentdHealth()).image
      return {
        actual: {
          done: log.includes('OpenHut is running'),
          envUnchanged: sha(env) === st.envSha,
          model: env.match(/OPENHUT_MODEL=\S+/)?.[0],
          imageStored: /AGENT_IMAGE=/.test(env),
          pin,
          agentd,
        },
        pass:
          log.includes('OpenHut is running') &&
          sha(env) === st.envSha &&
          /OPENHUT_MODEL=test/.test(env) &&
          !/AGENT_IMAGE=/.test(env) &&
          pin === `docker.io/${st.pin}` &&
          agentd === pin &&
          h.ok === true,
      }
    },
  )

  check(
    'UP2',
    'The new release replaced the old: new build, new processes, nothing left behind',
    "/health build e2e-2 (was e2e-1); 1 agentd and 1 app with new PIDs, 2 supervisors; the previous release's extra file gone",
    async () => {
      const st = savedState()
      const pids = { agentd: await pidOf(AGENTD_PROCESS), app: await pidOf(APP_PROCESS), supervisors: await pidOf(`^/bin/sh ${OPENHUT}/install/supervise.sh`) }
      const h = await health()
      const leftover = await shell(`ls ${OPENHUT}/packages/runtime/src/server/only-in-the-previous-release.ts 2>&1 || true`)
      return {
        actual: { build: `${st.build} -> ${h.build}`, pids: { before: st.pids, after: pids }, leftover },
        pass:
          h.status === 200 &&
          h.agentd === true &&
          h.build === 'e2e-2' &&
          st.build === 'e2e-1' &&
          readFileSync(`${OPENHUT}/BUILD`, 'utf8').trim() === 'e2e-2' &&
          processCount(pids.agentd) === 1 &&
          processCount(pids.app) === 1 &&
          processCount(pids.supervisors) === 2 &&
          pids.agentd !== st.pids.agentd &&
          pids.app !== st.pids.app &&
          /No such file/.test(leftover),
      }
    },
  )

  check(
    'UP3',
    'Data, tokens and agents survive the upgrade; the new release restarts running agents once, so they mount its files',
    'token works; Dev in the same container; a build.applied e2e-1 -> e2e-2 event in app.log; Dev restarted with its instructions intact and its plugin folder present, and still answers from the team DB (n = 42); the enrolled key still works',
    async () => {
      const st = savedState()
      const call = await mcp(KEY)
      await until(async () => (await startedAt(st.dev.id)) !== st.devStarted, 60_000, 'Dev to restart on the new build')
      await waitReady(st.dev, 180_000)
      const agents = (await call<List<Agent>>('list_agents')).data
      const sameContainer = (await idOf(st.dev.id)) === st.devContainer
      const soul = await docker('exec', `ag-${st.dev.id}`, 'cat', '/opt/data/SOUL.md')
      const plugin = await docker('exec', `ag-${st.dev.id}`, 'ls', '/opt/data/plugins/claude-subscription-directsdk/inert_mcp.py').catch((e) =>
        failure(e).trim(),
      )
      const rebuilt = appEvents().some((e) => e.event === 'build.applied' && e.from === 'e2e-1' && e.to === 'e2e-2')
      const reply = inner(await chat(st.dev, 'sql: select count(*)::int as n from orders'))
      const ownerKept = (await api<Me>('GET', '/api/me', undefined, KEY)).status === 200
      return {
        actual: { agents: agents.map((a) => `${a.name}:${a.status}`), sameContainer, rebuilt, soul, plugin, reply, ownerKept },
        pass:
          agents.some((a) => a.id === st.dev.id && a.status === 'running') &&
          sameContainer &&
          rebuilt &&
          soul.includes('Updated instructions v2.') &&
          plugin.endsWith('inert_mcp.py') &&
          rowsOf(reply)?.[0]?.n === 42 &&
          ownerKept,
      }
    },
  )
}

function afterRestart() {
  check(
    'RC1',
    'A server that restarts in the middle of an update puts the previous release back before anything starts',
    '/opt/openhut is the copy left in /opt/openhut.old (it carries RECOVERED), no /opt/openhut.old or .failed is left, /etc/openhut/recover.sh is there, /health ok',
    async () => {
      const recovered = await shell('[ -f /opt/openhut/RECOVERED ] && echo yes || echo no')
      const leftovers = await shell('ls -d /opt/openhut.* 2>/dev/null || true')
      const script = await shell('[ -f /etc/openhut/recover.sh ] && echo yes || echo no')
      const now = await health()
      await shell('rm -f /opt/openhut/RECOVERED')
      return { actual: { recovered, leftovers, script, ok: now.ok }, pass: recovered === 'yes' && leftovers === '' && script === 'yes' && now.ok === true }
    },
  )
  check(
    'H1',
    'After a restart the firewall is up before dockerd, and the agent starts after both',
    'boot.log lines in order: firewall, dockerd launching, dockerd up, firewall reapplied, agentd and app; Dev started at least 1 s after the firewall was reapplied (marks have 1 s precision)',
    async () => {
      const st = savedState()
      await until(async () => (await statusOf(st.dev.id)) === 'running', 60_000, 'Dev to run again')
      await waitReady(st.dev, 180_000)
      const boot = readFileSync('/var/log/openhut/boot.log', 'utf8').trim().split('\n')
      const launched = boot.findLastIndex((l) => l.endsWith(' dockerd launching'))
      const start = boot.slice(0, launched).findLastIndex((l) => l.endsWith(' boot'))
      const next = boot.findIndex((l, i) => i > launched && l.endsWith(' boot'))
      const last = boot.slice(start, next < 0 ? boot.length : next)
      const at = (mark: string) => last.find((l) => l.endsWith(` ${mark}`))?.split(' ')[0] ?? ''
      const order = ['firewall applied', 'dockerd launching', 'dockerd up', 'firewall reapplied', 'agentd and app started'].map((mark) =>
        last.findIndex((l) => l.endsWith(` ${mark}`)),
      )
      const devStarted = (await startedAt(st.dev.id)).replace(/(\.\d{3})\d+/, '$1')
      return {
        actual: { boot: last, devStarted },
        pass:
          order.every((i) => i >= 0) &&
          order.every((v, i) => i === 0 || order[i - 1] < v) &&
          new Date(devStarted).getTime() >= new Date(at('firewall reapplied')).getTime() + 1000,
      }
    },
  )

  check(
    'H2',
    'The firewall after the restart is exactly the one tested before it, and health reports it',
    'AGENT, AGENT-IN, both jumps and the ip rule identical to firewall.txt; /health 200 {ok: true, agentd: true, firewall: true}',
    async () => {
      const st = savedState()
      const now = await firewall()
      const h = await health()
      return {
        actual: { same: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v === st.fw[k]])), health: h },
        pass: isDeepStrictEqual(now, st.fw) && h.status === 200 && h.ok && h.agentd && h.firewall,
      }
    },
  )

  check(
    'H3',
    'OpenHut (not Docker) brings the agent back, and it still reaches the DB through the gateway',
    'Dev running and answering within 4 min, n = 42 from the team DB; restart policy no; a new reconcile.started event for Dev in app.log',
    async () => {
      const st = savedState()
      const call = await mcp(KEY)
      await waitReady(st.dev)
      const agents = (await call<List<Agent>>('list_agents')).data
      const reply = inner(await chat(st.dev, 'sql: select count(*)::int as n from orders'))
      const restart = await docker('inspect', '-f', '{{.HostConfig.RestartPolicy.Name}}', `ag-${st.dev.id}`)
      const reconciled = reconcileCount(st.dev.id)
      return {
        actual: { agents: agents.map((a) => `${a.name}:${a.status}`), reply, restart, reconcileLines: `${st.reconciled} before, ${reconciled} now` },
        pass:
          agents.some((a) => a.id === st.dev.id && a.status === 'running') &&
          rowsOf(reply)?.[0]?.n === 42 &&
          restart === 'no' &&
          reconciled > st.reconciled,
      }
    },
  )

  check('H5', 'Isolation holds after the restart (same probe, from Dev)', 'matrix all ok', async () => {
    const iso = await isolation(savedState().dev)
    writeFileSync(`${RESULTS}/isolation-probe-dev-after-restart.json`, JSON.stringify({ probe: iso.probe, matrix: iso.rows }, null, 2))
    return { actual: iso.rows.map((x) => `${x.target}: ${x.agent}/${x.from_server}${x.ok ? '' : ' ✗'}`), pass: iso.pass }
  })
}

function updateBroken() {
  check(
    'UD1',
    "Update now with a release whose app can't start: the previous release comes back and Admin says the update failed",
    'POST /api/updates 200 running, to e2e-broken; a second POST 409; then the same build as before, /health ok, Admin update failed with the installer\'s reason, the data copy taken before the swap, the install lock free, no /opt/openhut.* left, Dev running',
    async () => {
      const st = savedState()
      const before = await health()
      const started = await asOwner<Update>('POST', '/api/updates')
      const twice = await asOwner('POST', '/api/updates')
      await until(async () => (await asOwner<Admin>('GET', '/api/admin')).json.server.update?.status === 'failed', 20 * 60_000, 'Admin to report the failed update')
      await until(async () => (await statusOf(st.dev.id)) === 'running', 180_000, 'Dev to run again')
      const admin = (await asOwner<Admin>('GET', '/api/admin')).json
      const now = await health()
      const lock = await shell('flock -n /run/openhut-install.lock true && echo free || echo held')
      const leftovers = await shell('ls -d /opt/openhut.* 2>/dev/null || true')
      const copy = await shell('[ -d /data/app.before-update ] && echo kept || echo missing')
      const reason = admin.server.update?.reason ?? null
      return {
        actual: { started: [started.status, started.json.status, started.json.to], twice: twice.status, build: `${before.build} -> ${now.build}`, ok: now.ok, update: admin.server.update?.status, reason, copy, lock, leftovers },
        pass:
          started.status === 200 && started.json.status === 'running' && started.json.to === 'e2e-broken' && twice.status === 409 &&
          now.build === before.build && now.ok === true && admin.server.update?.status === 'failed' && /previous one is running again/.test(reason ?? '') && copy === 'kept' && lock === 'free' && leftovers === '',
      }
    },
  )
}

function update() {
  check(
    'UD2',
    'Update now installs the new release; the status is kept on the server while it restarts, and everything is still there after',
    'POST /api/updates 200 to e2e-3; Admin says running right after; then build e2e-3, /health ok, no update left in Admin, nothing newer offered, Dev still there and running',
    async () => {
      const st = savedState()
      const started = await asOwner<Update>('POST', '/api/updates')
      const during = (await asOwner<Admin>('GET', '/api/admin')).json.server.update?.status
      await until(async () => { const h = await health(); return h.build === 'e2e-3' && h.ok }, 15 * 60_000, 'build e2e-3 to be healthy')
      await until(async () => (await statusOf(st.dev.id)) === 'running', 180_000, 'Dev to run again')
      const admin = (await asOwner<Admin>('GET', '/api/admin')).json
      const dev = await asOwner<Agent>('GET', `/api/agents/${st.dev.id}`)
      return {
        actual: { started: [started.status, started.json.to], during, build: admin.server.build, update: admin.server.update, updateAvailable: admin.server.updateAvailable, dev: dev.status },
        pass: started.status === 200 && started.json.to === 'e2e-3' && during === 'running' && admin.server.build === 'e2e-3' && admin.server.update === null && !admin.server.updateAvailable && dev.status === 200,
      }
    },
  )
}

async function asOwner<T = unknown>(method: string, path: string): Promise<{ status: number; json: T }> {
  const r = await fetch(APP + path, { method, headers: { authorization: `Bearer ${KEY}` } })
  return { status: r.status, json: JSON.parse(await r.text()) }
}

function check(id: string, what: string, expected: string, run: () => Promise<Outcome>) {
  test(`${id} ${what}`, async () => {
    const { actual, pass } = await run().catch((e: unknown) => ({ actual: e instanceof Error ? (e.stack ?? e.message) : String(e), pass: false }))
    const text = typeof actual === 'string' ? actual : String(JSON.stringify(actual))
    results.push({ id, check: what, expected, actual: text.slice(0, 600), pass })
    assert.ok(pass, `expected: ${expected}\nactual:   ${text.slice(0, 400)}`)
  })
}

async function until(check: () => Promise<boolean>, ms: number, what: string) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) if (await check().catch(() => false)) return
  throw new Error(`Gave up waiting ${ms / 1000} s for ${what}`)
}

async function api<T = unknown>(method: string, path: string, body?: unknown, key = ''): Promise<Reply<T>> {
  const r = await fetch(APP + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(key && { authorization: `Bearer ${key}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  try {
    return { status: r.status, json: JSON.parse(text) }
  } catch {
    throw new Error(`${method} ${path} answered ${r.status} without JSON: ${text.slice(0, 200)}`)
  }
}

async function mcp(key: string): Promise<Call> {
  const client = new Client({ name: 'e2e', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${APP}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } }))
  return async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const r = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
    const text = r.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('')
    if (r.isError) throw new Error(text)
    return JSON.parse(text)
  }
}

async function events(call: Call, filter: { agentId?: string; connectionId?: string }) {
  const all: ConnectionEvent[] = []
  let page: List<ConnectionEvent>
  do {
    const last = all.at(-1)
    page = await call<List<ConnectionEvent>>('list_connection_events', { ...filter, limit: 100, ...(last && { startingAfter: String(last.id) }) })
    all.push(...page.data)
  } while (page.hasMore && page.data.length)
  return all
}

async function health(): Promise<Health & { status: number }> {
  const r = await fetch(`${APP}/health`)
  const body: Health = JSON.parse(await r.text())
  return { ...body, status: r.status }
}

function agentdHealth() {
  return agentdAsk('health') as Promise<AgentdReplies['health']>
}

function agentdAsk(cmd: 'health' | 'fence') {
  return new Promise<unknown>((resolve, reject) => {
    const s = connect('/run/agentd/agentd.sock')
    let buf = ''
    s.setEncoding('utf8')
    s.on('data', (d) => (buf += d))
    s.on('end', () => {
      try {
        resolve(JSON.parse(buf))
      } catch (e) {
        reject(e)
      }
    })
    s.on('error', reject)
    s.end(JSON.stringify({ cmd }) + '\n')
  })
}

function savedState(): State {
  return JSON.parse(readFileSync(`${RESULTS}/state.json`, 'utf8'))
}

function agentImagePin() {
  return readFileSync(`${OPENHUT}/install/agent-image`, 'utf8').trim()
}

async function startTeamDb(dbPassword: string, agentPassword: string) {
  await docker('network', 'create', '--subnet', '172.30.0.0/24', 'teamdb')
  await shell(`rm -rf /root/pgcerts && mkdir /root/pgcerts && cd /root/pgcerts &&
    openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=e2e-ca -keyout ca.key -out ca.crt 2>/dev/null &&
    openssl req -newkey rsa:2048 -nodes -subj /CN=teamdb.test -keyout server.key -out server.csr 2>/dev/null &&
    printf 'subjectAltName=DNS:teamdb.test\\n' > ext && openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile ext -out server.crt 2>/dev/null &&
    chown 70:70 server.key server.crt && chmod 600 server.key && grep -q teamdb.test /etc/hosts || echo '172.30.0.10 teamdb.test wrong.test' >> /etc/hosts`)
  await docker(
    'run',
    ...['-d', '--name', 'teamdb', '--restart', 'unless-stopped', '--network', 'teamdb', '--ip', '172.30.0.10'],
    ...['-e', `POSTGRES_PASSWORD=${dbPassword}`, '-v', '/root/pgcerts:/certs:ro', 'postgres:16-alpine'],
    ...['-c', 'ssl=on', '-c', 'ssl_cert_file=/certs/server.crt', '-c', 'ssl_key_file=/certs/server.key'],
  )
  await until(
    async () => !!(await docker('exec', 'teamdb', 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres')),
    60_000,
    'the team DB to accept TCP connections',
  )
  await psql(`create table orders(id serial primary key, customer text, total numeric(10,2)); insert into orders(customer,total) select 'c'||g, g*10 from generate_series(1,42) g;
    create role openhut_agent login password '${agentPassword}'; grant select, insert, update, delete on orders to openhut_agent; grant usage, select, update on sequence orders_id_seq to openhut_agent;
    create role openhut_files login password '${agentPassword}'; grant pg_read_server_files to openhut_files;
    create role openhut_member login noinherit password '${agentPassword}'; grant postgres to openhut_member;`)
}

function psql(sql: string) {
  return docker('exec', 'teamdb', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql)
}

async function orderCount() {
  return (await psql('select count(*) from orders')).trim()
}

async function containerSpec(id: string) {
  const [ins]: ContainerInspect[] = JSON.parse(await docker('inspect', `ag-${id}`))
  const hc = ins.HostConfig
  return {
    image: ins.Config.Labels['agent.digest'] ?? '',
    runtime: hc.Runtime,
    user: ins.Config.User,
    readOnly: hc.ReadonlyRootfs,
    privileged: hc.Privileged,
    capDrop: hc.CapDrop,
    capAdd: hc.CapAdd,
    securityOpt: hc.SecurityOpt,
    pids: hc.PidsLimit,
    memory: hc.Memory,
    nanoCpus: hc.NanoCpus,
    restart: hc.RestartPolicy?.Name,
    networks: Object.keys(ins.NetworkSettings.Networks),
    ip: Object.values(ins.NetworkSettings.Networks)[0]?.IPAddress,
    tmpfs: Object.keys(hc.Tmpfs ?? {}).sort(),
    mounts: ins.Mounts.map((m) => `${m.Source} -> ${m.Destination}${m.RW ? '' : ' (ro)'}`).sort(),
  }
}

function idOf(id: string) {
  return docker('inspect', '-f', '{{.Id}}', `ag-${id}`)
}

function statusOf(id: string) {
  return docker('inspect', '-f', '{{.State.Status}}', `ag-${id}`)
}

function startedAt(id: string) {
  return docker('inspect', '-f', '{{.State.StartedAt}}', `ag-${id}`)
}

async function agentBrowser(a: AgentRef, ...args: string[]) {
  return (await sh('docker', ['exec', '-u', '10000:10000', `ag-${a.id}`, 'agent-browser', ...args], { maxBuffer: 8 << 20, timeout: 90_000 }).catch((e: { stdout?: string; stderr?: string }) => ({ stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` }))).stdout
}

async function openLive(path: string, key: string, { ack = true } = {}) {
  const lines: Record<string, unknown>[] = []
  const ws = new WebSocket(APP.replace(/^http/, 'ws') + path, { headers: key ? { authorization: `Bearer ${key}` } : {} })
  const send = (message: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(message))
  ws.onmessage = ({ data }) => {
    const line = JSON.parse(String(data))
    lines.push(line)
    if (ack && line.type === 'frame') send({ type: 'ack', seq: line.seq })
  }
  const closed = new Promise<{ code: number; reason: string }>((done) => { ws.onclose = ({ code, reason }) => done({ code, reason }) })
  await Promise.race([new Promise((done) => { ws.onopen = done }), closed])
  return { lines, closed, send, close: () => ws.close() }
}

async function docker(...args: string[]) {
  return (await sh('docker', args, { maxBuffer: 32 << 20 })).stdout.trim()
}

async function shell(cmd: string) {
  return (await sh('sh', ['-c', cmd], { maxBuffer: 32 << 20 })).stdout.trim()
}

function pidOf(pattern: string) {
  return shell(`pgrep -f '${pattern}' | tr '\\n' ' '`)
}

function reconcileCount(id: string) {
  return appEvents().filter((e) => e.event === 'reconcile.started' && e.agent === id).length
}

function appEvents() {
  return readFileSync('/var/log/openhut/app.log', 'utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line)
        return isRecord(value) ? [value] : []
      } catch {
        return []
      }
    })
}

function redact(s: string) {
  return s.replace(/(Agent |api_key: "|API_SERVER_KEY=)[^\s"]+/g, '$1<redacted>')
}

async function firewall(): Promise<Firewall> {
  return {
    agent: await shell('iptables -S AGENT'),
    agentIn: await shell('iptables -S AGENT-IN'),
    jumps: await shell('iptables -S DOCKER-USER | grep AGENT; iptables -S INPUT | grep AGENT-IN'),
    ipRule: await shell('ip rule | grep 10.200'),
  }
}

function channelKey(id: string) {
  return readFileSync(`/data/agent-conf/${id}/.env`, 'utf8').match(/API_SERVER_KEY=(\S+)/)?.[1] ?? ''
}

function agentToken(id: string) {
  return readFileSync(`/data/agent-conf/${id}/config.yaml`, 'utf8').match(/Agent ([\w.]+)/)?.[1] ?? ''
}

function waitReady(a: AgentRef, ms = 240_000) {
  return until(
    async () =>
      (await fetch(`http://10.200.${a.net}.2:8642/v1/models`, { headers: { authorization: `Bearer ${channelKey(a.id)}` }, signal: AbortSignal.timeout(3000) }))
        .ok,
    ms,
    `${a.id}'s API server to answer`,
  )
}

async function chat(a: AgentRef, text: string) {
  await waitReady(a)
  const r = await fetch(`http://10.200.${a.net}.2:8642/v1/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${channelKey(a.id)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'hermes-agent', messages: [{ role: 'user', content: text }] }),
  })
  const reply = replyText(await r.text())
  if (text.startsWith('sql:')) expectEvent(a, { text: inner(reply), isError: !rowsOf(inner(reply)) })
  return reply
}

function messageText(body: string) {
  try {
    const message: { content?: { text?: string }[] } = JSON.parse(body)
    return String(message.content?.[0]?.text ?? body)
  } catch {
    return body
  }
}

function replyText(body: string) {
  try {
    const reply: ChatReply = JSON.parse(body)
    return String(reply.choices?.[0]?.message?.content ?? body).trim()
  } catch {
    return body.trim()
  }
}

function expectEvent(a: AgentRef, reply: { text: string; isError: boolean }) {
  const outcome = outcomeOf(reply)
  const counts = (expectedEvents[a.id] ??= {})
  counts[outcome] = (counts[outcome] ?? 0) + 1
}

function outcomeOf({ text, isError }: { text: string; isError: boolean }) {
  if (!isError) return 'allowed'
  return text.startsWith('Denied:') ? 'denied' : 'failed'
}

function inner(reply: string) {
  const m = reply.match(/\n\n(\{[\s\S]*?\})\s*(?:<\/untrusted_tool_result>|$)/)
  if (!m) return reply
  try {
    const j: { result?: unknown; error?: unknown } = JSON.parse(m[1])
    return String(j.result ?? j.error ?? m[1])
  } catch {
    return m[1]
  }
}

function rowsOf(text: string) {
  try {
    const parsed: { rows?: Record<string, unknown>[] } = JSON.parse(text)
    return parsed.rows
  } catch {
    return undefined
  }
}

async function asAgent(a: AgentRef, code: string, env: Record<string, string> = {}) {
  await waitReady(a)
  const python = (await docker('exec', `ag-${a.id}`, 'sh', '-c', 'command -v python3 || ls /opt/hermes/.venv/bin/python')).split('\n')[0]
  return docker('exec', '-u', '10000:10000', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), `ag-${a.id}`, python, '-c', code)
}

async function gwRaw(from: AgentRef, token: string, body: object): Promise<RawReply> {
  return JSON.parse(await asAgent(from, GW, { URL: `http://10.200.${from.net}.1:8081/api/v1/mcp`, TOKEN: token, BODY: JSON.stringify(body) }))
}

async function viaBroker(from: AgentRef, { token, method, path, body }: { token: string; method: string; path: string; body?: object }): Promise<RawReply> {
  return JSON.parse(await asAgent(from, BROKER, { URL: `http://10.200.${from.net}.1:8081${path}`, TOKEN: token, METHOD: method, BODY: body ? JSON.stringify(body) : '' }))
}

async function callTool(a: AgentRef, args: Record<string, unknown>) {
  const t0 = Date.now()
  const r = await gwRaw(a, agentToken(a.id), {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'call_tool', arguments: { reason: 'e2e connector check', ...args } },
  })
  const { result }: { result?: ToolResult } = JSON.parse(r.body)
  const reply = { text: String(result?.content?.[0]?.text ?? r.body), isError: !!result?.isError }
  expectEvent(a, reply)
  return { ...reply, ms: Date.now() - t0 }
}

async function probe(a: AgentRef, targets: Record<string, [string, number]>): Promise<Probe> {
  return JSON.parse(await asAgent(a, PROBE, { TARGETS: JSON.stringify(targets) }))
}

function hostTcp(host: string, port: number) {
  return new Promise<string>((resolve) => {
    const s = connect({ host, port, timeout: 4000 })
    s.on('connect', () => {
      s.destroy()
      resolve('open')
    })
    s.on('timeout', () => {
      s.destroy()
      resolve('timeout')
    })
    s.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'))
  })
}

function hostUdpDns(host: string) {
  return new Promise<string>((resolve) => {
    const s = createSocket('udp4')
    const timer = setTimeout(() => {
      s.close()
      resolve('timeout')
    }, 3000)
    s.on('message', () => {
      clearTimeout(timer)
      s.close()
      resolve('answered')
    })
    s.send(Buffer.from(DNS_QUERY, 'hex'), 53, host)
  })
}

function targetsFor(a: AgentRef, other?: AgentRef) {
  const targets: Record<string, Target> = {
    gateway: { at: [`10.200.${a.net}.1`, 8081], agent: 'open' },
    internet_443: { at: ['1.1.1.1', 443], agent: 'open' },
    internet_by_name: { at: ['example.com', 443], agent: 'open' },
    server_api: { at: [`10.200.${a.net}.1`, 8787], agent: 'blocked', server: 'ECONNREFUSED' },
    server_other: { at: [`10.200.${a.net}.1`, SERVER_LISTENER_PORT], agent: 'blocked' },
    team_db: { at: ['172.30.0.10', 5432], agent: 'blocked' },
    lan_10: { at: ['10.99.0.10', 80], agent: 'blocked' },
    lan_10_443: { at: ['10.99.0.10', 443], agent: 'blocked' },
    lan_172: { at: ['172.29.0.10', 80], agent: 'blocked' },
    lan_192: { at: ['192.168.77.10', 80], agent: 'blocked' },
    cloud_metadata: { at: ['169.254.169.254', 80], agent: 'blocked' },
    cloud_metadata_443: { at: ['169.254.169.254', 443], agent: 'blocked' },
    internet_80: { at: ['1.1.1.1', 80], agent: 'blocked' },
    dns_other_resolver: { at: ['8.8.8.8', 53], agent: 'blocked' },
  }
  if (other) targets.other_agent = { at: [`10.200.${other.net}.2`, 8642], agent: 'blocked' }
  return targets
}

async function isolation(a: AgentRef, other?: AgentRef): Promise<Isolation> {
  const targets = targetsFor(a, other)
  const listener = createServer((s) => s.end()).listen(SERVER_LISTENER_PORT, '0.0.0.0')
  await once(listener, 'listening')
  const fromServer: Record<string, string> = {}
  const scan = async () => {
    const reply = await probe(a, Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, v.at])))
    for (const [k, v] of Object.entries(targets)) if (v.agent === 'blocked') fromServer[k] = await hostTcp(...v.at)
    return reply
  }
  const p = await scan().finally(() => listener.close())
  const rows = Object.entries(targets).map(([k, v]) => ({
    target: `${k} ${v.at.join(':')}`,
    agent: p.net[k],
    from_server: fromServer[k] ?? '-',
    ok: v.agent === 'open' ? p.net[k] === 'open' : p.net[k] === 'timeout' && fromServer[k] === (v.server ?? 'open'),
  }))
  const udpFromServer = await hostUdpDns('8.8.8.8')
  rows.push(
    {
      target: 'dns_udp 8.8.8.8:53/udp',
      agent: p.udp_dns.other_resolver,
      from_server: udpFromServer,
      ok: p.udp_dns.other_resolver !== 'answered' && udpFromServer === 'answered',
    },
    { target: 'dns_udp own resolver:53/udp', agent: p.udp_dns.own_resolver, from_server: '-', ok: p.udp_dns.own_resolver === 'answered' },
  )
  return { probe: p, rows, pass: rows.every((r) => r.ok) && p.dns === 'ok' }
}

async function tlsProbe(dataDir: string, dsn: string, trustCa: boolean) {
  const script = `import { postgres } from "${OPENHUT}/packages/runtime/src/server/integrations/postgres/postgres.ts";
     try { const r = await postgres.query({ dsn: process.env.DSN, sql: "select ssl from pg_stat_ssl where pid = pg_backend_pid()" }); console.log("ok " + JSON.stringify(r.rows)); }
     catch (e) { console.log("error " + e.message); }`
  const env = { ...process.env, OPENHUT_DATA: dataDir, DSN: dsn, ...(trustCa && { NODE_EXTRA_CA_CERTS: '/root/pgcerts/ca.crt' }) }
  const { stdout } = await sh('node', ['--input-type=module', '-e', script], { env })
  return stdout.trim().split('\n').at(-1) ?? ''
}

function count(xs: string[]) {
  const counts: Record<string, number> = {}
  for (const x of xs) counts[x] = (counts[x] ?? 0) + 1
  return counts
}

function processCount(pids: string) {
  return pids.split(/\s+/).filter(Boolean).length
}

function sha(s: string) {
  return createHash('sha256').update(s).digest('hex')
}

function failure(e: unknown, stream: 'stdout' | 'stderr' = 'stderr') {
  const output = isRecord(e) ? e[stream] : undefined
  if (typeof output === 'string' && output) return output
  return e instanceof Error ? e.message : String(e)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function settled<T>(read: () => Promise<T>) {
  try {
    return await read()
  } catch {
    return undefined
  }
}

export type CheckResult = { id: string; check: string; expected: string; actual: string; pass: boolean }
export type PhaseResults = { phase: string; at: string; passed: number; failed: number; results: CheckResult[] }

type Outcome = { actual: unknown; pass: boolean }
type Call = <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<T>
type Reply<T> = { status: number; json: T & Partial<ApiError> }
type AgentRef = Pick<Agent, 'id' | 'net'>
type Firewall = Record<string, string>
type State = {
  dev: AgentRef
  conn: string
  envSha: string
  pin: string
  fw: Firewall
  devContainer: string
  reconciled: number
  build: string
  pids: { agentd: string; app: string }
  devStarted: string
}
type ChatReply = { choices?: { message?: { content?: string } }[] }
type ToolResult = { content?: { text?: string }[]; isError?: boolean }
type RawReply = { status: number; body: string }
type Target = { at: [string, number]; agent: 'open' | 'blocked'; server?: string }
type Probe = {
  uid: number
  kernel: string
  writable: Record<string, boolean>
  renamable: Record<string, boolean>
  udp_dns: { other_resolver: string; own_resolver: string }
  capeff: string
  docker_sock: boolean
  agentd_sock: boolean
  dns: string
  net: Record<string, string>
}
type Isolation = { probe: Probe; rows: { target: string; agent: string; from_server: string; ok: boolean }[]; pass: boolean }
type Flood = { headersHeld: number; headersRefused: number; bodies: number; got429: number }
type Limits = { bigBody: string; slowHeaders: string; after: number }
type ContainerInspect = {
  Config: { User: string; Labels: Record<string, string> }
  HostConfig: {
    Runtime: string
    ReadonlyRootfs: boolean
    Privileged: boolean
    CapDrop: string[] | null
    CapAdd: string[] | null
    SecurityOpt: string[] | null
    PidsLimit: number
    Memory: number
    NanoCpus: number
    RestartPolicy?: { Name: string }
    Tmpfs?: Record<string, string>
  }
  NetworkSettings: { Networks: Record<string, { IPAddress: string }> }
  Mounts: { Source: string; Destination: string; RW: boolean }[]
}
