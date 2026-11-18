import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { pullOf } from '../../../src/agentd/sandbox/gvisor.ts'

const base = mkdtempSync(`${tmpdir()}/agentd-gvisor-`)
const DATA = `${base}/data`
const BRIDGE = `${base}/whatsapp-bridge`
const SOCK = `${base}/agentd.sock`
mkdirSync(`${BRIDGE}/node_modules`, { recursive: true })
Object.assign(process.env, { OPENHUT_SANDBOX: 'memory', AGENTD_DATA: DATA, AGENTD_SOCK: SOCK, AGENTD_WHATSAPP_BRIDGE: BRIDGE })

const { server } = await import('../../../src/agentd/agentd.ts')
const { boxes } = await import('../../../src/agentd/sandbox/memory.ts')
const { createArgs } = await import('../../../src/agentd/sandbox/gvisor.ts')
if (!server.listening) await once(server, 'listening')
after(() => server.close())

const PLUGINS = fileURLToPath(new URL('../../../../../vendor/hermes-plugins', import.meta.url))
const CLAUDE_BIN = fileURLToPath(new URL('../../../../../bin/claude', import.meta.url))
const DIGEST = 'ghcr.io/openhut/agent@sha256:0123'
const MOUNTS = createHash('sha256').update(`${PLUGINS}\n${CLAUDE_BIN}`).digest('hex').slice(0, 16)
const BARE = new Set(['--init', '--read-only'])

test('docker create gets the same flags, mounts and limits it got before the sandbox interface', async () => {
  const id = 'ag_abcd1234'
  const reply = await ask({ cmd: 'create', id, net: 7, browser: false, files: { 'config.yaml': 'a: 1\n', '.env': 'X=1\n', 'SOUL.md': '# soul\n', 'auth.json': '{}\n' } })
  assert.deepEqual(reply, { ok: true, container: `ag-${id}` })
  const spec = boxes.get(id)?.spec
  assert.ok(spec)
  assert.deepEqual(flags(createArgs({ ...spec, image: DIGEST })), flags(oldCreateArgs({ id, net: 7, memory: '1g', cpus: '1', tmp: '256m' })))
})

test('apply recreates a sandbox made by an older spec, like a Large one, at the one size every agent has', async () => {
  const id = 'ag_efgh5678'
  const files = { 'config.yaml': '', '.env': '', 'SOUL.md': '', 'auth.json': '' }
  await ask({ cmd: 'create', id, net: 8, browser: false, files })
  Object.assign(boxes.get(id)?.spec ?? {}, { memoryMib: 2048, cpus: 2, labels: { 'openhut.spec': '3', 'openhut.size': 'large', 'openhut.browser': 'off' } })
  assert.deepEqual(await ask({ cmd: 'apply', id, net: 8, size: 'large', browser: false, files, restart: true }), { ok: true, applied: id, restarted: true })
  assert.deepEqual(boxes.get(id)?.spec.labels, { 'openhut.spec': '4', 'openhut.browser': 'off', 'openhut.mounts': MOUNTS })
  assert.deepEqual([boxes.get(id)?.spec.memoryMib, boxes.get(id)?.spec.cpus], [1024, 1])
  assert.deepEqual(await ask({ cmd: 'ps' }), { ok: true, states: { ag_abcd1234: 'created', [id]: 'running' } })
  assert.deepEqual(await ask({ cmd: 'rm', id }), { ok: true, removed: id })
  assert.equal(boxes.has(id), false)
})

test('apply recreates a sandbox whose mounts came from somewhere else, like the app run from another folder', async () => {
  const id = 'ag_mount123'
  const files = { 'config.yaml': '', '.env': '', 'SOUL.md': '', 'auth.json': '' }
  await ask({ cmd: 'create', id, net: 9, browser: false, files })
  assert.deepEqual(await ask({ cmd: 'apply', id, net: 9, browser: false, files, restart: false }), { ok: true, applied: id, restarted: false })
  Object.assign(boxes.get(id)?.spec.labels ?? {}, { 'openhut.mounts': 'from-a-tmp-mount' })
  assert.deepEqual(await ask({ cmd: 'apply', id, net: 9, browser: false, files, restart: true }), { ok: true, applied: id, restarted: true })
  assert.equal(boxes.get(id)?.spec.labels['openhut.mounts'], MOUNTS)
  await ask({ cmd: 'rm', id })
})

