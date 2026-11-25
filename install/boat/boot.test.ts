import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fakeRekor } from '../../packages/desktop/test/fake-rekor.ts'
import { poll, readState } from '../../packages/desktop/src/packs.mjs'

const repo = join(import.meta.dirname, '../..')
const root = mkdtempSync(join(tmpdir(), 'openhut-boot-'))
const feedDir = join(root, 'feed')
const run = async (script: string, argv: string[], env: Record<string, string> = {}) =>
  (await promisify(execFile)(process.execPath, [join(repo, 'scripts', script), ...argv], { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 << 20 })).stdout.trim()
const { rekorKey, server: rekor } = fakeRekor(() => Math.floor(Date.now() / 1000))
const feed = createServer((req, res) => {
  const file = join(feedDir, decodeURIComponent(new URL(req.url!, 'http://feed').pathname))
  if (!existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200).end(readFileSync(file))
})
const url = (server: Server) => `http://127.0.0.1:${(server.address() as { port: number }).port}`
let key = '', otherKey = ''

before(async () => {
  await Promise.all([rekor, feed].map((server) => new Promise<void>((done) => server.listen(0, '0.0.0.0', done))))
  mkdirSync(join(feedDir, 'packs'), { recursive: true })
  mkdirSync(join(feedDir, 'channels/stable'), { recursive: true })
  key = await run('release-key.ts', ['key', join(root, 'release.pem')])
  otherKey = await run('release-key.ts', ['key', join(root, 'other.pem')])
  // Laid out as snapshot.sh installs it in /opt/openhut/boot.
  mkdirSync(join(root, 'boot'))
  for (const file of ['install/boat/boot.mjs', 'packages/desktop/src/packs.mjs', 'packages/desktop/src/release-key.mjs']) copyFileSync(join(repo, file), join(root, 'boot', file.split('/').at(-1)!))
})
after(() => { rekor.close(); feed.close() })

// A release whose "server" answers /health with its name, exits at once, or never listens.
async function publish({ name, sequence, server: kind = 'up', pem = 'release.pem' }: { name: string; sequence: number; server?: 'up' | 'exits' | 'hangs'; pem?: string }) {
  const dist = join(root, `dist-${name}`)
  const server = join(dist, 'backend/packages/runtime/src/server/platform/app.mjs')
  mkdirSync(join(server, '..'), { recursive: true })
  writeFileSync(server, {
    up: `import { createServer } from 'node:http'\ncreateServer((_q, s) => s.end(${JSON.stringify(name)})).listen(Number(process.env.PORT), '127.0.0.1')\n`,
    exits: 'process.exit(3)\n',
    hangs: 'setInterval(() => {}, 1000)\n',
  }[kind])
  for (const dir of ['backend/runtime', 'backend/bin/native', 'renderer']) { mkdirSync(join(dist, dir), { recursive: true }); writeFileSync(join(dist, dir, 'x'), name) }
  const packs = join(root, `packs-${name}`)
  await run('pack.ts', [packs], { OPENHUT_PACK_DIST: dist })
  await run('release-key.ts', ['sign', join(root, pem), packs, '9.9.9', '--channel', 'stable', '--sequence', String(sequence), '--rekor', url(rekor)])
  for (const file of readdirSync(packs).filter((each) => each.startsWith('openhut-'))) copyFileSync(join(packs, file), join(feedDir, 'packs', createHash('sha512').update(readFileSync(join(packs, file))).digest('hex')))
  for (const ext of ['', '.sig', '.rekor']) copyFileSync(join(packs, `release.json${ext}`), join(feedDir, `channels/stable/release.json${ext}`))
}

const home = join(root, 'home')
const envFile = join(root, 'env')
const updates = () => ({ home, feed: `${url(feed)}/`, channel: 'stable', keys: { current: key, next: '', revoked: [] }, rekorKey })

// Runs boot.mjs until it serves (returns what /health said) or exits (returns its code), with every line it logged.
async function boot(port: number): Promise<{ served?: string; code?: number | null; events: string[] }> {
  const child = spawn(process.execPath, [join(root, 'boot/boot.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(port), OPENHUT_HOME: home, OPENHUT_BACKEND: join(root, 'backend'), OPENHUT_ENV_FILE: envFile, OPENHUT_HEALTHY_MS: '5000', OPENHUT_UPDATE_FEED: `${url(feed)}/`, OPENHUT_RELEASE_KEY: key, OPENHUT_REKOR_KEY: rekorKey },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const events: string[] = []
  child.stdout.on('data', (chunk) => events.push(...String(chunk).split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line).event } catch { return line } })))
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)))
  for (const end = Date.now() + 30_000; Date.now() < end; await new Promise((done) => setTimeout(done, 200))) {
    if (child.exitCode !== null) return { code: child.exitCode, events }
    const served = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.text(), () => undefined)
    if (served) {
      await new Promise((done) => setTimeout(done, 1_000)) // boot.mjs commits and deletes the join code just after it sees the server
      child.kill('SIGTERM')
      await exited
      return { served, events }
    }
  }
  child.kill('SIGKILL')
  throw new Error(`boot hung: ${events}`)
}

