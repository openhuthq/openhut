import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MIN_AGE_SECONDS } from '../src/release-key.mjs'
import { activePack, commit, poll, readState, rollback } from '../src/packs.mjs'
import { fakeRekor } from './fake-rekor.ts'

// M5 with real packs: scripts/pack.ts builds them, scripts/release-key.ts signs and logs them (a test key and a stand-in Rekor), a feed
// serves them as R4 lays it out (channels/<channel>/release.json, packs/<sha512 hex>), and packs.mjs, the shell's updater, installs them.
// CI runs this on Linux (ci.yml checks).
const root = join(import.meta.dirname, '../../..')
const run = async (script: string, args: string[], env = {}) => (await promisify(execFile)(process.execPath, [join(root, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } })).stdout.trim()
const platform = `${process.platform}-${process.arch}`

test('packs move N−1 → N, a broken pack rolls back by itself, a fleet follows a pointer back to N−1, "next" signs, a revoked key doesn\'t', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-packs-'))
  let clock = 1_800_000_000
  const { rekorKey, server: rekorServer } = fakeRekor(() => clock)
  await new Promise<void>((done) => rekorServer.listen(0, '127.0.0.1', done))
  const rekor = `http://127.0.0.1:${(rekorServer.address() as any).port}`
  const feedDir = join(dir, 'feed')
  const feedServer = createServer((req, res) => {
    const file = join(feedDir, decodeURIComponent(req.url!.slice(1)))
    if (!existsSync(file)) return res.writeHead(404).end()
    res.writeHead(200).end(readFileSync(file))
  })
  await new Promise<void>((done) => feedServer.listen(0, '127.0.0.1', done))
  const feed = `http://127.0.0.1:${(feedServer.address() as any).port}/`
  const keyOf = async (name: string) => ({ file: join(dir, `${name}.pem`), pub: await run('release-key.ts', ['key', join(dir, `${name}.pem`)]) })
  const current = await keyOf('current')
  const next = await keyOf('next')
  const fresh = await keyOf('fresh')

  // A dist laid out like packages/release/dist: the server script, Hermes's runtime, a native binary and the renderer.
  const build = async (name: string, marker: string, extra: Record<string, string> = {}) => {
    const dist = join(dir, `dist-${name}`)
    const put = (path: string, body: string) => { mkdirSync(join(dist, path, '..'), { recursive: true }); writeFileSync(join(dist, path), body) }
    put('backend/packages/runtime/src/server/platform/app.mjs', `export const build = '${marker}'\n`)
    put('backend/vendor/hermes-plugins/plugin.py', '# plugin\n')
    put('backend/runtime/python/bin/python3', '#!/bin/sh\n')
    chmodSync(join(dist, 'backend/runtime/python/bin/python3'), 0o755)
    put('backend/bin/native/agent-browser', 'binary\n')
    put('renderer/index.html', `<title>${marker}</title>`)
    for (const [path, body] of Object.entries(extra)) put(path, body)
    const out = join(dir, name)
    await run('pack.ts', [out], { OPENHUT_PACK_DIST: dist })
    return out
  }
  const sign = async (folder: string, sequence: number, key = current.file, ...flags: string[]) => {
    await run('release-key.ts', ['sign', key, folder, '1.0.0', '--channel', 'stable', '--sequence', String(sequence), '--rekor', rekor, ...flags])
    return folder
  }
  // scripts/r2.sh packs + pointer, into a folder instead of R2.
  const publish = (folder: string) => {
    mkdirSync(join(feedDir, 'packs'), { recursive: true })
    mkdirSync(join(feedDir, 'channels/stable'), { recursive: true })
    for (const name of readdirSync(folder).filter((each) => each.startsWith('openhut-'))) {
      copyFileSync(join(folder, name), join(feedDir, 'packs', createHash('sha512').update(readFileSync(join(folder, name))).digest('hex')))
    }
    for (const ext of ['', '.sig', '.rekor']) copyFileSync(join(folder, `release.json${ext}`), join(feedDir, `channels/stable/release.json${ext}`))
  }
  const device = (name: string) => ({ home: join(dir, name), data: join(dir, name, 'data') })
  const later = () => (clock + MIN_AGE_SECONDS) * 1000
  const check = (d: ReturnType<typeof device>, at = later(), keys?: any, minAge?: number) => poll({ home: d.home, feed, channel: 'stable', keys: keys ?? (readState(d.home).seen ? undefined : { current: current.pub, next: next.pub, revoked: [] }), rekorKey, now: at, minAge })
  // A restart: the shell picks the pack set, boots it, and commits or rolls back.
  const restart = (d: ReturnType<typeof device>, boots = true) => {
    const active = activePack(d)
    if (active?.pending) (boots ? commit : rollback)(d)
    return activePack(d)
  }
  const runs = (d: ReturnType<typeof device>) => readFileSync(join(activePack(d)!.app, 'packages/runtime/src/server/platform/app.mjs'), 'utf8')

  try {
    const n1 = await sign(await build('n-1', 'N−1'), 100)
    const n = await sign(await build('n', 'N'), 200)
    const fleet = ['a', 'b', 'c'].map(device)
    for (const d of fleet) mkdirSync(join(d.data, 'app'), { recursive: true })

    // N−1, then N: (at 3600 s) wait out the hour, install pending, restart, commit.
    publish(n1)
    const waiting = await check(fleet[0], clock * 1000, undefined, 3600)
    assert.equal(waiting.action, 'wait', 'SEC6 at 3600 s: logged under an hour ago')
    assert.deepEqual([waiting.downloaded.sort(), readState(fleet[0].home).pending], [['app', 'native', 'runtime'], null], 'downloaded during the wait, not installed')
    for (const d of fleet) assert.equal((await check(d)).action, 'install')
    for (const d of fleet) restart(d)
    assert.match(runs(fleet[0]), /N−1/)
    publish(n)
    for (const d of fleet) assert.equal((await check(d)).action, 'install')
    for (const d of fleet) restart(d)
    for (const d of fleet) assert.match(runs(d), /'N'/)
    const shipped = JSON.parse(readFileSync(join(n, 'release.json'), 'utf8'))
    const hex = (b64: string) => Buffer.from(b64, 'base64').toString('hex')
    assert.deepEqual(readState(fleet[0].home).current.packs, { app: hex(shipped.packs.app.sha512), runtime: hex(shipped.packs[`runtime-${platform}`].sha512), native: hex(shipped.packs[`native-${platform}`].sha512) }, 'R2: the shell runs exactly the hashes release.json names')
    assert.ok(existsSync(join(activePack(fleet[0])!.runtime!, 'python/bin/python3')) && existsSync(join(activePack(fleet[0])!.native!, 'agent-browser')))

    // A broken N+1: its server never comes up, so the shell goes back to N by itself, data/app restored, and doesn't take N+1 again.
    const broken = await sign(await build('broken', 'broken', { 'backend/packages/runtime/src/server/platform/app.mjs': 'throw new Error("broken")\n' }), 250)
    publish(broken)
    const d = fleet[0]
    writeFileSync(join(d.data, 'app/db'), 'before')
    assert.equal((await check(d)).action, 'install')
    assert.equal(activePack(d)!.pending, true)
    writeFileSync(join(d.data, 'app/db'), 'half-migrated')
    assert.match(activePack(d)!.app, new RegExp(hex(shipped.packs.app.sha512)), 'a pending set found already tried (the boot died) rolls back at startup')
    assert.equal(readFileSync(join(d.data, 'app/db'), 'utf8'), 'before')
    assert.equal((await check(d)).action, 'none', 'the broken sequence isn\'t installed again')

    // A pointer back to N−1's bytes at a higher sequence rolls the whole fleet back, with real packs.
    clock += 60
    await run('release-key.ts', ['point', current.file, n1, join(dir, 'back'), '--sequence', '300', '--rekor', rekor])
    publish(join(dir, 'back'))
    for (const each of fleet) assert.equal((await check(each, clock * 1000)).action, 'install', 'age rule off (MIN_AGE_SECONDS 0): no wait')
    for (const each of fleet) assert.match(restart(each) && runs(each), /N−1/)

    // halt drops a pending install on the next poll.
    clock += 60
    const n2 = await sign(await build('n2', 'N2'), 400)
    publish(n2)
    assert.equal((await check(d)).action, 'install')
    await run('release-key.ts', ['point', current.file, n2, join(dir, 'halt'), '--halt', '--sequence', '401', '--rekor', rekor])
    publish(join(dir, 'halt'))
    assert.equal((await check(d, clock * 1000)).action, 'halt')
    assert.equal(readState(d.home).pending, null)

    // Key rotation: "next" signs a release naming the new set with "current" revoked; it's accepted, and then "current" alone isn't.
    const rotated = await sign(await build('rotated', 'rotated'), 500, next.file, '--keys', JSON.stringify({ current: next.pub, next: fresh.pub, revoked: [current.pub] }))
    publish(rotated)
    assert.equal((await check(d)).action, 'install', 'a release signed with "next" is accepted')
    assert.deepEqual(readState(d.home).keys, { current: next.pub, next: fresh.pub, revoked: [current.pub] })
    publish(await sign(await build('stolen', 'stolen'), 600))
    assert.deepEqual(await check(d), { action: 'refuse', reason: 'not signed by a trusted release key' }, 'one signed only by a revoked key is rejected')

    // A pack whose bytes don't match release.json is never installed.
    const fleetB = device('tampered')
    publish(n)
    const appPack = join(feedDir, 'packs', hex(shipped.packs.app.sha512))
    writeFileSync(appPack, Buffer.concat([readFileSync(appPack), Buffer.from('x')]))
    await assert.rejects(check(fleetB), /doesn't match the release/)
  } finally {
    rekorServer.close()
    feedServer.close()
    feedServer.closeAllConnections()
  }
})
