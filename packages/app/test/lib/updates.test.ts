import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accepted } from '../../src/lib/updates.ts'

const SCRIPT = new URL('../../../../../../scripts/sign-phone-bundle.ts', import.meta.url).pathname
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
const release = pair()

function signed(sequence: number) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'))
  writeFileSync(join(dir, 'index.html'), `<p>bundle ${sequence}</p>`)
  const out = join(dir, 'out')
  execFileSync(process.execPath, [SCRIPT, '--dir', dir, '--out', out, '--sequence', String(sequence), '--app-version', '1.0', '--updates-url', 'https://cloud.example/v1/updates/'], { env: { ...process.env, PHONE_BUNDLE_KEY: release.privateKey } })
  return { manifest: JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')), zip: readFileSync(join(out, 'bundle.zip')) }
}

test('a bundle signed by the sign script is accepted by the phone, and its zip carries the signature the live-update plugin checks', async () => {
  const { manifest, zip } = signed(3)
  assert.deepEqual(await accepted({ body: manifest, key: release.publicKey, appVersion: '1.0', highest: 2 }), { manifest })
  assert.equal(manifest.sha256, createHash('sha256').update(zip).digest('hex'))
  assert.equal(manifest.url, `https://cloud.example/v1/updates/bundles/${manifest.bundleId}.zip`)
  assert.ok(verify('sha256', zip, release.publicKey, Buffer.from(manifest.bundleSignature, 'base64')))
  zip[zip.length - 30] ^= 1
  assert.ok(!verify('sha256', zip, release.publicKey, Buffer.from(manifest.bundleSignature, 'base64')))
})

test('the phone refuses a changed manifest, another key, another app version and anything not newer than what it applied', async () => {
  const { manifest } = signed(5)
  const check = (body: object, highest = 4, key = release.publicKey, appVersion = '1.0') => accepted({ body, key, appVersion, highest })
  assert.deepEqual(await check({ ...manifest, sequence: 9 }), { refused: `the signature of ${manifest.bundleId} doesn't verify` })
  assert.deepEqual(await check({ ...manifest, url: 'https://evil.example/b.zip' }), { refused: `the signature of ${manifest.bundleId} doesn't verify` })
  assert.deepEqual(await check(manifest, 4, pair().publicKey), { refused: `the signature of ${manifest.bundleId} doesn't verify` })
  assert.deepEqual(await check(manifest, 4, 'not a key'), { refused: `the signature of ${manifest.bundleId} doesn't verify` })
  assert.deepEqual(await check(manifest, 4, release.publicKey, '1.1'), { refused: `${manifest.bundleId} is for app 1.0, not 1.1` })
  assert.deepEqual(await check(manifest, 5), { refused: `${manifest.bundleId} has sequence 5, and 5 is already applied` })
  assert.deepEqual(await check(manifest, 7), { refused: `${manifest.bundleId} has sequence 5, and 7 is already applied` })
  assert.deepEqual(await check({ ...manifest, signature: undefined }), { refused: 'the manifest is malformed' })
  assert.deepEqual(await check({ ...manifest, bundleId: '../x' }), { refused: 'the manifest is malformed' })
})