function oldCreateArgs({ id, net, memory, cpus, tmp }: { id: string; net: number; memory: string; cpus: string; tmp: string }) {
  const home = `${DATA}/agents/${id}`
  const conf = `${DATA}/agent-conf/${id}`
  const readOnly = (src: string, dst: string) => ['--mount', `type=bind,src=${conf}/${src},dst=/opt/data/${dst},readonly`]
  const env = { HERMES_HOME: '/opt/data', TERMINAL_HOME_MODE: 'profile', PYTHONNOUSERSITE: '1', CLAUDE_CONFIG_DIR: '/opt/data/.claude', USER: 'hermes', HOME: '/opt/data/home', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', HERMES_GATEWAY_LOCK_DIR: '/tmp/hermes-locks' }
  return [
    'create',
    ...['--name', `ag-${id}`, '--hostname', id, '--restart', 'no'],
    ...['--label', `openhut.agent=${id}`, '--label', `agent.digest=${DIGEST}`, '--label', 'openhut.spec=4', '--label', 'openhut.browser=off', '--label', `openhut.mounts=${MOUNTS}`],
    ...['--runtime', 'runsc', '--user', '10000:10000', '--init', '--entrypoint', '/opt/hermes/bin/hermes'],
    ...['--read-only', '--tmpfs', `/tmp:rw,nosuid,size=${tmp}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'],
    ...['--pids-limit', '512', '--memory', memory, '--cpus', cpus, '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3'],
    ...['--network', `ag-${id}`, '--ip', `10.200.${net}.2`],
    ...Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    ...['--mount', 'type=bind,src=/etc/agentd/resolv.conf,dst=/etc/resolv.conf,readonly'],
    ...['--mount', `type=bind,src=${home},dst=/opt/data`],
    ...['--mount', `type=bind,src=${home}/platforms,dst=/opt/data/platforms`],
    ...['--mount', `type=bind,src=${home}/.claude,dst=/opt/data/.claude`],
    ...['config.yaml', '.env', 'SOUL.md', 'auth.json'].flatMap((name) => readOnly(name, name)),
    ...readOnly('claude-settings.json', '.claude/settings.json'),
    ...['--mount', `type=bind,src=${PLUGINS},dst=/opt/data/plugins,readonly`],
    ...['--mount', `type=bind,src=${CLAUDE_BIN},dst=/usr/local/bin/claude,readonly`],
    ...['--mount', `type=bind,src=${BRIDGE},dst=/opt/data/scripts/whatsapp-bridge,readonly`],
    ...['--tmpfs', '/opt/data/hooks:ro,size=4k', '--tmpfs', '/opt/data/pairing:ro,size=4k', '--tmpfs', '/opt/data/platforms/pairing:ro,size=4k'],
    ...[DIGEST, 'gateway', 'run'],
  ]
}

function flags(args: string[]) {
  const pairs: string[] = []
  let at = 1
  for (; at < args.length && args[at].startsWith('-'); at += BARE.has(args[at]) ? 1 : 2) pairs.push(BARE.has(args[at]) ? args[at] : `${args[at]} ${args[at + 1]}`)
  return { command: args[0], flags: pairs.sort(), image: args.slice(at) }
}

function ask(request: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = connect(SOCK)
    let body = ''
    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => { body += chunk })
    sock.on('end', () => resolve(JSON.parse(body)))
    sock.on('error', reject)
    sock.write(`${JSON.stringify(request)}\n`)
  })
}

test('pullOf counts the layers of the last pull and stops once it finished', () => {
  const pulling = 'abc: Pulling from nousresearch/hermes-agent\na1: Pulling fs layer\na2: Pulling fs layer\na3: Pulling fs layer\na1: Pull complete\n'
  assert.deepEqual(pullOf(pulling), { done: 1, total: 3, unit: 'layers' })
  assert.equal(pullOf(`${pulling}a2: Pull complete\na3: Pull complete\nStatus: Downloaded newer image\n`), null)
  assert.equal(pullOf(''), null)
  assert.deepEqual(pullOf(`old: Pulling from x\nb: Pulling fs layer\nb: Pull complete\nStatus: Downloaded newer image\n${pulling}`), { done: 1, total: 3, unit: 'layers' })
})
