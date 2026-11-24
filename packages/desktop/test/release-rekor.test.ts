import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { cosigned, MIN_AGE_SECONDS, REKOR_KEY, rekorIncluded, verifyRelease } from '../src/release-key.mjs'
import { fakeRekor } from './fake-rekor.ts'

const root = join(import.meta.dirname, '../../..')
const release = async (args: string[], env: Record<string, string> = {}) => (await promisify(execFile)(join(root, 'scripts/release.sh'), args, { env: { ...process.env, ...env }, encoding: 'utf8' })).stdout.trim()
const recorded = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/rekor-entry.json'), 'utf8'))
const real = Object.values(recorded)[0] as any

test('a real rekor.sigstore.dev entry (recorded) checks out against the pinned Rekor key, and any change to it does not', () => {
  assert.equal(rekorIncluded(real), real.integratedTime)
  const changed = (change: (entry: any) => void) => {
    const entry = structuredClone(real)
    change(entry)
    return rekorIncluded(entry)
  }
  assert.equal(changed((e) => { e.integratedTime -= 7200 }), null, 'a backdated time breaks the SET')
  assert.equal(changed((e) => { e.body = Buffer.from('{}').toString('base64') }), null, 'another body')
  assert.equal(changed((e) => { e.verification.inclusionProof.hashes[3] = '00'.repeat(32) }), null, 'a wrong audit path')
  assert.equal(changed((e) => { e.verification.inclusionProof.logIndex += 1 }), null, 'another leaf position')
  assert.equal(changed((e) => { e.verification.inclusionProof.checkpoint = e.verification.inclusionProof.checkpoint.replace(/\n\d+\n/, '\n1\n') }), null, 'a checkpoint for another tree')
  assert.equal(rekorIncluded(real, generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64')), null, 'another log key')
})

test('release.json v2 is signed, logged to Rekor and installed only once its entry is an hour old (SEC6)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-rekor-'))
  const keyFile = join(dir, 'test-release.pem')
  const key = await release(['key', keyFile])
  const integratedTime = 1_800_000_000
  const { rekorKey, server } = fakeRekor(() => integratedTime)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const rekorUrl = `http://127.0.0.1:${(server.address() as any).port}`
  const signed = async (name: string, files: Record<string, string>, ...flags: string[]) => {
    const feed = join(dir, name)
    mkdirSync(feed)
    for (const [file, body] of Object.entries(files)) writeFileSync(join(feed, file), body)
    await release(['sign', feed, '9.9.9', '--sequence', '42', '--shell-api', '1-2', '--rekor', rekorUrl, ...flags], { RELEASE_KEY: keyFile })
    const read = (file: string) => readFileSync(join(feed, file), 'utf8')
    return { manifest: read('release.json'), signature: read('release.json.sig'), rekor: JSON.parse(read('release.json.rekor')) }
  }
  try {
    const feed = await signed('feed', { 'openhut-app.tgz': 'the app pack', 'openhut-app.json': '{"pack":"app"}', 'openhut.tgz': 'the server runtime' })
    const v2 = JSON.parse(feed.manifest)
    assert.deepEqual({ ...v2, files: undefined, packs: undefined }, { schema: 2, version: '9.9.9', sequence: 42, channel: 'stable', shellApi: { min: 1, max: 2 }, halt: false, files: undefined, packs: undefined })
    const sha512 = (body: string) => createHash('sha512').update(body).digest('base64')
    assert.deepEqual(v2.packs, { app: { file: 'openhut-app.tgz', sha512: sha512('the app pack'), manifest: 'openhut-app.json', manifestSha512: sha512('{"pack":"app"}') } }, 'openhut.tgz has no manifest, so it is a file, not a pack')
    assert.equal(cosigned({ ...feed, key, version: '9.9.9', files: [{ url: 'v9.9.9/openhut.tgz', sha512: sha512('the server runtime') }] }), true, 'v1 checks still pass on a v2 release.json')

    const check = (over: Record<string, unknown> = {}) => verifyRelease({ ...feed, key, rekorKey, now: (integratedTime + MIN_AGE_SECONDS) * 1000, ...over })
    assert.deepEqual(check(), { ok: true })
    assert.deepEqual(check({ now: (integratedTime + MIN_AGE_SECONDS) * 1000 - 1 }), { ok: false, reason: 'logged less than an hour ago', retryAt: (integratedTime + MIN_AGE_SECONDS) * 1000 })
    assert.equal(check({ rekor: undefined }).reason, 'no Rekor entry', 'Rekor unreachable or the entry missing: nothing installs')
    assert.equal(check({ rekorKey: REKOR_KEY }).ok, false, 'an entry not signed by the pinned log')
    assert.equal(check({ key: (await release(['key', join(dir, 'other.pem')])) }).reason, 'not signed by the release key')
    assert.equal(check({ manifest: feed.manifest.replace('"halt": false', '"halt": true') }).ok, false, 'a changed manifest')
    const other = await signed('other', { 'openhut-app.tgz': 'another app pack', 'openhut-app.json': '{}' })
    assert.equal(check({ rekor: other.rekor }).reason, 'the Rekor entry is for another release', 'a real entry for another release')
    const halted = await signed('halted', { 'openhut-app.tgz': 'the app pack' }, '--halt', '--channel', 'beta')
    assert.deepEqual([JSON.parse(halted.manifest).halt, JSON.parse(halted.manifest).channel], [true, 'beta'])
  } finally {
    server.close()
  }
})
