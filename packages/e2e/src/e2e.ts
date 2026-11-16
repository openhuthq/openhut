import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDeepStrictEqual, promisify, stripVTControlCharacters } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Admin, Health, Update } from '@openhut/common/admin/admin.ts'
import type { Agent, Grant } from '@openhut/common/agents/agent.ts'
import type { Browser } from '@openhut/common/agents/browser.ts'
import type { ApiError, Deleted, List } from '@openhut/common/api.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import type { Connection, ConnectionEvent } from '@openhut/common/connections/connection.ts'
import type { OAuthCode, OAuthGrant } from '@openhut/common/team/oauth.ts'
import type { Invite, InviteLink, Person, Session, Setup } from '@openhut/common/team/team.ts'
import type { AgentdReplies } from '../../agentd/src/agentd.ts'

const sh = promisify(execFile)
const APP = 'http://127.0.0.1:8787'
const BROWSE_URL = 'https://example.com/'
const BROWSE_TITLE = 'Example Domain'
const OPENHUT = '/opt/openhut'
const RESULTS = process.env.RESULTS ?? '/results'
const DENIED = 'Denied: no connection grants postgres_query to this agent.'
const OAUTH_REDIRECT = 'http://127.0.0.1:33417/callback'
const AGENTS_NET = '10.200.0.0/16'
const DOCKER_USER_JUMP = ['DOCKER-USER', '-s', AGENTS_NET, '-j', 'AGENT']
const FIREWALL_SCRIPT = `${OPENHUT}/install/agents-firewall.sh`
const AGENTD_PROCESS = `^node ${OPENHUT}/packages/agentd/src/agentd.ts`
const APP_PROCESS = `^node ${OPENHUT}/packages/app/src/app.ts`
const UNTRUSTED_CA = /self-signed|unable to (get|verify)/i
const WHATSAPP_PAIRING = /^(2@|https:\/\/wa\.me\/)/
const DNS_QUERY = '123401000001000000000000076578616d706c6503636f6d0000010001'
const GW = `import urllib.request, json, os
req = urllib.request.Request(os.environ["URL"], data=os.environ["BODY"].encode(), headers={"authorization": "Agent " + os.environ["TOKEN"], "content-type": "application/json", "accept": "application/json, text/event-stream"})
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
  const owner = { email: 'owner@example.com', password: randomBytes(12).toString('base64url') }
  const mia = { email: 'mia@example.com', password: randomBytes(12).toString('base64url') }
  const seatToken = `sk-ant-oat01-${randomBytes(24).toString('hex')}`
  const extras: string[] = []
  let setupCode = ''
  let cookie = ''
  let ownerId = ''
  let miaCookie = ''
  let oauth = { access: '', refresh: '', clientId: '' }
  let fw: Firewall = {}
  let whatsapp = ''
  let call: Call
  let conn: Connection
  let dev: Agent
  let sales: Agent
  let devGrant: Grant
  let helper: Agent
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

  check('A1', 'Setup needs the code the installer printed', 'open before; a wrong code: 403 on setupCode; still open, no owner', async () => {
    const open = (await api<Setup>('GET', '/api/setup')).json.open
    const wrongCode = await api('POST', '/api/people', { setupCode: '0'.repeat(18), email: 'mallory@example.com', password: 'mallory-password-1' })
    const stillOpen = (await api<Setup>('GET', '/api/setup')).json.open
    return {
      actual: `open ${open} | wrong code ${wrongCode.status} ${wrongCode.json.error?.param} | open after ${stillOpen}`,
      pass: open === true && wrongCode.status === 403 && wrongCode.json.error?.param === 'setupCode' && stillOpen === true,
    }
  })

  check(
    'A2',
    "The installer's link signs up the owner in one step",
    'the install prints the /setup?code= link; posting the code with an email and password makes the owner and a session cookie, HttpOnly and SameSite=Strict',
    async () => {
      setupCode = readFileSync('/etc/openhut/env', 'utf8').match(/SETUP_CODE=(\S+)/)?.[1] ?? ''
      writeFileSync(`${RESULTS}/.test-credentials.json`, JSON.stringify(owner))
      const printed = readFileSync(`${RESULTS}/install.log`, 'utf8').includes('/setup?code=')
      const setup = await api<Person>('POST', '/api/people', { setupCode, ...owner })
      cookie = setup.cookie
      ownerId = setup.json.id ?? ''
      return {
        actual: `link printed ${printed} | ${setup.status} ${setup.json.role} ${setup.setCookie.replace(/=[^;]+/, '=<redacted>')}`,
        pass:
          printed && setup.status === 200 && setup.json.role === 'owner' && /HttpOnly/.test(setup.setCookie) && /SameSite=Strict/.test(setup.setCookie),
      }
    },
  )

  check(
    'A3',
    'Setup closes after the owner exists; sign-in checks the password, taking as long for unknown names',
    'setup again: 403 and closed; wrong password 401; unknown user 401; right password 200 with a session; unknown/wrong time 0.5-2×',
    async () => {
      const again = await api('POST', '/api/people', { setupCode, email: 'second@example.com', password: 'second-password-1' })
      const open = (await api<Setup>('GET', '/api/setup')).json.open
      const bad = await api('POST', '/api/sessions', { email: 'owner@example.com', password: 'wrong-password-123' })
      const nobody = await api('POST', '/api/sessions', { email: 'nobody@example.com', password: 'wrong-password-123' })
      const good = await api<Session>('POST', '/api/sessions', owner)
      const ms: { wrong: number[]; unknown: number[] } = { wrong: [], unknown: [] }
      for (let i = 0; i < 5; i++) {
        ms.wrong.push(await timedSignIn('owner@example.com'))
        ms.unknown.push(await timedSignIn(`nobody${i}@example.com`))
      }
      const ratio = average(ms.unknown) / average(ms.wrong)
      return {
        actual: `setup ${again.status} open ${open} | wrong ${bad.status} | unknown ${nobody.status} | right ${good.status} | ms wrong ${ms.wrong} unknown ${ms.unknown} ratio ${ratio.toFixed(2)}`,
        pass: again.status === 403 && bad.status === 401 && nobody.status === 401 && good.status === 200 && !!good.cookie && ratio > 0.5 && ratio < 2,
      }
    },
  )

  check(
    'A4',
    'Control MCP takes only OAuth access tokens, and points clients at its sign-in',
    'no token: 401 with resource_metadata; a session cookie alone: 401; a made-up token: 401; metadata points at /mcp/authorize; signing in with OAuth gives a fmo_ token; Admin lists the app',
    async () => {
      const post = (headers: Record<string, string>) =>
        fetch(`${APP}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })
      const noauth = await post({})
      const withCookie = await post({ cookie })
      const madeUp = await post({ authorization: `Bearer fmo_${randomBytes(24).toString('base64url')}` })
      const meta = (await api<{ resource?: string }>('GET', '/.well-known/oauth-protected-resource/mcp')).json
      const server = (await api<{ authorization_endpoint?: string }>('GET', '/.well-known/oauth-authorization-server')).json
      oauth = await oauthSignIn(cookie, 'e2e')
      call = await mcp(oauth.access)
      const apps = ((await api<List<OAuthGrant>>('GET', '/api/oauth/grants', undefined, cookie)).json.data ?? []).map((a) => a.client)
      const challenge = noauth.headers.get('www-authenticate') ?? ''
      return {
        actual: {
          noToken: `${noauth.status} ${challenge.slice(0, 80)}`,
          cookie: withCookie.status,
          madeUp: madeUp.status,
          authorize: server.authorization_endpoint,
          resource: meta.resource,
          signedIn: oauth.access ? 'fmo_<redacted>' : 'no',
          apps,
        },
        pass:
          noauth.status === 401 &&
          /resource_metadata=/.test(challenge) &&
          withCookie.status === 401 &&
          madeUp.status === 401 &&
          server.authorization_endpoint === `${APP}/mcp/authorize` &&
          meta.resource === `${APP}/mcp` &&
          /^fmo_/.test(oauth.access) &&
          isDeepStrictEqual(apps, ['e2e']),
      }
    },
  )

  check('B1', 'Control MCP creates a connection, two agents and a grant', 'Dev granted Orders DB, Sales has none', async () => {
    await startTeamDb(dbPassword, agentPassword)
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
      connection_api: (await api('GET', `/api/connections/${conn.id}`, undefined, cookie)).json,
      agent_api: (await api('GET', `/api/agents/${dev.id}`, undefined, cookie)).json,
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
    const connEvents = (await api<List<ConnectionEvent>>('GET', `/api/connection-events?connectionId=${conn.id}&limit=100`, undefined, cookie)).json.data ?? []
    return {
      actual: { events: connEvents.length, agents: [...new Set(connEvents.map((e) => e.agentName))] },
      pass: connEvents.length >= 3 && connEvents.every((e) => e.agentId === dev.id && e.agentName === 'Dev'),
    }
  })

  check('R1', 'The browser is off until someone switches it on', 'browser false; Hermes\'s own browser toolset disabled; agent-browser is not in the container, so the agent\'s command fails', async () => {
    const agent = (await api<Agent>('GET', `/api/agents/${dev.id}`, undefined, cookie)).json
    const disabled = await docker('exec', `ag-${dev.id}`, 'grep', 'disabled_toolsets', '/opt/data/config.yaml')
    const installed = await docker('exec', `ag-${dev.id}`, 'sh', '-c', 'command -v agent-browser || echo missing')
    const reply = await chat(dev, `browser: open ${BROWSE_URL}`)
    return { actual: { browser: agent.browser, disabled, installed, reply: reply.slice(-160) }, pass: agent.browser === false && disabled.includes('[browser,') && installed === 'missing' && reply.includes('not found') && !reply.includes(BROWSE_TITLE) }
  })

  check('R2', 'Switched on, the agent opens a public page with agent-browser, inside its own gVisor container', 'PATCH 200; the container is rebuilt still runsc and read-only, with a 4 GiB memory limit and agent-browser mounted read-only; the agent\'s command returns the page title', async () => {
    const patched = await api<Agent>('PATCH', `/api/agents/${dev.id}`, { browser: true }, cookie)
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

  check('R3', 'Only while someone looks: the dashboard gets one still picture of the agent\'s page, and nothing streams when nobody watches', 'GET /api/browsers/:id: open, the page address, a JPEG; agent-browser reports no screencast running', async () => {
    const still = await api<Browser>('GET', `/api/browsers/${dev.id}`, undefined, cookie)
    const status = await agentBrowser(dev, 'stream', 'status')
    return {
      actual: { status: still.status, open: still.json.open, url: still.json.url, picture: String(still.json.still).slice(0, 30), bytes: String(still.json.still).length, stream: status.replace(/\s+/g, ' ') },
      pass: still.status === 200 && still.json.open === true && still.json.url === BROWSE_URL && String(still.json.still).startsWith('data:image/jpeg;base64,/9j/') && /Screencasting: false/.test(status),
    }
  })

  check('R4', 'Take over: the owner watches live, the agent is paused, the owner\'s clicks and keys drive the page, and handing back frees the agent', 'frames arrive; input before Take over is refused (409); while held the agent\'s click is denied by policy; the owner clicks the search box, types gVisor and Enter and the page lands on the gVisor article; after hand back the agent browses again; closing the view stops the screencast', async () => {
    await chat(dev, 'browser: open https://www.wikipedia.org/')
    const center = /"(\d+),(\d+)"/.exec(await agentBrowser(dev, 'eval', "(r => Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2))(document.querySelector('#searchInput').getBoundingClientRect())"))
    const box = center ? { x: Number(center[1]), y: Number(center[2]) } : undefined
    const view = await openStream(`/api/browsers/${dev.id}/stream`, cookie)
    await until(async () => view.events.some((e) => e.event === 'frame'), 30_000, 'the first live frame')
    const click = [{ type: 'mouse', action: 'down', x: box?.x ?? 0, y: box?.y ?? 0 }, { type: 'mouse', action: 'up', x: box?.x ?? 0, y: box?.y ?? 0 }]
    const early = await api('POST', `/api/browsers/${dev.id}/input`, { events: click }, cookie)
    const held = await api<Browser>('POST', `/api/browsers/${dev.id}/hold`, undefined, cookie)
    const agentWhileHeld = await agentBrowser(dev, 'click', '#searchInput')
    const keys = [...'gVisor', 'Enter'].flatMap((key) => [{ type: 'key', action: 'down', key }, { type: 'key', action: 'up', key }])
    const typed = await api<{ accepted: number }>('POST', `/api/browsers/${dev.id}/input`, { events: [...click, ...keys] }, cookie)
    await until(async () => (await agentBrowser(dev, 'get', 'url')).includes('/wiki/GVisor'), 30_000, 'the search to land on the gVisor article')
    const landed = (await agentBrowser(dev, 'get', 'url')).trim().split('\n').pop()
    const released = await api<Browser>('DELETE', `/api/browsers/${dev.id}/hold`, undefined, cookie)
    const agentAfter = await agentBrowser(dev, 'open', BROWSE_URL)
    const frames = view.events.filter((e) => e.event === 'frame').length
    const holdEvents = view.events.filter((e) => e.event === 'hold').map((e) => JSON.stringify(e.data))
    view.close()
    await until(async () => /Screencasting: false/.test(await agentBrowser(dev, 'stream', 'status')), 30_000, 'the screencast to stop after the view closed')
    return {
      actual: { box, frames, early: early.status, held: `${held.status} ${held.json.heldBy}`, agentWhileHeld: agentWhileHeld.trim().slice(0, 120), typed: `${typed.status} ${typed.json.accepted}`, landed, released: `${released.status} ${released.json.heldBy}`, holdEvents, agentAfter: agentAfter.trim().split('\n')[0] },
      pass: !!box && frames >= 2 && early.status === 409 && held.status === 200 && held.json.heldBy === owner.email && /denied by policy/.test(agentWhileHeld) &&
        typed.status === 200 && typed.json.accepted === 16 && !!landed?.includes('wikipedia.org/wiki/GVisor') && released.status === 200 && released.json.heldBy === null && agentAfter.includes(BROWSE_TITLE),
    }
  })

  check('R5', 'Switched off again, the browser is gone', 'PATCH 200; the container is rebuilt without agent-browser and back to its 1 GiB size; the dashboard reports no browser', async () => {
    const patched = await api<Agent>('PATCH', `/api/agents/${dev.id}`, { browser: false }, cookie)
    await waitReady(dev)
    const installed = await docker('exec', `ag-${dev.id}`, 'sh', '-c', 'command -v agent-browser || echo missing')
    const label = await docker('inspect', '--format', '{{index .Config.Labels "openhut.browser"}} {{.HostConfig.Memory}}', `ag-${dev.id}`)
    const still = await api<Browser>('GET', `/api/browsers/${dev.id}`, undefined, cookie)
    return { actual: { status: patched.status, browser: patched.json.browser, installed, label, open: still.json.open }, pass: patched.status === 200 && patched.json.browser === false && installed === 'missing' && label === 'off 1073741824' && still.json.open === false }
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
    'matrix in isolation-probe-sales.json all ok',
    async () => {
      fw = await firewall()
      writeFileSync(`${RESULTS}/firewall.txt`, Object.values(fw).join('\n\n') + '\n')
      return { actual: iso.rows.map((r) => `${r.target}: ${r.agent}/${r.from_server}${r.ok ? '' : ' ✗'}`), pass: iso.pass }
    },
  )

  check('F6', "Dev's gateway token is useless from Sales' network", 'from Sales: 401; same request from Dev: 200', async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    const stolen = await gwRaw(sales, agentToken(dev.id), list)
    const own = await gwRaw(dev, agentToken(dev.id), list)
    return { actual: `from Sales ${stolen.status}; from Dev ${own.status}`, pass: stolen.status === 401 && own.status === 200 }
  })

  check(
    'F7',
    "Only agents reach the gateway port; other containers on the server don't",
    "from the team DB's network: 8081 gets no HTTP answer at all; 8787 answers (control)",
    async () => {
      const viaWget = (port: number) =>
        docker('exec', 'teamdb', 'sh', '-c', `wget -S -T 3 -O /dev/null http://172.30.0.1:${port}/health 2>&1 | grep -q 'HTTP/' && echo open || echo blocked`)
      const f7 = { gateway_8081: await viaWget(8081), dashboard_8787: await viaWget(8787) }
      return { actual: f7, pass: f7.gateway_8081 === 'blocked' && f7.dashboard_8787 === 'open' }
    },
  )

  check(
    'P0',
    'People join only by invite; a link works once and can be revoked',
    'create_invite gives a link; its lookup 200 (member); joining makes a member with a session; the same link again 410; an unknown link 410; a revoked admin link 410',
    async () => {
      const invite = await call<Invite>('create_invite', { role: 'member' })
      const inviteToken = inviteTokenOf(invite)
      const linkInfo = await api<InviteLink>('GET', `/api/invite-links/${inviteToken}`)
      const join = await api<Person>('POST', '/api/people', { inviteToken, ...mia })
      miaCookie = join.cookie
      const reuse = await api('POST', '/api/people', { inviteToken, email: 'mallory@example.com', password: 'mallory-password-1' })
      const unknown = await api('GET', '/api/invite-links/not-a-real-invite')
      const adminInvite = await call<Invite>('create_invite', { role: 'admin' })
      const revoked = await call<Deleted<'invite'>>('delete_invite', { id: adminInvite.id })
      const revokedUse = await api('POST', '/api/people', { inviteToken: inviteTokenOf(adminInvite), email: 'mallory@example.com', password: 'mallory-password-1' })
      return {
        actual: {
          link: String(invite.link).replace(inviteToken, '<token>'),
          lookup: `${linkInfo.status} ${linkInfo.json.role}`,
          join: `${join.status} ${join.json.role}`,
          session: !!miaCookie,
          reuse: reuse.status,
          unknown: unknown.status,
          revoked: `${revoked.deleted} then ${revokedUse.status}`,
        },
        pass:
          linkInfo.status === 200 &&
          linkInfo.json.role === 'member' &&
          join.status === 200 &&
          join.json.role === 'member' &&
          !!miaCookie &&
          reuse.status === 410 &&
          unknown.status === 410 &&
          revoked.deleted === true &&
          revokedUse.status === 410,
      }
    },
  )

  check('R6', "Only people who can edit an agent can see or drive its browser", 'Mia (a member who does not own Dev): 403 on the picture, the stream, Take over and input; no session: 401', async () => {
    const path = `/api/browsers/${dev.id}`
    const stream = await fetch(`${APP}${path}/stream`, { headers: { cookie: miaCookie } })
    await stream.body?.cancel()
    const statuses = {
      picture: (await api('GET', path, undefined, miaCookie)).status,
      stream: stream.status,
      hold: (await api('POST', `${path}/hold`, undefined, miaCookie)).status,
      input: (await api('POST', `${path}/input`, { events: [{ type: 'key', action: 'down', key: 'a' }] }, miaCookie)).status,
      anonymous: (await api('GET', path)).status,
    }
    return { actual: statuses, pass: statuses.picture === 403 && statuses.stream === 403 && statuses.hold === 403 && statuses.input === 403 && statuses.anonymous === 401 }
  })

  check('P1', 'A member manages their own agent from the dashboard', 'create 200 (ag_…); start 200; instructions 200; container running', async () => {
    const created = await api<Agent>('POST', '/api/agents', { name: 'Helper' }, miaCookie)
    helper = created.json
    const steps = {
      start: (await api('PATCH', `/api/agents/${helper.id}`, { wanted: 'running' }, miaCookie)).status,
      instructions: (await api('PATCH', `/api/agents/${helper.id}`, { instructions: '# Helper\nHelps.' }, miaCookie)).status,
    }
    const state = await statusOf(helper.id)
    return {
      actual: { create: `${created.status} ${helper.id}`, ...steps, state },
      pass: created.status === 200 && /^ag_/.test(helper.id) && steps.start === 200 && steps.instructions === 200 && state === 'running',
    }
  })

  check(
    'P2',
    "A member can't delete others' agents, grant or read the activity of a connection they can't use, list or make invites, remove people, or set the seat",
    'all 403; Dev still exists',
    async () => {
      const denied = {
        deleteDev: (await api('DELETE', `/api/agents/${dev.id}`, undefined, miaCookie)).status,
        grantPrivate: (await api('POST', '/api/grants', { agentId: helper.id, connectionId: conn.id }, miaCookie)).status,
        readActivity: (await api('GET', `/api/connection-events?connectionId=${conn.id}`, undefined, miaCookie)).status,
        listInvites: (await api('GET', '/api/invites', undefined, miaCookie)).status,
        invite: (await api('POST', '/api/invites', { role: 'admin' }, miaCookie)).status,
        setSeat: (await api('PATCH', '/api/admin', { seatToken: 'x'.repeat(30) }, miaCookie)).status,
        removeOwner: (await api('DELETE', `/api/people/${ownerId}`, undefined, miaCookie)).status,
      }
      const devStill = (await call<List<Agent>>('list_agents')).data.some((a) => a.id === dev.id)
      return { actual: { ...denied, devStill }, pass: Object.values(denied).every((s) => s === 403) && devStill }
    },
  )

  check(
    'P3',
    'An agent reaches a connection only while its owner can: un-sharing cuts Helper off on its next call',
    'shared: grant 200, n=42; un-shared: Denied',
    async () => {
      await call('update_connection', { id: conn.id, everyone: true })
      const shared = await api('POST', '/api/grants', { agentId: helper.id, connectionId: conn.id }, miaCookie)
      const whileShared = await callTool(helper, { name: 'postgres_query', arguments: { sql: 'select count(*)::int as n from orders' } })
      await call('update_connection', { id: conn.id, everyone: false })
      const unshared = await callTool(helper, { name: 'postgres_query', arguments: { sql: 'select 1' } })
      return {
        actual: { grant: shared.status, shared: whileShared.text, unshared: unshared.text },
        pass: shared.status === 200 && rowsOf(whileShared.text)?.[0]?.n === 42 && unshared.text === DENIED,
      }
    },
  )

  check(
    'P5',
    'Removing a person ends their access at once',
    "their session 401, their OAuth app 401, sign-in 401; their agent stopped; they're off the People list",
    async () => {
      const miaToken = (await oauthSignIn(miaCookie, "mia's assistant")).access
      const miaId = (await call<List<Person>>('list_people')).data.find((p) => p.email === 'mia@example.com')?.id
      await call('delete_person', { id: miaId })
      const afterRemoval = {
        session: (await api('GET', '/api/me', undefined, miaCookie)).status,
        token: (
          await fetch(`${APP}/mcp`, {
            method: 'POST',
            headers: { authorization: `Bearer ${miaToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
          })
        ).status,
        signIn: (await api('POST', '/api/sessions', mia)).status,
        agent: await statusOf(helper.id),
        listed: (await call<List<Person>>('list_people')).data.some((p) => p.email === 'mia@example.com'),
      }
      await call('delete_agent', { id: helper.id })
      return {
        actual: afterRemoval,
        pass:
          afterRemoval.session === 401 && afterRemoval.token === 401 && afterRemoval.signIn === 401 && afterRemoval.agent === 'exited' && !afterRemoval.listed,
      }
    },
  )

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
        cookie,
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
        cookie,
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
          const channel = await api<Channel>('GET', `/api/channels/${whatsapp}`, undefined, cookie)
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
      const unlinked = await api<Deleted<'channel'>>('DELETE', `/api/channels/${whatsapp}`, undefined, cookie)
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
    writeFileSync(`${OPENHUT}/packages/app/src/only-in-the-previous-release.ts`, '')
    const state: Partial<State> = {
      dev: await settled(async () => ({ id: dev.id, net: dev.net })),
      conn: await settled(async () => conn.id),
      oauth: { refresh: oauth.refresh, clientId: oauth.clientId },
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
      const leftover = await shell(`ls ${OPENHUT}/packages/app/src/only-in-the-previous-release.ts 2>&1 || true`)
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
    'token works; Dev in the same container; a build.applied e2e-1 -> e2e-2 event in app.log; Dev restarted with its instructions intact and its plugin folder present, and still answers from the team DB (n = 42); setup stays closed',
    async () => {
      const st = savedState()
      const call = await mcp(await refreshed(st))
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
      const setupClosed = (await api<Setup>('GET', '/api/setup')).json.open === false
      return {
        actual: { agents: agents.map((a) => `${a.name}:${a.status}`), sameContainer, rebuilt, soul, plugin, reply, setup: setupClosed },
        pass:
          agents.some((a) => a.id === st.dev.id && a.status === 'running') &&
          sameContainer &&
          rebuilt &&
          soul.includes('Updated instructions v2.') &&
          plugin.endsWith('inert_mcp.py') &&
          rowsOf(reply)?.[0]?.n === 42 &&
          setupClosed,
      }
    },
  )
}

function afterRestart() {
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
      const call = await mcp(await refreshed(st))
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
    'POST /api/updates 200 running, to e2e-broken; a second POST 409; then the same build as before, /health ok, Admin update failed, the install lock free, no /opt/openhut.* left, Dev running',
    async () => {
      const st = savedState()
      const token = await refreshed(st)
      const before = await health()
      const started = await asOwner<Update>('POST', '/api/updates', token)
      const twice = await asOwner('POST', '/api/updates', token)
      await until(async () => (await asOwner<Admin>('GET', '/api/admin', token)).json.server.update?.status === 'failed', 20 * 60_000, 'Admin to report the failed update')
      await until(async () => (await statusOf(st.dev.id)) === 'running', 180_000, 'Dev to run again')
      const admin = (await asOwner<Admin>('GET', '/api/admin', token)).json
      const now = await health()
      const lock = await shell('flock -n /run/openhut-install.lock true && echo free || echo held')
      const leftovers = await shell('ls -d /opt/openhut.* 2>/dev/null || true')
      return {
        actual: { started: [started.status, started.json.status, started.json.to], twice: twice.status, build: `${before.build} -> ${now.build}`, ok: now.ok, update: admin.server.update?.status, lock, leftovers },
        pass:
          started.status === 200 && started.json.status === 'running' && started.json.to === 'e2e-broken' && twice.status === 409 &&
          now.build === before.build && now.ok === true && admin.server.update?.status === 'failed' && lock === 'free' && leftovers === '',
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
      const token = await refreshed(st)
      const started = await asOwner<Update>('POST', '/api/updates', token)
      const during = (await asOwner<Admin>('GET', '/api/admin', token)).json.server.update?.status
      await until(async () => { const h = await health(); return h.build === 'e2e-3' && h.ok }, 15 * 60_000, 'build e2e-3 to be healthy')
      await until(async () => (await statusOf(st.dev.id)) === 'running', 180_000, 'Dev to run again')
      const admin = (await asOwner<Admin>('GET', '/api/admin', token)).json
      const dev = await asOwner<Agent>('GET', `/api/agents/${st.dev.id}`, token)
      return {
        actual: { started: [started.status, started.json.to], during, build: admin.server.build, update: admin.server.update, updateAvailable: admin.server.updateAvailable, dev: dev.status },
        pass: started.status === 200 && started.json.to === 'e2e-3' && during === 'running' && admin.server.build === 'e2e-3' && admin.server.update === null && !admin.server.updateAvailable && dev.status === 200,
      }
    },
  )
}

async function asOwner<T = unknown>(method: string, path: string, token: string): Promise<{ status: number; json: T }> {
  const r = await fetch(APP + path, { method, headers: { authorization: `Bearer ${token}` } })
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

async function api<T = unknown>(method: string, path: string, body?: unknown, cookie = ''): Promise<Reply<T>> {
  const r = await fetch(APP + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  const setCookie = r.headers.get('set-cookie') ?? ''
  try {
    return { status: r.status, json: JSON.parse(text), cookie: setCookie.split(';')[0], setCookie }
  } catch {
    throw new Error(`${method} ${path} answered ${r.status} without JSON: ${text.slice(0, 200)}`)
  }
}

async function oauthSignIn(cookie: string, name: string) {
  const verifier = randomBytes(32).toString('base64url')
  const clientId = await oauthRegister(name)
  const tokens = await oauthToken({
    grant_type: 'authorization_code',
    code: await oauthCode(cookie, clientId, verifier),
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT,
  })
  return { access: tokens.access_token ?? '', refresh: tokens.refresh_token ?? '', clientId }
}

async function oauthRegister(name: string) {
  return (await api<{ client_id: string }>('POST', '/api/oauth/clients', { client_name: name, redirect_uris: [OAUTH_REDIRECT] })).json.client_id
}

async function oauthCode(cookie: string, clientId: string, verifier: string) {
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
  const approved = await api<OAuthCode>(
    'POST',
    '/api/oauth/codes',
    { clientId, redirectUri: OAUTH_REDIRECT, codeChallenge, codeChallengeMethod: 'S256', allow: true },
    cookie,
  )
  return new URL(approved.json.redirect ?? '').searchParams.get('code') ?? ''
}

async function oauthToken(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${APP}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  return JSON.parse(await r.text())
}

async function refreshed(st: State) {
  const t = await oauthToken({ grant_type: 'refresh_token', refresh_token: st.oauth.refresh, client_id: st.oauth.clientId })
  writeFileSync(`${RESULTS}/state.json`, JSON.stringify({ ...st, oauth: { ...st.oauth, refresh: t.refresh_token ?? st.oauth.refresh } }))
  return t.access_token ?? ''
}

async function mcp(token: string): Promise<Call> {
  const client = new Client({ name: 'e2e', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${APP}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
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
  return new Promise<AgentdReplies['health']>((resolve, reject) => {
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
    s.end(JSON.stringify({ cmd: 'health' }) + '\n')
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

async function openStream(path: string, cookie: string) {
  const abort = new AbortController()
  const events: { event: string; data: unknown }[] = []
  const response = await fetch(APP + path, { headers: { cookie }, signal: abort.signal })
  const read = async () => {
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const chunk = await reader?.read()
      if (!chunk || chunk.done) return
      buffer += decoder.decode(chunk.value, { stream: true })
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const event = /^event: (.*)$/m.exec(block)?.[1]
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (event && data) events.push({ event, data: JSON.parse(data) })
      }
    }
  }
  read().catch(() => undefined)
  return { status: response.status, events, close: () => abort.abort() }
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
    dashboard: { at: [`10.200.${a.net}.1`, 8787], agent: 'blocked' },
    team_db: { at: ['172.30.0.10', 5432], agent: 'blocked' },
    lan_10: { at: ['10.99.0.10', 80], agent: 'blocked' },
    lan_172: { at: ['172.29.0.10', 80], agent: 'blocked' },
    lan_192: { at: ['192.168.77.10', 80], agent: 'blocked' },
    cloud_metadata: { at: ['169.254.169.254', 80], agent: 'blocked' },
    internet_80: { at: ['1.1.1.1', 80], agent: 'blocked' },
    dns_other_resolver: { at: ['8.8.8.8', 53], agent: 'blocked' },
  }
  if (other) targets.other_agent = { at: [`10.200.${other.net}.2`, 8642], agent: 'blocked' }
  return targets
}

async function isolation(a: AgentRef, other?: AgentRef): Promise<Isolation> {
  const targets = targetsFor(a, other)
  const p = await probe(a, Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, v.at])))
  const fromServer: Record<string, string> = {}
  for (const [k, v] of Object.entries(targets)) if (v.agent === 'blocked') fromServer[k] = await hostTcp(...v.at)
  const rows = Object.entries(targets).map(([k, v]) => ({
    target: `${k} ${v.at.join(':')}`,
    agent: p.net[k],
    from_server: fromServer[k] ?? '-',
    ok: v.agent === 'open' ? p.net[k] === 'open' : p.net[k] !== 'open' && fromServer[k] === 'open',
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
  const script = `import { postgres } from "${OPENHUT}/packages/app/src/integrations/postgres/postgres.ts";
     try { const r = await postgres.query({ dsn: process.env.DSN, sql: "select ssl from pg_stat_ssl where pid = pg_backend_pid()" }); console.log("ok " + JSON.stringify(r.rows)); }
     catch (e) { console.log("error " + e.message); }`
  const env = { ...process.env, OPENHUT_DATA: dataDir, DSN: dsn, ...(trustCa && { NODE_EXTRA_CA_CERTS: '/root/pgcerts/ca.crt' }) }
  const { stdout } = await sh('node', ['--input-type=module', '-e', script], { env })
  return stdout.trim().split('\n').at(-1) ?? ''
}

async function timedSignIn(email: string) {
  const t = Date.now()
  await api('POST', '/api/sessions', { email, password: 'wrong-password-123' })
  return Date.now() - t
}

function average(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function count(xs: string[]) {
  const counts: Record<string, number> = {}
  for (const x of xs) counts[x] = (counts[x] ?? 0) + 1
  return counts
}

function processCount(pids: string) {
  return pids.split(/\s+/).filter(Boolean).length
}

function inviteTokenOf(invite: Invite) {
  return String(invite.link).split('/invite/')[1] ?? ''
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
type Reply<T> = { status: number; json: T & Partial<ApiError>; cookie: string; setCookie: string }
type Tokens = { access_token?: string; refresh_token?: string; error?: string; error_description?: string }
type AgentRef = Pick<Agent, 'id' | 'net'>
type Firewall = Record<string, string>
type State = {
  dev: AgentRef
  conn: string
  oauth: { refresh: string; clientId: string }
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
type Target = { at: [string, number]; agent: 'open' | 'blocked' }
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
