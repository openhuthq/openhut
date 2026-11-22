import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cosigned, RELEASE_KEY } from '../src/release-key.mjs'

const root = join(import.meta.dirname, '../../..')
const release = (args: string[], env: Record<string, string> = {}) => execFileSync(join(root, 'scripts/release.sh'), args, { env: { ...process.env, ...env }, encoding: 'utf8' }).trim()

test('an update installs only with the offline key\'s signature over the release manifest that lists its exact bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oh-release-'))
  const testKey = join(dir, 'test-release.pem')
  const otherKey = join(dir, 'other-release.pem')
  const key = release(['key', testKey])
  const other = release(['key', otherKey])
  const feed = join(dir, 'feed')
  mkdirSync(feed)
  writeFileSync(join(feed, 'OpenHut-9.9.9-arm64.zip'), 'the new app')
  writeFileSync(join(feed, 'latest-mac.yml'), 'version: 9.9.9\n')
  release(['sign', feed], { RELEASE_KEY: testKey })
  const manifest = readFileSync(join(feed, 'release.json'), 'utf8')
  const signature = readFileSync(join(feed, 'release.json.sig'), 'utf8')
  const files = [{ url: 'v9.9.9/OpenHut-9.9.9-arm64.zip', sha512: createHash('sha512').update('the new app').digest('base64') }]

  assert.equal(cosigned({ manifest, signature, key, files }), true)
  assert.equal(cosigned({ manifest, signature, key: other, files }), false, 'another key')
  assert.equal(cosigned({ manifest, signature: '', key, files }), false, 'unsigned')
  assert.equal(cosigned({ manifest: manifest.replace('"files"', '"files" '), signature, key, files }), false, 'a changed manifest')
  assert.equal(cosigned({ manifest, signature, key, files: [{ ...files[0], sha512: createHash('sha512').update('a tampered app').digest('base64') }] }), false, 'other bytes than the signed ones')
  assert.equal(cosigned({ manifest, signature, key, files: [] }), false, 'nothing to install')
  assert.equal(cosigned({ manifest: '', signature: '', key, files }), false, 'no manifest on the feed')
})

test('the pinned release key is unset or a public Ed25519 key, and the updater checks it before it downloads', () => {
  if (RELEASE_KEY) assert.equal(createPublicKey({ key: Buffer.from(RELEASE_KEY, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType, 'ed25519')
  const main = readFileSync(join(import.meta.dirname, '../src/main.mjs'), 'utf8')
  const available = main.slice(main.indexOf("auto.on('update-available'"))
  assert.ok(available.indexOf('releaseSigned(info)') < available.indexOf('auto.downloadUpdate()'))
  assert.match(main, /auto\.autoDownload = false/)
})
