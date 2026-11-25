import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MIN_AGE_SECONDS, pointerAction } from '../src/release-key.mjs'
import { fakeRekor } from './fake-rekor.ts'

// R4: the stable pointer. Promote signs main's newest green packs as stable, for every device at once; halt stops
// a pending install on the next poll; a pointer to N−1's bytes rolls a fleet back. All through release-key.ts and pointerAction(), with
// M5 wires pointerAction() into the boot's pack apply (pending, commit, roll back).
const root = join(import.meta.dirname, '../../..')
const node = async (args: string[]) => (await promisify(execFile)(process.execPath, [join(root, 'scripts/release-key.ts'), ...args], { encoding: 'utf8' })).stdout.trim()

test('Promote moves stable to everyone at once; halt stops a pending install within one poll; a pointer to N−1 rolls the fleet back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-channels-'))
  const keyFile = join(dir, 'test-release.pem')
  const key = await node(['key', keyFile])
  let clock = 1_800_000_000
  const { rekorKey, server } = fakeRekor(() => clock)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const rekor = `http://127.0.0.1:${(server.address() as any).port}`
  const read = (folder: string) => ({ manifest: readFileSync(join(folder, 'release.json'), 'utf8'), signature: readFileSync(join(folder, 'release.json.sig'), 'utf8'), rekor: JSON.parse(readFileSync(join(folder, 'release.json.rekor'), 'utf8')) })
  const stableOf = async (name: string, app: string, sequence: number) => {
    const folder = join(dir, name)
    mkdirSync(folder)
    writeFileSync(join(folder, 'openhut-app.tgz'), app)
    writeFileSync(join(folder, 'openhut-app.json'), `{"app":"${app}"}`)
    await node(['sign', keyFile, folder, '1.0.0', '--sequence', String(sequence), '--shell-api', '1-2', '--rekor', rekor])
    return folder
  }
  const point = async (from: string, to: string, ...flags: string[]) => {
    await node(['point', keyFile, from, join(dir, to), '--rekor', rekor, ...flags])
    return join(dir, to)
  }
  const fleet = (pointer: ReturnType<typeof read>, installed: number[], at = clock) =>
    installed.map((sequence) => pointerAction({ pointer, channel: 'stable', installed: sequence, shellApi: 1, key, rekorKey, now: at * 1000 }))
  const hourLater = () => clock + MIN_AGE_SECONDS
  try {
    const old = await stableOf('stable-n-1', 'app N−1', 100)

    // Promote: main's packs, signed as stable and logged.
    clock += 10
    const stable = await stableOf('stable-n', 'app N', 300)
    const built = JSON.parse(read(stable).manifest)
    assert.equal(built.channel, 'stable')
    assert.deepEqual(fleet(read(stable), [0, 100, 150]).map((each) => each.action), ['install', 'install', 'install'], 'age rule off (MIN_AGE_SECONDS 0): installs right away')
    assert.equal(pointerAction({ pointer: read(stable), channel: 'stable', installed: 0, shellApi: 1, key, rekorKey, now: clock * 1000, minAge: 3600 }).action, 'wait', 'at 3600 s the hour applies')
    const rollout = fleet(read(stable), [0, 100, 150], hourLater())
    assert.deepEqual(rollout.map((each) => [each.action, each.sequence]), [['install', 300], ['install', 300], ['install', 300]], 'every device at once, no stages')
    assert.deepEqual(rollout[0].packs, built.packs)
    assert.equal(pointerAction({ pointer: read(stable), channel: 'stable', installed: 0, shellApi: 3, key, rekorKey, now: hourLater() * 1000 }).action, 'refuse', 'outside its shellApi range')

    // Halt, published 10 minutes into the hour: the device holding N as pending drops it on its next poll, without waiting an hour.
    clock += 600
    const halted = await point(stable, 'stable-halt', '--halt')
    assert.equal(JSON.parse(read(halted).manifest).halt, true)
    assert.deepEqual(fleet(read(halted), [100]), [{ action: 'halt', sequence: JSON.parse(read(halted).manifest).sequence }])

    // A pointer back to N−1's bytes, above every sequence so far: a fleet already on N goes back to N−1's packs (after the hour too).
    clock += 600
    const back = await point(old, 'stable-back', '--sequence', String(JSON.parse(read(halted).manifest).sequence + 1))
    assert.deepEqual(fleet(read(back), [300, 300, 300]).map((each) => each.action), ['install', 'install', 'install'], 'rollbacks too, with the age rule off')
    const rolled = fleet(read(back), [300, 300, 300], hourLater())
    assert.deepEqual(rolled.map((each) => [each.action, each.version]), [['install', '1.0.0'], ['install', '1.0.0'], ['install', '1.0.0']])
    assert.deepEqual(rolled[0].packs, JSON.parse(read(old).manifest).packs, 'N−1\'s exact packs')
    assert.deepEqual(fleet(read(stable), [Number(rolled[0].sequence)], hourLater()), [{ action: 'none' }], 'replaying N\'s pointer does not undo the rollback')
    assert.deepEqual(fleet(read(halted), [Number(rolled[0].sequence)]), [{ action: 'none' }], 'nor does replaying the old halt')

    // The pointer is only as good as its signature and log entry.
    const tampered = { ...read(back), manifest: read(back).manifest.replace('"halt": false', '"halt": true') }
    assert.equal(fleet(tampered, [300])[0].action, 'refuse', 'an unsigned halt')
    assert.equal(fleet({ ...read(back), rekor: undefined } as any, [300], hourLater())[0].action, 'refuse', 'no Rekor entry, no rollback either')
    await assert.rejects(node(['point', keyFile, back, join(dir, 'lower'), '--sequence', '5']), /sequence above/, 'a pointer never goes below its source')
    await assert.rejects(node(['point', keyFile, halted, join(dir, 'unhalt')]), /is a halt/, 'a halt is never re-pointed as a release')
    await assert.rejects(node(['sign', keyFile, old, '1.0.0', '--channel', 'beta']), /usage/, 'stable is the only channel')
    await node(['key', join(dir, 'other.pem')])
    await assert.rejects(node(['point', join(dir, 'other.pem'), back, join(dir, 'other')]), /isn't signed by this release key/)
  } finally {
    server.close()
  }
})