test('first boot: downloads and verifies a signed release, runs it, commits it and deletes the join code', async () => {
  await publish({ name: 'good', sequence: 100 })
  writeFileSync(envFile, 'OPENHUT_JOIN=code_-1\nOPENHUT_API_URL=http://127.0.0.1:1/api\n')
  const { served, events } = await boot(18871)
  assert.equal(served, 'good')
  assert.ok(events.includes('boot.committed'), String(events))
  assert.equal(readState(home).current.sequence, 100)
  assert.equal(readFileSync(envFile, 'utf8'), 'OPENHUT_API_URL=http://127.0.0.1:1/api\n')
})

test('a release signed by any other key is refused and changes nothing', async () => {
  await publish({ name: 'forged', sequence: 101, pem: 'other.pem' })
  assert.deepEqual(await poll(updates()), { action: 'refuse', reason: 'not signed by a trusted release key' })
  assert.equal(readState(home).pending, null)
  assert.notEqual(otherKey, key)
})

for (const [kind, sequence] of [['exits', 102], ['hangs', 104]] as const) {
  test(`a release whose server ${kind} falls back to the previous one by itself`, async () => {
    await publish({ name: kind, sequence, server: kind })
    assert.equal((await poll(updates())).action, 'install')
    assert.equal(readState(home).pending.sequence, sequence)
    const failed = await boot(18872)
    assert.notEqual(failed.code, 0)
    assert.ok(failed.events.includes('boot.fell_back'), String(failed.events))
    assert.equal(readState(home).pending, null)
    const back = await boot(18872)
    assert.equal(back.served, 'good')
    assert.equal(readState(home).current.sequence, 100)
  })
}

test('snapshot.sh and openhut.service on a fresh Ubuntu 24.04 (systemd container): systemctl is-active openhut', { skip: !process.env.OPENHUT_BOOT_CONTAINER }, async () => {
  await publish({ name: 'good', sequence: 103 })
  const name = `openhut-boot-${process.pid}`
  const sh = (...argv: string[]) => promisify(execFile)('docker', argv, { encoding: 'utf8', maxBuffer: 64 << 20 }).then((r) => r.stdout.trim())
  const inside = (command: string) => sh('exec', name, 'sh', '-c', command)
  try {
    await sh('run', '-d', '--platform', 'linux/amd64', '--name', name, '--privileged', '--cgroupns=host', '--network=host', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw', '-v', `${repo}:/repo:ro`, 'ubuntu:24.04', 'sh', '-c',
      'apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q systemd systemd-sysv >/dev/null && exec /sbin/init')
    for (let i = 0; i < 300 && !(await inside('systemctl is-system-running 2>/dev/null; true')).match(/running|degraded/); i++) await new Promise((done) => setTimeout(done, 1000))
    await inside('sh /repo/install/boat/snapshot.sh')
    await inside(`mkdir -p /etc/systemd/system/openhut.service.d && printf '[Service]\\nEnvironment=OPENHUT_UPDATE_FEED=${url(feed)}/ OPENHUT_RELEASE_KEY=${key} OPENHUT_REKOR_KEY=${rekorKey} PORT=18873\\n' > /etc/systemd/system/openhut.service.d/test.conf`)
    await inside('mkdir -p /home/user/.openhut && printf "OPENHUT_JOIN=abc_-1\\nNODE_OPTIONS=--evil\\n" > /home/user/.openhut/env && systemctl daemon-reload && systemctl start openhut')
    let served = ''
    for (let i = 0; i < 60 && served !== 'good'; i++) { served = await fetch('http://127.0.0.1:18873/health').then((r) => r.text(), () => ''); await new Promise((done) => setTimeout(done, 1000)) }
    const active = await inside('systemctl is-active openhut')
    writeFileSync(join(process.env.OPENHUT_BOOT_OUT ?? root, 'c1-boot.txt'), `$ systemctl is-active openhut\n${active}\n$ curl 127.0.0.1:18873/health\n${served}\n$ cat /etc/openhut/env\n${await inside('cat /etc/openhut/env')}\n$ ls /home/user/.openhut\n${await inside('ls -A /home/user/.openhut')}\n`)
    assert.equal(active, 'active')
    assert.equal(served, 'good')
    assert.equal(await inside('cat /etc/openhut/env'), '', 'the join code is gone and NODE_OPTIONS never got in')
    assert.equal(await inside('ls -A /home/user/.openhut'), '')
  } finally {
    await sh('rm', '-f', name).catch(() => {})
  }
})
